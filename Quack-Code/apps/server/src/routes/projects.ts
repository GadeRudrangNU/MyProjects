import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAX_FILES_PER_PROJECT,
  createFileSchema,
  createProjectSchema,
  fileSchema,
  idSchema,
  moveFileSchema,
  projectSchema,
} from '@quack/shared';
import { schema } from '../db/client.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';

const { projects, files } = schema;

type FileRow = typeof files.$inferSelect;
const fileDto = (f: Pick<FileRow, 'id' | 'path' | 'kind' | 'updatedAt'>) => ({
  id: f.id,
  path: f.path,
  kind: f.kind,
  updatedAt: f.updatedAt.toISOString(),
});
const projectDto = (p: typeof projects.$inferSelect) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  createdAt: p.createdAt.toISOString(),
});

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505';

export async function projectRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = app;

  async function projectWorkspace(projectId: string) {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!p) throw notFound('Project');
    return p;
  }

  r.get(
    '/workspaces/:id/projects',
    { schema: { params: z.object({ id: idSchema }), response: { 200: z.object({ items: z.array(projectSchema) }) } } },
    async (req) => {
      await app.requireRole(req, req.params.id, 'workspace:read');
      const rows = await db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, req.params.id))
        .orderBy(asc(projects.createdAt));
      return { items: rows.map(projectDto) };
    },
  );

  r.post(
    '/workspaces/:id/projects',
    { schema: { params: z.object({ id: idSchema }), body: createProjectSchema, response: { 201: projectSchema } } },
    async (req, reply) => {
      await app.requireRole(req, req.params.id, 'project:create');
      const [p] = await db.insert(projects).values({ workspaceId: req.params.id, name: req.body.name }).returning();
      return reply.status(201).send(projectDto(p!));
    },
  );

  r.get('/projects/:id', { schema: { params: z.object({ id: idSchema }), response: { 200: projectSchema } } }, async (req) => {
    const p = await projectWorkspace(req.params.id);
    await app.requireRole(req, p.workspaceId, 'workspace:read');
    return projectDto(p);
  });

  r.patch(
    '/projects/:id',
    { schema: { params: z.object({ id: idSchema }), body: createProjectSchema, response: { 200: projectSchema } } },
    async (req) => {
      const p = await projectWorkspace(req.params.id);
      await app.requireRole(req, p.workspaceId, 'project:create');
      const [u] = await db.update(projects).set({ name: req.body.name }).where(eq(projects.id, p.id)).returning();
      return projectDto(u!);
    },
  );

  r.delete('/projects/:id', { schema: { params: z.object({ id: idSchema }) } }, async (req, reply) => {
    const p = await projectWorkspace(req.params.id);
    await app.requireRole(req, p.workspaceId, 'project:delete');
    const ids = await db.select({ id: files.id }).from(files).where(eq(files.projectId, p.id));
    await db.delete(projects).where(eq(projects.id, p.id));
    await app.docs.evict(ids.map((x) => x.id));
    return reply.status(204).send();
  });

  // The tree is bounded by MAX_FILES_PER_PROJECT, so it is returned whole rather than paginated.
  r.get(
    '/projects/:id/files',
    { schema: { params: z.object({ id: idSchema }), response: { 200: z.object({ items: z.array(fileSchema) }) } } },
    async (req) => {
      const p = await projectWorkspace(req.params.id);
      await app.requireRole(req, p.workspaceId, 'file:read');
      const rows = await db
        .select({ id: files.id, path: files.path, kind: files.kind, updatedAt: files.updatedAt })
        .from(files)
        .where(eq(files.projectId, p.id))
        .orderBy(asc(files.path));
      return { items: rows.map(fileDto) };
    },
  );

  async function assertParentFolder(projectId: string, path: string) {
    const parent = parentOf(path);
    if (!parent) return;
    const [row] = await db
      .select({ kind: files.kind })
      .from(files)
      .where(and(eq(files.projectId, projectId), eq(files.path, parent)));
    if (row?.kind !== 'folder') throw badRequest(`Parent folder "${parent}" does not exist`);
  }

  r.post(
    '/projects/:id/files',
    { schema: { params: z.object({ id: idSchema }), body: createFileSchema, response: { 201: fileSchema } } },
    async (req, reply) => {
      const p = await projectWorkspace(req.params.id);
      await app.requireRole(req, p.workspaceId, 'file:write');
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(files)
        .where(eq(files.projectId, p.id));
      if (count >= MAX_FILES_PER_PROJECT) {
        throw new HttpError(422, 'limit_reached', `Projects are limited to ${MAX_FILES_PER_PROJECT} files and folders`);
      }
      await assertParentFolder(p.id, req.body.path);
      try {
        const [f] = await db
          .insert(files)
          .values({ projectId: p.id, path: req.body.path, kind: req.body.kind, plainText: req.body.content ?? '' })
          .returning();
        return reply.status(201).send(fileDto(f!));
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`"${req.body.path}" already exists`);
        throw e;
      }
    },
  );

  // Rename or move. Folders carry their descendants with them in a single statement.
  r.patch(
    '/files/:id',
    { schema: { params: z.object({ id: idSchema }), body: moveFileSchema, response: { 200: fileSchema } } },
    async (req) => {
      const [f] = await db.select().from(files).where(eq(files.id, req.params.id));
      if (!f) throw notFound('File');
      const p = await projectWorkspace(f.projectId);
      await app.requireRole(req, p.workspaceId, 'file:write');

      const next = req.body.path;
      if (next === f.path) return fileDto(f);
      if (f.kind === 'folder' && next.startsWith(`${f.path}/`)) throw badRequest('Cannot move a folder into itself');
      await assertParentFolder(p.id, next);

      try {
        await db.execute(sql`
          update files
          set path = ${next} || substr(path, length(${f.path}) + 1), updated_at = now()
          where project_id = ${p.id}
            and (path = ${f.path} or left(path, length(${f.path}) + 1) = ${f.path + '/'})
        `);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`"${next}" already exists`);
        throw e;
      }
      const [updated] = await db.select().from(files).where(eq(files.id, f.id));
      return fileDto(updated!);
    },
  );

  r.delete('/files/:id', { schema: { params: z.object({ id: idSchema }) } }, async (req, reply) => {
    const [f] = await db.select().from(files).where(eq(files.id, req.params.id));
    if (!f) throw notFound('File');
    const p = await projectWorkspace(f.projectId);
    await app.requireRole(req, p.workspaceId, 'file:write');
    const removed = await db.execute<{ id: string }>(sql`
      delete from files
      where project_id = ${p.id}
        and (path = ${f.path} or left(path, length(${f.path}) + 1) = ${f.path + '/'})
      returning id
    `);
    await app.docs.evict(removed.rows.map((x) => x.id));
    return reply.status(204).send();
  });
}
