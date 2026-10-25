import { loadConversation, readableMessages } from "@dental-bot/core";
import { fail, tenantId, isUuid, json, preflight } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const tenant = await tenantId(url.searchParams.get("tenant"));
  if (!tenant) return fail(400, "unknown tenant");
  if (!isUuid(id)) return fail(400, "bad conversation id");
  const conv = await loadConversation(tenant, id);
  if (!conv) return fail(404, "conversation not found");
  const after = Number(url.searchParams.get("after") ?? 0) || 0;
  return json({ status: conv.status, messages: await readableMessages(tenant, id, after) });
}
