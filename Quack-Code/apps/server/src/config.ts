import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_URL: z.string().default('http://localhost:4000'),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  DEV_LOGIN: z.enum(['true', 'false']).default('true'),
  TICKET_SECRET: z.string().optional(),
  SESSION_DAYS: z.coerce.number().default(14),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof envSchema> & { devLoginEnabled: boolean; isProd: boolean; ticketSecret: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const isProd = parsed.NODE_ENV === 'production';
  if (isProd && !parsed.TICKET_SECRET) throw new Error('TICKET_SECRET is required in production');
  return {
    ...parsed,
    isProd,
    devLoginEnabled: !isProd && parsed.DEV_LOGIN === 'true',
    ticketSecret: parsed.TICKET_SECRET ?? 'dev-only-ticket-secret',
  };
}
