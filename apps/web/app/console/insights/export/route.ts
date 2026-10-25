import { labelExport, labelTitle } from "@dental-bot/core";
import { buildInfo } from "@/lib/build";
import { SITE_TENANT } from "@/lib/site";

export const dynamic = "force-dynamic";

const COLUMNS = ["labelled at", "label", "note", "visitor", "assistant", "reply kinds", "assistant version", "build", "turn at", "ledger"] as const;

const cell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(" ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const labels = await labelExport(SITE_TENANT);
  const exportedAt = new Date().toISOString();
  const name = `labels-${exportedAt.slice(0, 10)}`;

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const origin = host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : new URL(req.url).origin;
    const lines = labels.map((l) =>
      [
        l.labelledAt,
        labelTitle(String(l.label)),
        l.note,
        l.visitor,
        l.assistant,
        l.replyKinds,
        l.assistantVersion,
        l.build,
        l.at,
        `${origin}/console/conversations/${l.conversationId}?turn=${l.turn}#turn-${l.turn}`,
      ]
        .map(cell)
        .join(","),
    );
    // The BOM makes Excel read the file as UTF-8.
    return new Response(`\uFEFF${[COLUMNS.join(","), ...lines].join("\r\n")}\r\n`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
    });
  }

  const body = JSON.stringify({ exportedAt, build: buildInfo().commit, tenant: SITE_TENANT, count: labels.length, labels }, null, 2);
  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}.json"` },
  });
}
