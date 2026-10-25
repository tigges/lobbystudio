import { and, desc, eq } from "drizzle-orm";
import {
  chunks,
  contentPages,
  contentVersions,
  deploymentEvents,
  deployments,
  getDb,
  type Db,
  tenants,
  versions,
  type Source,
} from "@dental-bot/db";
import { packFor } from "./packs/index.ts";
import type { Bundle } from "./runtime/types.ts";

const bundleCache = new Map<number, Bundle>();

export async function loadBundle(versionId: number): Promise<Bundle> {
  const cached = bundleCache.get(versionId);
  if (cached) return cached;
  const db = getDb();
  const [v] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!v) throw new Error(`version ${versionId} not found`);
  const [cv] = await db.select().from(contentVersions).where(eq(contentVersions.id, v.contentVersionId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, v.tenantId));
  const pack = packFor(tenant!.vertical);
  const emergencyChunks = await db
    .select()
    .from(chunks)
    .where(
      and(
        eq(chunks.tenantId, v.tenantId),
        eq(chunks.contentVersionId, v.contentVersionId),
        eq(chunks.pageSlug, pack.handoverSources.slug),
      ),
    )
    .orderBy(chunks.id);
  const toSource = (c: (typeof emergencyChunks)[number]): Source => ({
    page: c.pageTitle,
    slug: c.pageSlug,
    heading: c.heading,
    anchor: c.anchor,
    chunkId: c.id,
  });
  const pick = (pattern: RegExp) => emergencyChunks.filter((c) => pattern.test(c.anchor)).map(toSource);
  const bundle: Bundle = {
    tenantId: v.tenantId,
    versionId: v.id,
    versionNumber: v.number,
    contentVersionId: v.contentVersionId,
    contentVersionNumber: cv!.number,
    guidance: v.guidance,
    procedures: v.procedures,
    flowCatalogue: v.flowCatalogue,
    config: v.config,
    practice: { name: tenant!.name, phone: tenant!.phone },
    vertical: pack.vertical,
    booking: tenant!.booking,
    handoverSources: {
      urgent: pick(pack.handoverSources.urgent),
      clinical: pick(pack.handoverSources.clinical),
    },
  };
  bundleCache.set(versionId, bundle);
  return bundle;
}

/** The widget only ever serves this version. */
export async function promotedVersionId(tenantId: string): Promise<number> {
  const [d] = await getDb().select().from(deployments).where(eq(deployments.tenantId, tenantId));
  if (!d) throw new Error(`no promoted version for tenant ${tenantId}`);
  return d.promotedVersionId;
}

export async function promote(
  tenantId: string,
  versionId: number,
  actor: string,
  action: "promote" | "rollback" = "promote",
  db: Pick<Db, "transaction"> = getDb(),
) {
  await db.transaction(async (tx) => {
    const [v] = await tx
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.id, versionId), eq(versions.tenantId, tenantId)));
    if (!v) throw new Error(`version ${versionId} does not belong to ${tenantId}`);
    const [current] = await tx.select().from(deployments).where(eq(deployments.tenantId, tenantId)).for("update");
    if (current) {
      await tx
        .update(deployments)
        .set({ promotedVersionId: versionId, updatedAt: new Date() })
        .where(eq(deployments.tenantId, tenantId));
    } else {
      await tx.insert(deployments).values({ tenantId, promotedVersionId: versionId });
    }
    await tx.insert(deploymentEvents).values({
      tenantId,
      action,
      fromVersionId: current?.promotedVersionId ?? null,
      toVersionId: versionId,
      actor,
    });
  });
}

export async function listVersions(tenantId: string) {
  return getDb().select().from(versions).where(eq(versions.tenantId, tenantId)).orderBy(desc(versions.number));
}

export async function promotedPages(tenantId: string) {
  const db = getDb();
  const bundle = await loadBundle(await promotedVersionId(tenantId));
  const pages = await db
    .select()
    .from(contentPages)
    .where(and(eq(contentPages.tenantId, tenantId), eq(contentPages.contentVersionId, bundle.contentVersionId)))
    .orderBy(contentPages.position);
  return { bundle, pages };
}
