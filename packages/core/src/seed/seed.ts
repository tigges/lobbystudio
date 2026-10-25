import { eq, sql } from "drizzle-orm";
import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb, deployments, getDb, tenants, versions } from "@dental-bot/db";
import { BUSINESSES, type Business } from "../businesses.ts";
import { MODEL_ROLES } from "../config.ts";
import { sweepOutcomes } from "../services/outcomes.ts";
import { promote } from "../versions.ts";
import { createContentVersion, readSeed, seedPages, seedQuestions } from "./content.ts";
import { seedDemoConversations } from "./demo.ts";

loadRootEnv();

const db = getDb();

const [anyTenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
const [anyDeployment] = await db.select({ tenantId: deployments.tenantId }).from(deployments).limit(1);
if (anyTenant && !anyDeployment) {
  // A seed from before per-business transactions that died before promoting anything (e.g. OOM on a small
  // instance). Nothing has ever been served, so it is safe to clear. TRUNCATE bypasses the immutability triggers.
  console.log("[seed] found an incomplete earlier seed (nothing promoted); clearing it and seeding again");
  await db.execute(sql`truncate table
    tenants, content_versions, content_pages, chunks, passages, versions, deployments, deployment_events,
    conversations, messages, turns, turn_labels, pii_vault, handovers, labelled_answers, booking_requests
    restart identity`);
}

const seeded: string[] = [];
for (const business of BUSINESSES) {
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, business.id));
  if (existing) {
    console.log(`[seed] ${business.id} already seeded; run \`pnpm db:reset\` to start again`);
    continue;
  }
  await seedBusiness(business);
  seeded.push(business.id);
}

if (seeded.length && !process.argv.includes("--no-demo")) {
  for (const id of seeded) {
    const n = await seedDemoConversations(id);
    console.log(`[seed] ${id}: ${n} demo conversations`);
  }
  const { assigned } = await sweepOutcomes();
  console.log(`[seed] ${assigned} outcomes assigned by the 24h sweep`);
}
await closeDb();

/** Tenant, content v1 and behaviour v1, promoted. Nothing is kept unless all of it is written. */
async function seedBusiness(business: Business) {
  const guidance = readSeed(business, "behaviour", "guidance.md");
  if (guidance.length > 1500) throw new Error(`${business.id} guidance is ${guidance.length} characters; the cap is 1,500`);
  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: business.id,
      tenantId: business.id,
      name: business.name,
      phone: business.phone,
      vertical: business.vertical,
      booking: business.booking,
    });
    const contentVersionId = await createContentVersion(
      business.id,
      1,
      "Initial website",
      seedPages(business),
      seedQuestions(business),
      tx,
    );
    const [v1] = await tx
      .insert(versions)
      .values({
        tenantId: business.id,
        number: 1,
        contentVersionId,
        guidance,
        procedures: [
          { key: "booking_request", title: "Booking request", steps: readSeed(business, "behaviour", "procedures", "booking-request.md") },
          { key: "handover", title: "Handover", steps: readSeed(business, "behaviour", "procedures", "handover.md") },
        ],
        flowCatalogue: ["booking_request", "handover"],
        config: { chatModel: MODEL_ROLES.chat, retrievalThreshold: business.retrievalThreshold, maxChunks: 4 },
        note: "Initial behaviour",
        createdBy: "seed",
      })
      .returning();
    await promote(business.id, v1!.id, "seed", "promote", tx);
  });
  console.log(`[seed] ${business.id}: tenant, content v1 and behaviour v1 created; v1 promoted`);
}
