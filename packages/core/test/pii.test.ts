import { describe, expect, it } from "vitest";
import { detectPii, detokenise, isValidNhsNumber, tokenise } from "../src/pii/detect.ts";

describe("detectPii", () => {
  it("finds phone numbers, emails, postcodes and dates", () => {
    const kinds = detectPii("Call 07700 900123 or +44 20 7946 0999, email sam@example.com, SE16 4ZZ, born 03/04/1988").map(
      (m) => m.kind,
    );
    expect(kinds).toEqual(["PHONE", "PHONE", "EMAIL", "POSTCODE", "DATE"]);
  });
  it("only accepts NHS numbers with a valid check digit", () => {
    expect(isValidNhsNumber("943 476 5919")).toBe(true);
    expect(isValidNhsNumber("943 476 5918")).toBe(false);
    expect(detectPii("my NHS number is 943 476 5919")[0]?.kind).toBe("NHS_NUMBER");
  });
  it("finds introduced names but not ordinary words", () => {
    expect(detectPii("Hi, I'm Sarah Collins")[0]).toMatchObject({ kind: "NAME", value: "Sarah Collins" });
    expect(detectPii("My name is Tom")[0]).toMatchObject({ kind: "NAME", value: "Tom" });
    expect(detectPii("I'm looking for a dentist")).toEqual([]);
    expect(detectPii("It's Monday")).toEqual([]);
  });
  it("treats a short reply as a name when the flow asked for one", () => {
    expect(detectPii("priya", { expectingName: true })[0]).toMatchObject({ kind: "NAME", value: "priya" });
    expect(detectPii("it's Ana Lopes.", { expectingName: true })[0]).toMatchObject({ value: "Ana Lopes" });
  });
});

describe("tokenise", () => {
  it("replaces values with stable tokens and round-trips", () => {
    const known = new Map<string, string>();
    const a = tokenise("I'm Sarah, call 07700 900123", known);
    expect(a.text).toBe("I'm ‹NAME_1›, call ‹PHONE_1›");
    const b = tokenise("again: 07700900123, or 07700 900456", known);
    expect(b.text).toBe("again: ‹PHONE_1›, or ‹PHONE_2›");
    const values = new Map([...a.created, ...b.created].map((c) => [c.token, c.value]));
    expect(detokenise(a.text, values)).toBe("I'm Sarah, call 07700 900123");
  });
  it("leaves text without personal data untouched", () => {
    expect(tokenise("How much is a check-up?", new Map()).text).toBe("How much is a check-up?");
  });
});
