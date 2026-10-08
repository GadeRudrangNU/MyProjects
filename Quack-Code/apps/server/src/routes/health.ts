import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await app.pool.query('select 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'database_unreachable' });
    }
  });
}
