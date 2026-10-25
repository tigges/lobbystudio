"use server";

import { revalidatePath } from "next/cache";
import { clearTurnLabel, releaseToBot, setConversationReviewed, setHandoverContact, setLabelsActioned, setTurnLabel, staffReply } from "@dental-bot/core";
import { buildInfo } from "@/lib/build";
import { currentTenant } from "@/lib/business";

export async function replyAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  const text = String(form.get("text") ?? "").trim();
  const author = String(form.get("author") ?? "").trim() || "Team";
  if (!text) return;
  await staffReply({
    tenantId: await currentTenant(),
    conversationId,
    text,
    author,
    saveAsLabel: form.get("saveAsLabel") === "on",
  });
  revalidatePath(`/console/handovers/${conversationId}`);
}

export async function contactAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  await setHandoverContact({
    tenantId: await currentTenant(),
    conversationId,
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
  });
  revalidatePath(`/console/handovers/${conversationId}`);
}

export async function labelTurnAction(form: FormData) {
  const turnId = Number(form.get("turnId"));
  const label = String(form.get("label") ?? "");
  const path = String(form.get("path") ?? "/console/insights");
  if (!Number.isInteger(turnId)) return;
  if (form.get("clear") || !label) await clearTurnLabel({ tenantId: await currentTenant(), turnId });
  else await setTurnLabel({ tenantId: await currentTenant(), turnId, label, note: String(form.get("note") ?? "") });
  revalidatePath(path.split("?")[0]!);
}

export async function releaseAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  await releaseToBot({ tenantId: await currentTenant(), conversationId });
  revalidatePath(`/console/handovers/${conversationId}`);
}

export async function reviewedAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  await setConversationReviewed({ tenantId: await currentTenant(), conversationId, reviewed: form.get("reviewed") === "1" });
  revalidatePath(`/console/conversations/${conversationId}`);
  revalidatePath("/console/conversations");
}

export async function actionedAction(form: FormData) {
  const turnIds = String(form.get("turnIds") ?? "")
    .split(",")
    .map(Number)
    .filter(Number.isInteger);
  const path = String(form.get("path") ?? "/console/insights");
  await setLabelsActioned({ tenantId: await currentTenant(), turnIds, actioned: form.get("actioned") === "1", build: buildInfo().commit });
  revalidatePath(path.split("?")[0]!);
  revalidatePath("/console/conversations");
}
