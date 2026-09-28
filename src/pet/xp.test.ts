import { describe, expect, it } from "vitest";
import { levelFromXp, xpFor, xpForNextLevel } from "./xp";

describe("xp", () => {
  it("levels up at the documented thresholds", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1) - 1).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1)).level).toBe(2);
    const l = levelFromXp(xpForNextLevel(1) + 10);
    expect(l.intoLevel).toBe(10);
    expect(l.needed).toBe(xpForNextLevel(2));
  });
  it("awards xp for work", () => {
    expect(xpFor({ codingMs: 60_000, linesAdded: 10, linesRemoved: 20, turns: 1, sessionsEnded: 0, outputTokens: 0 })).toBe(5);
  });
});
