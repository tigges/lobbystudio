import { execSync } from "node:child_process";
import { inArray } from "drizzle-orm";
import {
  bookingRequests,
  chunks,
  conversations,
  evalRuns,
  getDb,
  handovers,
  labelledAnswers,
  messages,
  piiVault,
  turnLabels,
  turns,
  type EvalScores,
} from "@dental-bot/db";
import { businessById } from "../businesses.ts";
import type { LlmMode } from "../config.ts";
import { runTurn, startSession } from "../services/turns.ts";
import { loadCases, type EvalCase } from "./cases.ts";
import { checkReply, replyText } from "./check.ts";
import { averageScores, judgeReply, type Judgement } from "./judge.ts";

export type TurnReport = { say: string; reply: string; failures: string[]; judgement: Judgement | null };
export type CaseReport = { name: string; source?: string; passed: boolean; turns: TurnReport[] };
export type RunReport = {
  tenantId: string;
  build: string | null;
  mode: LlmMode;
  cases: CaseReport[];
  passed: number;
  scores: EvalScores | null;
  costUsd: number;
};

export function currentBuild(): string | null {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Replays each saved conversation through the real turn pipeline, checks every reply, and with `judge`
 * has a stronger model score it. The conversations are deleted afterwards so they never reach the console.
 * Real booking systems are switched off for the run: the demo diary takes the bookings.
 */
export async function runEvals(opts: {
  tenantId: string;
  mode: LlmMode;
  judge?: boolean;
  only?: string;
  save?: boolean;
  onCase?: (c: CaseReport) => void;
}): Promise<RunReport> {
  const business = businessById(opts.tenantId);
  if (!business) throw new Error(`unknown business ${opts.tenantId}`);
  const phorest = process.env.PHOREST_CONFIG;
  delete process.env.PHOREST_CONFIG;
  const cases = loadCases(opts.tenantId).filter((c) => !opts.only || c.name.toLowerCase().includes(opts.only.toLowerCase()));
  const created: string[] = [];
  const reports: CaseReport[] = [];
  const judged: EvalScores[] = [];
  let cost = 0;
  try {
    for (const c of cases) {
      const report = await runCase(c, opts, business.name, created);
      for (const t of report.turns) {
        if (t.judgement) {
          judged.push(t.judgement);
          cost += t.judgement.costUsd;
        }
      }
      reports.push(report);
      opts.onCase?.(report);
    }
  } finally {
    await removeConversations(created);
    if (phorest !== undefined) process.env.PHOREST_CONFIG = phorest;
  }
  const run: RunReport = {
    tenantId: opts.tenantId,
    build: currentBuild(),
    mode: opts.mode,
    cases: reports,
    passed: reports.filter((r) => r.passed).length,
    scores: averageScores(judged),
    costUsd: Math.round(cost * 1e6) / 1e6,
  };
  if (opts.save !== false) {
    await getDb().insert(evalRuns).values({
      tenantId: run.tenantId,
      build: run.build,
      llmMode: run.mode,
      cases: reports.length,
      passed: run.passed,
      scores: run.scores,
      results: reports,
      costUsd: run.costUsd,
    });
  }
  return run;
}

async function runCase(c: EvalCase, opts: { tenantId: string; mode: LlmMode; judge?: boolean }, businessName: string, created: string[]) {
  const session = await startSession({ tenantId: opts.tenantId, visitorId: `eval-${crypto.randomUUID()}` });
  created.push(session.conversationId);
  const transcript = session.messages.map((m) => ({ role: "Assistant", text: m.text }));
  const turnReports: TurnReport[] = [];
  for (const t of c.turns) {
    const say = t.say ?? `[taps ${t.action === "book" ? "Book an appointment" : "Talk to the team"}]`;
    const { result } = await runTurn({
      tenantId: opts.tenantId,
      conversationId: session.conversationId,
      text: t.say ?? null,
      action: t.action ?? null,
      mode: opts.mode,
      build: "eval",
    });
    const reply = replyText(result);
    const failures = checkReply(t.expect, result);
    let judgement: Judgement | null = null;
    if (opts.judge && reply) {
      judgement = await judgeReply({
        business: businessName,
        transcript: [...transcript, { role: "Visitor", text: say }],
        reply,
        extracts: await extractsFor(result.segments.flatMap((s) => s.sources.map((src) => src.chunkId))),
        hint: t.expect?.judge,
      }).catch((err: Error) => ({ correct: 0, grounded: 0, answers: 0, nextStep: 0, note: `judge failed: ${err.message}`, costUsd: 0 }));
      if (judgement.correct === 0) judgement = null;
    }
    transcript.push({ role: "Visitor", text: say }, { role: "Assistant", text: reply });
    turnReports.push({ say, reply, failures, judgement });
  }
  return { name: c.name, source: c.source, passed: turnReports.every((t) => t.failures.length === 0), turns: turnReports };
}

async function extractsFor(ids: number[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await getDb().select({ heading: chunks.heading, text: chunks.text }).from(chunks).where(inArray(chunks.id, unique));
  return rows.map((r) => `${r.heading}\n${r.text}`);
}

async function removeConversations(ids: string[]) {
  if (ids.length === 0) return;
  const db = getDb();
  for (const table of [messages, turns, turnLabels, piiVault, handovers, labelledAnswers, bookingRequests]) {
    await db.delete(table).where(inArray(table.conversationId, ids));
  }
  await db.delete(conversations).where(inArray(conversations.id, ids));
}
