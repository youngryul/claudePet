import { describe, expect, it } from "vitest";
import { resolvePetState, type PetContext } from "./PetStateMachine";

const ctx = (o: Partial<PetContext>): PetContext => ({ activity: "idle", fiveHour: null, weekly: null, context: null, ...o });

describe("resolvePetState", () => {
  it.each([
    ["offline", "sleeping"],
    ["idle", "idle"],
    ["working", "coding"],
    ["thinking", "thinking"],
    ["tool", "working"],
    ["waiting", "looking_at_user"],
    ["completed", "celebrating"],
    ["error", "dizzy"],
  ] as const)("maps %s -> %s", (activity, state) => {
    expect(resolvePetState(ctx({ activity })).state).toBe(state);
  });

  it.each([
    [10, "idle"],
    [60, "slightly_tired"],
    [70, "slightly_tired"],
    [80, "tired"],
    [90, "tired"],
    [95, "exhausted"],
    [99, "exhausted"],
  ] as const)("5h usage %i%% while idle -> %s", (fiveHour, state) => {
    expect(resolvePetState(ctx({ fiveHour })).state).toBe(state);
  });

  it("weekly usage also causes fatigue", () => {
    expect(resolvePetState(ctx({ weekly: 85 })).state).toBe("tired");
  });

  it("context thresholds", () => {
    expect(resolvePetState(ctx({ context: 85 })).state).toBe("confused");
    expect(resolvePetState(ctx({ context: 95 })).state).toBe("overwhelmed");
  });

  it("activity beats fatigue but fatigue shows as a modifier", () => {
    const r = resolvePetState(ctx({ activity: "working", fiveHour: 88 }));
    expect(r.state).toBe("coding");
    expect(r.modifiers).toContain("sweat");
  });

  it("error and completed beat everything except offline", () => {
    expect(resolvePetState(ctx({ activity: "error", context: 99, fiveHour: 99 })).state).toBe("dizzy");
    expect(resolvePetState(ctx({ activity: "completed", context: 99 })).state).toBe("celebrating");
    expect(resolvePetState(ctx({ activity: "offline", fiveHour: 99 })).modifiers).toEqual([]);
  });

  it("tired beats confused, overwhelmed beats thinking", () => {
    expect(resolvePetState(ctx({ fiveHour: 85, context: 85 })).state).toBe("tired");
    expect(resolvePetState(ctx({ activity: "thinking", context: 96 })).state).toBe("overwhelmed");
  });
});
