import { loadConversation, runTurn, type TurnEvent } from "@dental-bot/core";
import { CORS, fail, tenantId, isUuid, preflight, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const MAX_INPUT = 1000;

export async function POST(req: Request) {
  const body = await readJson(req);
  const tenant = await tenantId(body?.tenant);
  if (!body || !tenant) return fail(400, "unknown tenant");
  if (!isUuid(body.conversationId)) return fail(400, "bad conversationId");
  const conversationId = body.conversationId;
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_INPUT) : null;
  const action = body.action === "book" || body.action === "handover" ? body.action : null;
  if (!text?.trim() && !action) return fail(400, "text or action required");

  const conv = await loadConversation(tenant, conversationId);
  if (!conv) return fail(404, "conversation not found");
  if (conv.status === "closed") return fail(409, "conversation closed");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await runTurn({
          tenantId: tenant,
          conversationId,
          text,
          action,
          emit: (e: TurnEvent) => {
            const { type, ...data } = e;
            send(type, data);
          },
        });
      } catch (err) {
        console.error("[chat] turn failed", err);
        send("error", { message: "turn failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
