"use server";

import { revalidatePath } from "next/cache";
import { releaseToBot, setHandoverContact, staffReply } from "@dental-bot/core";
import { SITE_TENANT } from "@/lib/site";

export async function replyAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  const text = String(form.get("text") ?? "").trim();
  const author = String(form.get("author") ?? "").trim() || "Practice team";
  if (!text) return;
  await staffReply({
    tenantId: SITE_TENANT,
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
    tenantId: SITE_TENANT,
    conversationId,
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
  });
  revalidatePath(`/console/handovers/${conversationId}`);
}

export async function releaseAction(form: FormData) {
  const conversationId = String(form.get("conversationId"));
  await releaseToBot({ tenantId: SITE_TENANT, conversationId });
  revalidatePath(`/console/handovers/${conversationId}`);
}
