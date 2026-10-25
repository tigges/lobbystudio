import { cookies } from "next/headers";
import { BUSINESSES, businessById, DEFAULT_TENANT } from "@dental-bot/core";

/** The business a deployment shows before anyone uses the switcher. */
export const SITE_TENANT = process.env.SITE_TENANT ?? DEFAULT_TENANT;

export const BUSINESS_COOKIE = "business";

/** The demo business the site and console show, chosen with the switcher; the deployment's own tenant by default. */
export async function currentTenant(): Promise<string> {
  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  return chosen && businessById(chosen) ? chosen : SITE_TENANT;
}

export function switcherOptions() {
  return BUSINESSES.map((b) => ({ id: b.id, name: b.name }));
}
