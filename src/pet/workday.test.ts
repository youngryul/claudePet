import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, isValidSchedule, parseHM, pickIndex, workPhase, type WorkSchedule } from "./workday";

const s: WorkSchedule = { ...DEFAULT_SCHEDULE, enabled: true };
// 2026-11-17 is a Tuesday.
const at = (hm: string, sec = 0, day = 17) => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 10, day, h, m, sec);
};

describe("workPhase", () => {
  it("walks through the day", () => {
    expect(workPhase(s, at("06:00"))).toEqual({ kind: "off" }); // more than 2h before work
    expect(workPhase(s, at("08:30"))).toEqual({ kind: "beforeWork", minutesLeft: 30 });
    expect(workPhase(s, at("09:00"))).toEqual({ kind: "morning", minutesLeft: 180 });
    expect(workPhase(s, at("11:59", 30))).toEqual({ kind: "morning", minutesLeft: 1 });
    expect(workPhase(s, at("12:10"))).toEqual({ kind: "lunch", minutesLeft: 50 });
    expect(workPhase(s, at("13:00"))).toEqual({ kind: "afternoon", minutesLeft: 300 });
    expect(workPhase(s, at("17:15", 20))).toEqual({ kind: "afternoon", minutesLeft: 45 });
    expect(workPhase(s, at("18:00"))).toEqual({ kind: "done" });
  });

  it("is off when disabled, on weekends or with a bad schedule", () => {
    expect(workPhase({ ...s, enabled: false }, at("10:00"))).toEqual({ kind: "off" });
    expect(workPhase(s, at("10:00", 0, 21))).toEqual({ kind: "off" }); // Saturday
    expect(workPhase({ ...s, lunchStart: "08:00" }, at("10:00"))).toEqual({ kind: "off" });
  });
});

describe("helpers", () => {
  it("parses HH:MM", () => {
    expect(parseHM("09:30")).toBe(570);
    expect(parseHM("24:00")).toBeNull();
    expect(parseHM("nope")).toBeNull();
  });

  it("validates order", () => {
    expect(isValidSchedule(s)).toBe(true);
    expect(isValidSchedule({ ...s, workEnd: "12:30" })).toBe(false);
  });

  it("never repeats the previous cheer", () => {
    for (let r = 0; r < 1; r += 0.1) expect(pickIndex(5, 2, () => r)).not.toBe(2);
    expect(pickIndex(1, 0)).toBe(0);
  });
});
