import { labelExport } from "@dental-bot/core";
import { buildInfo } from "@/lib/build";
import { SITE_TENANT } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const labels = await labelExport(SITE_TENANT);
  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exportedAt, build: buildInfo().commit, tenant: SITE_TENANT, count: labels.length, labels }, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="labels-${exportedAt.slice(0, 10)}.json"`,
    },
  });
}
