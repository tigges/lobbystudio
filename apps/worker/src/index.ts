import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb, getPool } from "@dental-bot/db";
import { sweepOutcomes } from "@dental-bot/core";

loadRootEnv();

const SWEEP_EVERY_MS = 5 * 60 * 1000;
/** Arbitrary constant shared by every worker replica so only one sweeps at a time. */
const SWEEP_LOCK = 4_242_001;

async function sweepOnce() {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [SWEEP_LOCK]);
    if (!rows[0]?.locked) return;
    try {
      const started = Date.now();
      const { assigned } = await sweepOutcomes(new Date());
      console.log(`[worker] outcome sweep: ${assigned} assigned in ${Date.now() - started} ms`);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SWEEP_LOCK]);
    }
  } catch (err) {
    console.error("[worker] outcome sweep failed", err);
  } finally {
    client.release();
  }
}

let timer: NodeJS.Timeout | undefined;
let running: Promise<void> = Promise.resolve();

function tick() {
  running = sweepOnce();
}

console.log(`[worker] started; sweeping outcomes every ${SWEEP_EVERY_MS / 60000} minutes`);
tick();
timer = setInterval(tick, SWEEP_EVERY_MS);

async function shutdown() {
  clearInterval(timer);
  await running;
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
