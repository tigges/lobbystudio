import { promotedVersionId } from "@dental-bot/core";
import { SITE_TENANT } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await promotedVersionId(SITE_TENANT);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
