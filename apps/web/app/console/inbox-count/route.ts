import { inboxCounts } from "@dental-bot/core";
import { currentTenant } from "@/lib/business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await inboxCounts(await currentTenant()));
}
