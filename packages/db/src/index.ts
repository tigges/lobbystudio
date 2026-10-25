import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __dentalBotPool?: pg.Pool; __dentalBotDb?: Db };

export function getPool(): pg.Pool {
  if (!globalForDb.__dentalBotPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__dentalBotPool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return globalForDb.__dentalBotPool;
}

export function getDb(): Db {
  if (!globalForDb.__dentalBotDb) {
    globalForDb.__dentalBotDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__dentalBotDb;
}

export async function closeDb() {
  await globalForDb.__dentalBotPool?.end();
  globalForDb.__dentalBotPool = undefined;
  globalForDb.__dentalBotDb = undefined;
}
