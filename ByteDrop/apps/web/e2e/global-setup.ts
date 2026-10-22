import { startStack } from "../../../scripts/e2e-stack.mjs";

export default async function globalSetup() {
  // Browser tests for the real stack need its own database, API, worker and a production web build.
  if (process.env.E2E_SKIP_STACK) return;
  await startStack();
}
