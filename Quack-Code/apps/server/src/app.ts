import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { HttpError } from './errors.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { memberRoutes } from './routes/members.js';
import { inviteRoutes } from './routes/invites.js';
import { projectRoutes } from './routes/projects.js';
import websocket from '@fastify/websocket';
import { DocManager } from './realtime/docs.js';
import { realtimeRoutes } from './realtime/routes.js';

export async function buildApp(deps: { config: Config; db: Db; pool: { query: (q: string) => Promise<unknown> } }) {
  const { config, db } = deps;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
    bodyLimit: 2_500_000, // room for a 500k-character import in multi-byte text
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('pool', deps.pool);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin);
  await app.register(websocket, { options: { maxPayload: 1_048_576 } });

  const docs = new DocManager(db, app.log);
  app.decorate('docs', docs);
  app.addHook('onClose', async () => {
    await docs.flushAll();
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ code: 'validation_error', message: 'Invalid request', details: err.validation });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply
        .status(status)
        .send({ code: status === 429 ? 'rate_limited' : 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'internal_error', message: 'Something went wrong' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'not_found', message: 'Route not found' }));

  await app.register(healthRoutes);
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(workspaceRoutes);
      await api.register(memberRoutes);
      await api.register(inviteRoutes);
      await api.register(projectRoutes);
      await api.register(realtimeRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
