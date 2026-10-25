import { recordFeedback } from "@dental-bot/core";
import { fail, tenantId, isUuid, json, preflight, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const body = await readJson(req);
  const tenant = await tenantId(body?.tenant);
  if (!body || !tenant) return fail(400, "unknown tenant");
  if (!isUuid(body.conversationId)) return fail(400, "bad conversationId");
  const value = body.value === 1 || body.value === -1 || body.value === 0 ? body.value : undefined;
  const messageId = Number.isInteger(body.messageId) ? (body.messageId as number) : undefined;
  const rating = typeof body.rating === "number" ? body.rating : undefined;
  if ((messageId === undefined || value === undefined) && rating === undefined) return fail(400, "nothing to record");
  await recordFeedback({ tenantId: tenant, conversationId: body.conversationId, messageId, value, rating });
  return json({ ok: true });
}
