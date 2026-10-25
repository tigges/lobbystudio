import { and, eq, sql } from "drizzle-orm";
import { bookingRequests, getDb, type BookingConfig } from "@dental-bot/db";
import { businessById } from "../businesses.ts";
import { DEMO_DIARY, demoDiary } from "./demo-diary.ts";
import { phorest, PhorestConfig } from "./phorest.ts";
import type { BookingSystem } from "./types.ts";

export type { BookingSystem, OfferedSlot, SlotQuery, BookedAppointment } from "./types.ts";
export { demoDiary } from "./demo-diary.ts";
export { phorest, PhorestConfig } from "./phorest.ts";

const cache = new Map<string, BookingSystem | null>();

/** Upcoming times the demo diary has booked, as saved with each booking. */
async function bookedInDemoDiary(tenantId: string): Promise<string[]> {
  const slotId = sql<string>`${bookingRequests.slots}->>'slot_id'`;
  const rows = await getDb()
    .select({ slotId })
    .from(bookingRequests)
    .where(
      and(
        eq(bookingRequests.tenantId, tenantId),
        eq(bookingRequests.channel, "online"),
        eq(bookingRequests.system, DEMO_DIARY),
        sql`(${bookingRequests.slots}->>'slot_start')::timestamptz > now()`,
      ),
    );
  return rows.map((r) => r.slotId);
}

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
    system = raw ? phorest(business, PhorestConfig.parse(JSON.parse(raw))) : business.diary ? demoDiary(business, () => bookedInDemoDiary(tenantId)) : null;
  }
  cache.set(key, system);
  return system;
}
