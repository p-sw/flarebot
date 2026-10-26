declare module "cloudflare:test" {
  export const env: Env;
  export function applyD1Migrations(
    db: D1Database,
    migrations: readonly { name: string; queries: string[] }[] | undefined,
  ): Promise<void>;
  export function runInDurableObject<R>(
    stub: DurableObjectStub,
    callback: (
      instance: DurableObject,
      state: DurableObjectState,
    ) => R | Promise<R>,
  ): Promise<R>;
}
