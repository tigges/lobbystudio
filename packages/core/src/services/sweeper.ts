import { getPool } from "@dental-bot/db";
import { sweepOutcomes } from "./outcomes.ts";

const SWEEP_EVERY_MS = 5 * 60 * 1000;
/** Shared by every process that sweeps (worker or web) so only one sweeps at a time. */
const SWEEP_LOCK = 4_242_001;

export async function sweepOnce(log: (msg: string) => void = console.log) {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [SWEEP_LOCK]);
    if (!rows[0]?.locked) return;
    try {
      const started = Date.now();
      const { assigned } = await sweepOutcomes(new Date());
      log(`outcome sweep: ${assigned} assigned in ${Date.now() - started} ms`);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SWEEP_LOCK]);
    }
  } catch (err) {
    console.error("outcome sweep failed", err);
  } finally {
    client.release();
  }
}

/**
 * Sweeps now and every 5 minutes. Outcomes are derived from timestamps, so a process that was
 * asleep (e.g. a free-tier web service) catches up on its first sweep after waking.
 */
export function startOutcomeSweeper(log: (msg: string) => void = console.log) {
  let running: Promise<void> = sweepOnce(log);
  const timer = setInterval(() => {
    running = sweepOnce(log);
  }, SWEEP_EVERY_MS);
  return async function stop() {
    clearInterval(timer);
    await running;
  };
}
