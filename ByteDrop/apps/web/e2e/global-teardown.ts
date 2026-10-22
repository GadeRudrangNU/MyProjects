import { stopStack } from "../../../scripts/e2e-stack.mjs";

export default async function globalTeardown() {
  stopStack();
}
