import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db/client.js';

export async function workspaceFileIds(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.files.projectId))
    .where(eq(schema.projects.workspaceId, workspaceId));
  return rows.map((r) => r.id);
}
