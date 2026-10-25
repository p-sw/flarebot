declare module "cloudflare:test" {
  export const env: Env;
  export function applyD1Migrations(
    db: D1Database,
    migrations: readonly { name: string; queries: string[] }[] | undefined,
  ): Promise<void>;
}
