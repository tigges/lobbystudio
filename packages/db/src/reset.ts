import { loadRootEnv } from "./env.ts";
import { closeDb, getPool } from "./index.ts";

loadRootEnv();

await getPool().query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
console.log("[db] schema dropped");
await closeDb();
