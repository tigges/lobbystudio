import type { BookingConfig } from "@dental-bot/db";
import { businessById } from "../businesses.ts";
import { demoDiary } from "./demo-diary.ts";
import { phorest, PhorestConfig } from "./phorest.ts";
import type { BookingSystem } from "./types.ts";

export type { BookingSystem, OfferedSlot, SlotQuery, BookedAppointment } from "./types.ts";
export { demoDiary } from "./demo-diary.ts";
export { phorest, PhorestConfig } from "./phorest.ts";

const cache = new Map<string, BookingSystem | null>();

/**
 * The booking system a business books into, or null for call-back requests. Online businesses use their
 * real system when its credentials are set (e.g. `PHOREST_CONFIG`), otherwise a demo diary.
 */
export function bookingSystemFor(tenantId: string, booking: BookingConfig): BookingSystem | null {
  if (booking.mode !== "online") return null;
  const key = `${tenantId}:${booking.system}`;
  if (cache.has(key)) return cache.get(key)!;
  const business = businessById(tenantId);
  let system: BookingSystem | null = null;
  if (business && booking.system === "phorest") {
    const raw = process.env.PHOREST_CONFIG;
    system = raw ? phorest(business, PhorestConfig.parse(JSON.parse(raw))) : business.diary ? demoDiary(business) : null;
  }
  cache.set(key, system);
  return system;
}
