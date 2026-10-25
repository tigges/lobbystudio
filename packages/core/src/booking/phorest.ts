import { z } from "zod";
import type { Business } from "../businesses.ts";
import { serviceKind, staffFor } from "./demo-diary.ts";
import type { BookingSystem, OfferedSlot, SlotQuery } from "./types.ts";
import { localParts, slotLabel, wantedDays, wantedHours } from "./when.ts";

/** `PHOREST_CONFIG`: the salon's Phorest third-party API account and how its services and staff map to the chat's. */
export const PhorestConfig = z.object({
  baseUrl: z.string().url().default("https://api-gateway-eu.phorest.com/third-party-api-server/api"),
  businessId: z.string(),
  branchId: z.string(),
  /** The API user's email; Phorest expects it as `global/<email>`. */
  username: z.string(),
  password: z.string(),
  /** Phorest service ids for the chat's services: cut, colour, highlights, treatment, blowdry. */
  services: z.record(z.string(), z.string()),
  /** Phorest staff ids by the first names the diary uses, e.g. { "Hana": "abc123" }. */
  staff: z.record(z.string(), z.string()),
});
export type PhorestConfig = z.infer<typeof PhorestConfig>;

const SEARCH_DAYS = 14;
const TIMEOUT_MS = 8000;

type AvailableSlot = {
  startTime: string;
  staffId?: string;
  clientServiceSchedules?: { serviceSchedules?: { staffId?: string }[] }[];
};

/**
 * Books into Phorest through its third-party API: find free times for the service, find or create
 * the client by mobile number, then create an active booking with the chat's notes.
 */
export function phorest(business: Business, config: PhorestConfig, fetchImpl: typeof fetch = fetch): BookingSystem {
  const auth = `Basic ${Buffer.from(`global/${config.username}:${config.password}`).toString("base64")}`;
  const nameOf = new Map(Object.entries(config.staff).map(([name, id]) => [id, name]));
  const biz = `${config.baseUrl}/business/${config.businessId}`;
  const branch = `${biz}/branch/${config.branchId}`;

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: auth, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Phorest ${method} ${new URL(url).pathname.split("/").slice(-1)[0]}: ${res.status}`);
    return (await res.json()) as T;
  }

  function serviceId(service: string) {
    const id = config.services[serviceKind(service)];
    if (!id) throw new Error(`no Phorest service for "${service}"`);
    return id;
  }

  return {
    name: "Phorest",
    async availability(q: SlotQuery): Promise<OfferedSlot[]> {
      const wanted = staffFor(q.stylist, business.diary?.staff ?? [])
        .map((s) => config.staff[s.name])
        .filter((id): id is string => Boolean(id));
      const { availableSlots = [] } = await call<{ availableSlots?: AvailableSlot[] }>("POST", `${branch}/appointments/availability`, {
        startTime: q.earliest.toISOString(),
        endTime: new Date(q.earliest.getTime() + SEARCH_DAYS * 86_400_000).toISOString(),
        isOnlineAvailability: true,
        clientServiceSelections: [
          { serviceSelections: [{ serviceId: serviceId(q.service), ...(wanted.length === 1 ? { staffId: wanted[0] } : {}) }] },
        ],
      });
      const days = wantedDays(q.preferredTime);
      const hours = wantedHours(q.preferredTime, q.partOfDay);
      const out: OfferedSlot[] = [];
      for (const s of availableSlots) {
        const staffId = s.staffId ?? s.clientServiceSchedules?.[0]?.serviceSchedules?.[0]?.staffId ?? "";
        if (wanted.length && !wanted.includes(staffId)) continue;
        const start = new Date(s.startTime);
        const { weekday, hour, minute } = localParts(start, q.timeZone);
        if (days && !days.has(weekday)) continue;
        const from = hour + minute / 60;
        if (hours && (from < hours[0] || from >= hours[1])) continue;
        const staffName = nameOf.get(staffId) ?? "";
        out.push({
          id: `${staffId}@${start.toISOString()}`,
          start: start.toISOString(),
          staffId,
          staffName,
          label: `${slotLabel(start, q.timeZone)}${staffName ? ` with ${staffName}` : ""}`,
        });
        if (out.length === 3) break;
      }
      return out;
    },
    async book({ slot, service, client, note }) {
      const mobile = client.phone.replace(/[^\d+]/g, "");
      const found = await call<{ _embedded?: { clients?: { clientId: string }[] } }>(
        "GET",
        `${biz}/client?mobile=${encodeURIComponent(mobile)}`,
      );
      let clientId = found._embedded?.clients?.[0]?.clientId;
      if (!clientId) {
        const [firstName, ...rest] = client.name.trim().split(/\s+/);
        const created = await call<{ clientId: string }>("POST", `${biz}/client`, {
          firstName,
          lastName: rest.join(" ") || "-",
          mobile,
          creatingBranchId: config.branchId,
        });
        clientId = created.clientId;
      }
      const booking = await call<{ bookingId: string }>("POST", `${branch}/booking`, {
        clientId,
        bookingStatus: "ACTIVE",
        note,
        clientAppointmentSchedules: [
          { clientId, serviceSchedules: [{ serviceId: serviceId(service), startTime: slot.start, staffId: slot.staffId }] },
        ],
      });
      return { system: "Phorest", ref: booking.bookingId };
    },
  };
}
