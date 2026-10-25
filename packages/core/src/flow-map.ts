import type { FlowState } from "@dental-bot/db/schema";
import { BOOKING_SLOTS } from "./runtime/flows/booking-request.ts";
import { CONTACT_SLOTS } from "./runtime/flows/handover-contact.ts";

export type FlowStep = { key: string; title: string; turns: number[] };

export type FlowEnd = "sent" | "passed_to_team" | "left" | "stopped" | "waiting" | "team_replied";

export type FlowRun = {
  flow: FlowState["name"];
  title: string;
  startTurn: number;
  /** Steps in catalogue order. Steps the chat skipped have no turns; conditional steps appear only when asked. */
  steps: FlowStep[];
  end: { kind: FlowEnd; title: string; turn: number; step: string };
};

const STEP_TITLES: Record<string, string> = {
  reason: "What for",
  patient: "New or existing",
  care: "NHS or private",
  nhs_route: "NHS route",
  preferred_time: "When",
  time_of_day: "Time of day",
  name: "Name",
  phone: "Phone",
  confirm: "Confirm",
  change: "Change",
  details: "Details",
  waiting: "Waiting",
};

/** Asked only for some visitors, so an unvisited one isn't a skip worth showing. */
const SHOWN_IF_ASKED = new Set(["nhs_route", "time_of_day", "change", "details"]);

const CATALOGUE: Record<FlowState["name"], readonly string[]> = {
  booking_request: [...BOOKING_SLOTS, "change"],
  handover: ["details", ...CONTACT_SLOTS, "waiting"],
};

export function stepTitle(step: string) {
  return STEP_TITLES[step] ?? step;
}

type LedgerTurn = {
  index: number;
  flowBefore: FlowState | null;
  flowAfter: FlowState | null;
};

/**
 * One run per stretch of turns spent in a flow. A turn counts towards the step the bot asked at the end of it,
 * so a step with two turns was asked twice.
 */
export function flowRuns(turns: LedgerTurn[], teamReplied = false): FlowRun[] {
  const runs: FlowRun[] = [];
  let cur: {
    flow: FlowState["name"];
    startTurn: number;
    visits: Map<string, number[]>;
    last: string;
    lastTurn: number;
  } | null = null;

  const close = (end: FlowRun["end"] | null) => {
    if (!cur) return;
    const c = cur;
    const steps = CATALOGUE[c.flow]
      .filter((key) => c.visits.has(key) || !SHOWN_IF_ASKED.has(key))
      .map((key) => ({
        key,
        title: stepTitle(key),
        turns: c.visits.get(key) ?? [],
      }));
    runs.push({
      flow: c.flow,
      title: c.flow === "booking_request" ? "Booking" : "Handover",
      startTurn: c.startTurn,
      steps,
      end: end ?? openEnd(c.flow, c.last, c.lastTurn, teamReplied),
    });
    cur = null;
  };

  for (const t of turns) {
    const after = t.flowAfter;
    if (cur && after?.name !== cur.flow) {
      const c = cur;
      const sent = c.flow === "booking_request" && t.flowBefore?.step === "confirm" && !after;
      close(
        sent
          ? { kind: "sent", title: "Request sent", turn: t.index, step: c.last }
          : after?.name === "handover"
            ? {
                kind: "passed_to_team",
                title: "Passed to the team",
                turn: t.index,
                step: c.last,
              }
            : {
                kind: "left",
                title: `Left at ${stepTitle(c.last)}`,
                turn: t.index,
                step: c.last,
              },
      );
    }
    if (!after) continue;
    cur ??= {
      flow: after.name,
      startTurn: t.index,
      visits: new Map(),
      last: after.step,
      lastTurn: t.index,
    };
    cur.visits.set(after.step, [...(cur.visits.get(after.step) ?? []), t.index]);
    cur.last = after.step;
    cur.lastTurn = t.index;
  }
  close(null);
  return runs;
}

function openEnd(flow: FlowState["name"], step: string, turn: number, teamReplied: boolean): FlowRun["end"] {
  if (flow === "handover" && step === "waiting") {
    return teamReplied
      ? { kind: "team_replied", title: "Team replied", turn, step }
      : { kind: "waiting", title: "Waiting for the team", turn, step };
  }
  return {
    kind: "stopped",
    title: `Stopped at ${stepTitle(step)}`,
    turn,
    step,
  };
}

/** Plain names for the fixed rules that answer a turn without the planner. */
export const DECIDED_BY: Record<string, { title: string; detail: string }> = {
  clinical_precheck: {
    title: "Safety rule",
    detail: "Symptoms or urgency spotted before the planner ran",
  },
  exit_button: {
    title: "Button tapped",
    detail: "The visitor tapped a fixed button",
  },
  booking_offer: {
    title: "Offer accepted",
    detail: "The visitor said yes to the booking offer",
  },
  booking_offer_declined: {
    title: "Offer declined",
    detail: "The visitor said no to an offer",
  },
  deterministic_option: {
    title: "Quick reply",
    detail: "The visitor's words matched an option on screen",
  },
  deterministic_confirm: {
    title: "Yes or no",
    detail: "An answer to the booking summary",
  },
  booking_time_note: {
    title: "Time note",
    detail: "Asked for a fixed time; the team confirms times",
  },
  affirmation: { title: "Thanks", detail: "A thank-you or goodbye" },
  greeting: { title: "Greeting", detail: "A hello with no question" },
  open_now: {
    title: "Opening hours",
    detail: "Worked out from the hours page and the time now",
  },
  price_topic: {
    title: "Price menu",
    detail: "A broad price question, answered with a menu",
  },
  ask_team_offer: {
    title: "Ask the team",
    detail: "A reply to the offer to pass the question on",
  },
  handed_over: {
    title: "With the team",
    detail: "The chat is handed over, so the bot only collects contact details",
  },
};
