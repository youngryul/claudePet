import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, isCheerTime, isValidSchedule, parseHM, pickIndex, workPhase, type WorkSchedule } from "./workday";

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

  it("uses each weekday's own hours when per-day is on", () => {
    const friday = { workStart: "08:00", lunchStart: "11:30", lunchEnd: "12:30", workEnd: "16:00" };
    const p: WorkSchedule = { ...s, perDay: true, days: { 5: friday } };
    // Friday 2026-11-20 follows its own hours…
    expect(workPhase(p, at("08:30", 0, 20))).toEqual({ kind: "morning", minutesLeft: 180 });
    expect(workPhase(p, at("16:00", 0, 20))).toEqual({ kind: "done" });
    // …a day without its own entry falls back to the shared hours…
    expect(workPhase(p, at("08:30"))).toEqual({ kind: "beforeWork", minutesLeft: 30 });
    // …and per-day hours are ignored while the option is off.
    expect(workPhase({ ...p, perDay: false }, at("16:00", 0, 20))).toEqual({ kind: "afternoon", minutesLeft: 120 });
  });

  it("validates only the workdays' own hours", () => {
    const bad = { workStart: "18:00", lunchStart: "12:00", lunchEnd: "13:00", workEnd: "09:00" };
    expect(isValidSchedule({ ...s, perDay: true, days: { 3: bad } })).toBe(false);
    expect(isValidSchedule({ ...s, perDay: true, days: { 0: bad } })).toBe(true); // Sunday isn't a workday
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

describe("isCheerTime", () => {
  const on: WorkSchedule = { ...DEFAULT_SCHEDULE, enabled: true };
  // 2026-01-05 is a Monday; default hours 09:00 / 12:00-13:00 / 18:00.
  const mon = (hm: string, day = "2026-01-05") => new Date(`${day}T${hm}:00`);

  it.each([
    ["09:10", true],
    ["09:11", false],
    ["09:09", false],
    ["11:50", true],
    ["11:51", false],
    ["17:50", true],
    ["12:30", false],
  ])("%s -> %s", (hm, expected) => {
    expect(isCheerTime(on, mon(hm))).toBe(expected);
  });

  it("is off when the schedule is off or on a non-workday", () => {
    expect(isCheerTime(DEFAULT_SCHEDULE, mon("09:10"))).toBe(false);
    expect(isCheerTime(on, mon("09:10", "2026-01-04"))).toBe(false); // Sunday
  });
});
