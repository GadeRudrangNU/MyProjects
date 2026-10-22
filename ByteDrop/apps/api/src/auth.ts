import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";
import type { Db } from "./db/client";
import * as schema from "./db/schema";

export function createAuth(db: Db, cfg: Config) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: cfg.AUTH_SECRET,
    baseURL: cfg.WEB_ORIGIN,
    basePath: "/api/auth",
    trustedOrigins: [cfg.WEB_ORIGIN, cfg.PUBLIC_URL],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    rateLimit: { enabled: cfg.NODE_ENV === "production" },
    session: { expiresIn: 60 * 60 * 24 * 7 },
  });
}

export type Auth = ReturnType<typeof createAuth>;
