import type { AIStatus, DataSource, Metric, RateWindow } from "./types";

export const unavailable = <T = number>(): Metric<T> => ({ value: null, source: "unavailable", updatedAt: null });

export const metric = <T>(value: T | null | undefined, source: DataSource, at: number): Metric<T> =>
  value === null || value === undefined ? unavailable<T>() : { value, source, updatedAt: at };

export const emptyWindow = (): RateWindow => ({ usedPercentage: unavailable(), resetsAt: null });

export function emptyStatus(provider: string, providerName: string, now = Date.now()): AIStatus {
  return {
    provider,
    providerName,
    connected: false,
    activity: "offline",
    activitySource: "derived",
    activityDetail: null,
    model: null,
    sessionId: null,
    activeSessions: 0,
    thinkingEnabled: null,
    effortLevel: null,
    context: { usedPercentage: unavailable(), inputTokens: unavailable(), outputTokens: unavailable(), windowSize: null },
    fiveHour: emptyWindow(),
    weekly: emptyWindow(),
    session: { linesAdded: unavailable(), linesRemoved: unavailable(), costUsd: unavailable() },
    updatedAt: now,
  };
}

export const clampPct = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
