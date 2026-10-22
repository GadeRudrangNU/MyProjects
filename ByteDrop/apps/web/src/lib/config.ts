/** Demo mode serves everything from in-memory seeded data, so the app needs no backend. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
