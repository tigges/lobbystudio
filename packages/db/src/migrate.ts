import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadRootEnv } from "./env.ts";
import { closeDb, getDb } from "./index.ts";

loadRootEnv();

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

await migrate(getDb(), { migrationsFolder });
console.log("[db] migrations applied");
await closeDb();
