import { pageSlug, startSession } from "@dental-bot/core";
import { buildInfo } from "@/lib/build";
import { fail, tenantId, isUuid, json, preflight, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const body = await readJson(req);
  const tenant = await tenantId(body?.tenant);
  if (!body || !tenant) return fail(400, "unknown tenant");
  const visitorId = body.visitorId;
  if (typeof visitorId !== "string" || visitorId.length < 8 || visitorId.length > 64) return fail(400, "bad visitorId");
  const session = await startSession({
    tenantId: tenant,
    visitorId,
    conversationId: isUuid(body.conversationId) ? body.conversationId : null,
    page: pageSlug(body.page),
  });
  return json({ ...session, build: buildInfo().commit });
}
