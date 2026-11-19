import { describe, expect, it } from "vitest";
import { resolvePetState } from "./PetStateMachine";

describe("resolvePetState", () => {
  it.each([
    ["offline", "sleeping"],
    ["idle", "idle"],
    ["working", "coding"],
    ["thinking", "running"],
    ["tool", "running"],
    ["waiting", "looking_at_user"],
    ["completed", "celebrating"],
    ["error", "dizzy"],
  ] as const)("maps %s -> %s", (activity, state) => {
    expect(resolvePetState({ activity }).state).toBe(state);
  });

  it("lunch break shows eating unless something needs attention", () => {
    expect(resolvePetState({ activity: "offline", lunch: true }).state).toBe("eating");
    expect(resolvePetState({ activity: "working", lunch: true }).state).toBe("eating");
    expect(resolvePetState({ activity: "error", lunch: true }).state).toBe("dizzy");
    expect(resolvePetState({ activity: "waiting", lunch: true }).state).toBe("looking_at_user");
  });

  it("cheer-up minutes show cheering unless something needs attention", () => {
    expect(resolvePetState({ activity: "working", cheer: true }).state).toBe("cheering");
    expect(resolvePetState({ activity: "error", cheer: true }).state).toBe("dizzy");
  });
});
