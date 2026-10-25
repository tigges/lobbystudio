import { eq } from "drizzle-orm";
import { getDb, tenants } from "@dental-bot/db";

/** The widget is embedded on other origins, so every public endpoint answers CORS. */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export function fail(status: number, message: string) {
  return json({ error: message }, status);
}

const known = new Set<string>();

export async function tenantId(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  if (known.has(id)) return id;
  const [row] = await getDb().select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id));
  if (!row) return null;
  known.add(id);
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
