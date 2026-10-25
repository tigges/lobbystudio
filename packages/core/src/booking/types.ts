/** What the visitor qualified in the chat, used to find times in the business's booking system. */
export type SlotQuery = {
  service: string;
  /** e.g. "Senior stylist", a stylist's name, or "No preference". */
  stylist: string | null;
  /** Nothing earlier than this, e.g. 48 hours after a patch test. */
  earliest: Date;
  /** The visitor's own words, e.g. "Saturday morning" or "after work". */
  preferredTime: string | null;
  partOfDay: string | null;
  timeZone: string;
};

export type OfferedSlot = {
  id: string;
  start: string;
  staffId: string;
  staffName: string;
  /** As shown on the quick reply, e.g. "Sat 31 Oct, 10:30 with Hana". */
  label: string;
};

export type BookedAppointment = { system: string; ref: string };

/** A booking system the assistant can book into. Contact details arrive detokenised. */
export interface BookingSystem {
  readonly name: string;
  availability(q: SlotQuery): Promise<OfferedSlot[]>;
  book(input: {
    slot: OfferedSlot;
    service: string;
    client: { name: string; phone: string };
    note: string;
  }): Promise<BookedAppointment>;
}
