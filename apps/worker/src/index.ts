import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb } from "@dental-bot/db";
import { startOutcomeSweeper } from "@dental-bot/core";

loadRootEnv();

const log = (msg: string) => console.log(`[worker] ${msg}`);
log("started; sweeping outcomes every 5 minutes");
const stop = startOutcomeSweeper(log);

async function shutdown() {
  await stop();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
