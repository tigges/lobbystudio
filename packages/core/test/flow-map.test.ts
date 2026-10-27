import { describe, expect, it } from "vitest";
import type { FlowState } from "@dental-bot/db/schema";
import { flowRuns } from "../src/flow-map.ts";
import { SALON_BOOKING } from "../src/runtime/flows/salon-booking.ts";

const booking = (step: string): FlowState => ({
  name: "booking_request",
  step,
  slots: {},
});
const handover = (step: string): FlowState => ({
  name: "handover",
  step,
  slots: {},
});

function ledger(...afters: (FlowState | null)[]) {
  return afters.map((flowAfter, i) => ({
    index: i + 1,
    flowBefore: i === 0 ? null : afters[i - 1]!,
    flowAfter,
  }));
}

describe("flow map", () => {
  it("follows a booking to the request being sent, showing repeats and hiding conditional steps never asked", () => {
    const [run] = flowRuns(
      ledger(
        null,
        booking("reason"),
        booking("patient"),
        booking("care"),
        booking("preferred_time"),
        booking("preferred_time"),
        booking("name"),
        booking("phone"),
        booking("confirm"),
        null,
      ),
    );
    expect(run!.title).toBe("Booking");
    expect(run!.startTurn).toBe(2);
    expect(run!.steps.map((s) => s.key)).toEqual(["reason", "patient", "care", "preferred_time", "name", "phone", "confirm"]);
    expect(run!.steps.find((s) => s.key === "preferred_time")!.turns).toEqual([5, 6]);
    expect(run!.end).toMatchObject({ kind: "sent", turn: 10 });
  });

  it("shows conditional steps once asked and where an unfinished booking stopped", () => {
    const [run] = flowRuns(ledger(booking("reason"), booking("patient"), booking("care"), booking("nhs_route")));
    expect(run!.steps.map((s) => s.key)).toContain("nhs_route");
    expect(run!.steps.find((s) => s.key === "name")!.turns).toEqual([]);
    expect(run!.end).toMatchObject({
      kind: "stopped",
      title: "Stopped at NHS route",
      turn: 4,
    });
  });

  it("splits a booking that turns into a handover into two runs", () => {
    const runs = flowRuns(
      ledger(booking("reason"), booking("patient"), handover("details"), handover("phone"), handover("name"), handover("waiting")),
      true,
    );
    expect(runs.map((r) => r.flow)).toEqual(["booking_request", "handover"]);
    expect(runs[0]!.end).toMatchObject({ kind: "passed_to_team", turn: 3 });
    expect(runs[1]!.steps.map((s) => s.key)).toEqual(["details", "phone", "name", "waiting"]);
    expect(runs[1]!.end.kind).toBe("team_replied");
  });

  it("is waiting for the team until someone replies", () => {
    const [run] = flowRuns(ledger(null, handover("waiting")));
    expect(run!.steps.find((s) => s.key === "name")!.turns).toEqual([]);
    expect(run!.end).toMatchObject({ kind: "waiting", turn: 2 });
  });

  it("follows a salon booking with the salon's steps, and says when it went to the booking system", () => {
    const at = (step: string, slots: Record<string, string> = {}): FlowState => ({ name: "booking_request", step, slots });
    const [run] = flowRuns(
      ledger(at("service"), at("length"), at("stylist"), at("patch_test"), at("preferred_time"), at("slot"), at("name"), at("phone"), at("confirm", { slot_id: "x" }), null),
      false,
      SALON_BOOKING,
    );
    expect(run!.steps.map((s) => s.title)).toEqual([
      "Service",
      "Hair length",
      "Stylist",
      "Patch test",
      "When",
      "Time",
      "Name",
      "Phone",
      "Confirm",
    ]);
    expect(run!.end).toMatchObject({ kind: "sent", title: "Sent to the booking system" });
  });

  it("has no runs when the chat never entered a flow", () => {
    expect(flowRuns(ledger(null, null))).toEqual([]);
  });
});
