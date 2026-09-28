import { describe, expect, it } from "vitest";
import type { UsageObservation } from "@/providers/core/types";
import { computeDelta, counterDelta, isWindowReset } from "./usageDelta";

const obs = (o: Partial<UsageObservation> & { lines?: number; api?: number }): UsageObservation => ({
  provider: "claude",
  sessionId: "s",
  model: null,
  observedAt: 0,
  cumulative: { linesAdded: o.lines ?? null, linesRemoved: null, costUsd: null, apiDurationMs: o.api ?? null },
  lastCall: o.lastCall ?? null,
  contextTokens: o.contextTokens ?? null,
  fiveHourPct: null,
  fiveHourResetsAt: null,
  weeklyPct: null,
  weeklyResetsAt: null,
});

describe("counterDelta", () => {
  it("computes increments", () => expect(counterDelta(15000, 17000)).toEqual({ delta: 2000, next: 17000, reset: false }));
  it("treats decreases as resets, never negative", () => expect(counterDelta(500, 20)).toEqual({ delta: 20, next: 20, reset: true }));
  it("ignores missing values", () => expect(counterDelta(5, null)).toEqual({ delta: 0, next: 5, reset: false }));
});

describe("computeDelta", () => {
  it("does not double count repeated observations", () => {
    const a = computeDelta(null, obs({ lines: 10, api: 1000 }));
    expect(a.delta.linesAdded).toBe(10);
    const b = computeDelta(a.next, obs({ lines: 10, api: 1000 }));
    expect(b.delta.linesAdded).toBe(0);
    expect(b.delta.apiDurationMs).toBe(0);
    const c = computeDelta(b.next, obs({ lines: 25, api: 4000 }));
    expect(c.delta.linesAdded).toBe(15);
    expect(c.delta.apiDurationMs).toBe(3000);
  });

  it("counts each API call's tokens once", () => {
    const call = { inputTokens: 10, outputTokens: 200, cacheCreationTokens: 500, cacheReadTokens: 9000 };
    const a = computeDelta(null, obs({ lastCall: call, contextTokens: 9510 }));
    expect(a.delta).toMatchObject({ inputTokens: 510, outputTokens: 200 });
    const b = computeDelta(a.next, obs({ lastCall: call, contextTokens: 9510 }));
    expect(b.delta).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it("never sums the context gauge when it shrinks (compaction)", () => {
    const a = computeDelta(null, obs({ contextTokens: 150_000 }));
    const b = computeDelta(a.next, obs({ contextTokens: 20_000 }));
    expect(b.delta.inputTokens).toBe(0);
    const c = computeDelta(b.next, obs({ contextTokens: 25_000 }));
    expect(c.delta.inputTokens).toBe(5_000);
  });
});

describe("isWindowReset", () => {
  it("72% -> 4% is a reset", () => expect(isWindowReset({ pct: 72, resetsAt: null }, { pct: 4, resetsAt: null })).toBe(true));
  it("rising usage is not", () => expect(isWindowReset({ pct: 40, resetsAt: 1 }, { pct: 45, resetsAt: 1 })).toBe(false));
  it("a later resets_at is a new window", () =>
    expect(isWindowReset({ pct: 3, resetsAt: 0 }, { pct: 5, resetsAt: 5 * 3600_000 })).toBe(true));
});
