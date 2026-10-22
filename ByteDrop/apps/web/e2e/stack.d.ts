declare module "*/e2e-stack.mjs" {
  export const stackUrls: { web: string; api: string; receiver: string };
  export function startStack(): Promise<void>;
  export function stopStack(): void;
}
