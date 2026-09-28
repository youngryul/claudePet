/**
 * Delta computation between consecutive usage observations of one session.
 *
 * What is cumulative vs. a gauge (per the Claude Code statusLine docs):
 *  - cost.total_lines_added / removed, total_cost_usd, total_api_duration_ms:
 *    cumulative per session  -> delta = current - previous.
 *  - context_window.total_input_tokens / total_output_tokens:
 *    a GAUGE of the current context (shrinks on /compact)  -> never summed directly.
 *  - context_window.current_usage: tokens of the most recent API call. We add it once
 *    per distinct call (fingerprinted), which approximates processed tokens.
 *
 * A counter that goes *down* means the session restarted (or /clear reused the id):
 * we treat it as a reset and count the new value from zero - never a negative delta.
 */
import type { UsageObservation } from "@/providers/core/types";

export interface SessionCursor {
  linesAdded: number;
  linesRemoved: number;
  costUsd: number;
  apiDurationMs: number;
  contextTokens: number;
  lastCallKey: string | null;
}

export interface UsageDelta {
  linesAdded: number;
  linesRemoved: number;
  costUsd: number;
  apiDurationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export const ZERO_DELTA: UsageDelta = {
  linesAdded: 0,
  linesRemoved: 0,
  costUsd: 0,
  apiDurationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
};

export const emptyCursor = (): SessionCursor => ({
  linesAdded: 0,
  linesRemoved: 0,
  costUsd: 0,
  apiDurationMs: 0,
  contextTokens: 0,
  lastCallKey: null,
});

/** Accept a cursor loaded from the DB defensively. */
export function toCursor(v: unknown): SessionCursor | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  return {
    linesAdded: n("linesAdded"),
    linesRemoved: n("linesRemoved"),
    costUsd: n("costUsd"),
    apiDurationMs: n("apiDurationMs"),
    contextTokens: n("contextTokens"),
    lastCallKey: typeof o.lastCallKey === "string" ? o.lastCallKey : null,
  };
}

/** Monotonic counter delta with reset detection. `null` = field unavailable. */
export function counterDelta(prev: number, cur: number | null): { delta: number; next: number; reset: boolean } {
  if (cur === null || !Number.isFinite(cur) || cur < 0) return { delta: 0, next: prev, reset: false };
  if (cur < prev) return { delta: cur, next: cur, reset: true };
  return { delta: cur - prev, next: cur, reset: false };
}

export interface DeltaResult {
  delta: UsageDelta;
  next: SessionCursor;
  resetDetected: boolean;
}

export function computeDelta(prev: SessionCursor | null, obs: UsageObservation): DeltaResult {
  const base = prev ?? emptyCursor();
  const la = counterDelta(base.linesAdded, obs.cumulative.linesAdded);
  const lr = counterDelta(base.linesRemoved, obs.cumulative.linesRemoved);
  const cost = counterDelta(base.costUsd, obs.cumulative.costUsd);
  const api = counterDelta(base.apiDurationMs, obs.cumulative.apiDurationMs);

  let inputTokens = 0;
  let outputTokens = 0;
  let lastCallKey = base.lastCallKey;
  const ctx = obs.contextTokens;
  if (obs.lastCall) {
    const c = obs.lastCall;
    const key = `${c.inputTokens}|${c.outputTokens}|${c.cacheCreationTokens}|${c.cacheReadTokens}`;
    if (key !== base.lastCallKey && (c.inputTokens || c.outputTokens || c.cacheCreationTokens)) {
      // Fresh input = uncached input + newly cached input (cache reads are re-reads).
      inputTokens = c.inputTokens + c.cacheCreationTokens;
      outputTokens = c.outputTokens;
      lastCallKey = key;
    }
  } else if (ctx !== null && ctx > base.contextTokens) {
    // Fallback: growth of the context gauge.
    inputTokens = ctx - base.contextTokens;
  }

  return {
    delta: {
      linesAdded: la.delta,
      linesRemoved: lr.delta,
      costUsd: cost.delta,
      apiDurationMs: api.delta,
      inputTokens,
      outputTokens,
    },
    next: {
      linesAdded: la.next,
      linesRemoved: lr.next,
      costUsd: cost.next,
      apiDurationMs: api.next,
      contextTokens: ctx ?? base.contextTokens,
      lastCallKey,
    },
    resetDetected: la.reset || lr.reset || cost.reset || api.reset,
  };
}

/**
 * Subscription window (5h / weekly) reset detection. A drop like 72% -> 4% is a new
 * window, not negative usage. A later `resets_at` also marks a new window.
 */
export function isWindowReset(
  prev: { pct: number; resetsAt: number | null } | null,
  cur: { pct: number; resetsAt: number | null },
): boolean {
  if (!prev) return false;
  if (prev.resetsAt !== null && cur.resetsAt !== null && cur.resetsAt > prev.resetsAt + 60_000) return true;
  return cur.pct < prev.pct - 1;
}
