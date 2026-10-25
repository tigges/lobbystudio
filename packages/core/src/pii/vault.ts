import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, piiVault } from "@dental-bot/db";
import { normaliseValue, tokenise, type DetectOptions, type PiiKind } from "./detect.ts";

function key(): Buffer {
  const secret = process.env.PII_KEY;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("PII_KEY must be set to 32+ characters");
    return createHash("sha256").update("dental-bot-dev-pii-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

function hashKey(k: string): string {
  return createHmac("sha256", key()).update(k).digest("hex");
}

type Row = typeof piiVault.$inferSelect;

async function rows(tenantId: string, conversationId: string): Promise<Row[]> {
  return getDb()
    .select()
    .from(piiVault)
    .where(and(eq(piiVault.tenantId, tenantId), eq(piiVault.conversationId, conversationId)));
}

/** Tokenises visitor text and stores new values encrypted. Raw values never reach the database in clear. */
export async function tokeniseForConversation(
  tenantId: string,
  conversationId: string,
  text: string,
  opts: DetectOptions = {},
): Promise<{ text: string; tokens: string[] }> {
  const existing = await rows(tenantId, conversationId);
  const known = new Map<string, string>();
  for (const r of existing) {
    known.set(`${r.kind}:${normaliseValue(r.kind as PiiKind, decrypt(r.ciphertext))}`, r.token);
  }
  const result = tokenise(text, known, opts);
  if (result.created.length) {
    await getDb()
      .insert(piiVault)
      .values(
        result.created.map((c) => ({
          tenantId,
          conversationId,
          token: c.token,
          kind: c.kind,
          valueHash: hashKey(c.key),
          ciphertext: encrypt(c.value),
        })),
      )
      .onConflictDoNothing();
  }
  return { text: result.text, tokens: result.created.map((c) => c.token) };
}

export async function vaultValues(tenantId: string, conversationId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const r of await rows(tenantId, conversationId)) map.set(r.token, decrypt(r.ciphertext));
  return map;
}
