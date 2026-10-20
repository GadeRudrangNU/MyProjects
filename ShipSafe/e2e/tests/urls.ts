export const API = "http://localhost:5081";
export const DASHBOARD = "http://localhost:5174";
export const DEMO = "http://localhost:5201";
export const ADMIN_HEADERS = { "x-admin-key": "dev-admin-key", "x-actor": "e2e", "content-type": "application/json" };
export const SDK_HEADERS = { "x-sdk-key": "dev-sdk-key", "content-type": "application/json" };

export function uniqueKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
