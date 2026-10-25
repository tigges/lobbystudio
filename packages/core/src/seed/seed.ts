import { eq, sql } from "drizzle-orm";
import { loadRootEnv } from "@dental-bot/db/env";
import { closeDb, deployments, getDb, tenants, versions } from "@dental-bot/db";
import { DEFAULT_TENANT, MODEL_ROLES } from "../config.ts";
import { sweepOutcomes } from "../services/outcomes.ts";
import { promote } from "../versions.ts";
import { createContentVersion, readSeed, seedPages, seedQuestions } from "./content.ts";
import { seedDemoConversations } from "./demo.ts";

loadRootEnv();

const tenantId = DEFAULT_TENANT;
const db = getDb();

const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
const [anyDeployment] = await db.select({ tenantId: deployments.tenantId }).from(deployments).limit(1);
if (existing && anyDeployment && !process.argv.includes("--force")) {
  console.log(`[seed] ${tenantId} already seeded; run \`pnpm db:reset\` to start again`);
  await closeDb();
  process.exit(0);
}
if (existing && !anyDeployment) {
  // A seed that died before promoting anything (e.g. OOM on a small instance). Nothing has ever been
  // served, so it is safe to clear. TRUNCATE bypasses the row-level immutability triggers.
  console.log("[seed] found an incomplete earlier seed (nothing promoted); clearing it and seeding again");
  await db.execute(sql`truncate table
    tenants, content_versions, content_pages, chunks, passages, versions, deployments, deployment_events,
    conversations, messages, turns, turn_labels, pii_vault, handovers, labelled_answers, booking_requests
    restart identity`);
}

await db.insert(tenants).values({ id: tenantId, tenantId, name: "Harbour Dental", phone: "020 7946 0321" });

const contentVersionId = await createContentVersion(
  tenantId,
  1,
  "Initial website",
  seedPages(),
  seedQuestions(),
);

const guidance = readSeed("behaviour", "guidance.md");
if (guidance.length > 1500) throw new Error(`guidance is ${guidance.length} characters; the cap is 1,500`);

const [v1] = await db
  .insert(versions)
  .values({
    tenantId,
    number: 1,
    contentVersionId,
    guidance,
    procedures: [
      { key: "booking_request", title: "Booking request", steps: readSeed("behaviour", "procedures", "booking-request.md") },
      { key: "handover", title: "Handover", steps: readSeed("behaviour", "procedures", "handover.md") },
    ],
    flowCatalogue: ["booking_request", "handover"],
    config: { chatModel: MODEL_ROLES.chat, retrievalThreshold: 0.68, maxChunks: 4 },
    note: "Initial behaviour",
    createdBy: "seed",
  })
  .returning();
await promote(tenantId, v1!.id, "seed");
console.log(`[seed] tenant, content v1 and behaviour v1 created; v1 promoted`);

if (!process.argv.includes("--no-demo")) {
  const n = await seedDemoConversations(tenantId);
  const { assigned } = await sweepOutcomes();
  console.log(`[seed] ${n} demo conversations; ${assigned} outcomes assigned by the 24h sweep`);
}
await closeDb();
