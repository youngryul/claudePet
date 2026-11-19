/**
 * Turns provider observations into persisted stats, with write throttling:
 * observations can arrive several times per second (statusLine is debounced at
 * 300ms by Claude Code), but we only write to SQLite every FLUSH_MS.
 */
import { backend, type PetProgress, type UsageSample } from "@/lib/backend";
import { xpFor } from "@/pet/xp";
import type { AIStatus, DataSource, LifecycleEvent, UsageObservation } from "@/providers/core/types";
import { localDate } from "@/utils/format";
import { computeDelta, isWindowReset, toCursor, type SessionCursor } from "./usageDelta";

const FLUSH_MS = 15_000;
const SAMPLE_MIN_INTERVAL_MS = 60_000;
const ACTIVE: AIStatus["activity"][] = ["thinking", "working", "tool"];

interface Pending {
  codingMs: number;
  sessions: number;
  turns: number;
  sessionsEnded: number;
  inputTokens: number;
  outputTokens: number;
  linesAdded: number;
  linesRemoved: number;
  costUsd: number;
}

const zero = (): Pending => ({
  codingMs: 0,
  sessions: 0,
  turns: 0,
  sessionsEnded: 0,
  inputTokens: 0,
  outputTokens: 0,
  linesAdded: 0,
  linesRemoved: 0,
  costUsd: 0,
});

interface TrackedSession {
  cursor: SessionCursor;
  model: string | null;
  ended: boolean;
  lastSeen: number;
  dirty: boolean;
  /** This session reports cost.total_api_duration_ms (preferred coding-time source). */
  hasApiDuration: boolean;
}

interface WindowTrack {
  pct: number;
  resetsAt: number | null;
  sampledAt: number;
  sampledPct: number;
}

export class UsageTracker {
  private sessions = new Map<string, TrackedSession>();
  private pending = zero();
  private xpCarry = 0;
  private windows = new Map<string, WindowTrack>();
  private samples: UsageSample[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTick: number | null = null;

  constructor(
    private readonly provider: string,
    private readonly onProgress: (p: PetProgress) => void,
  ) {}

  start() {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private enqueue(task: () => Promise<void>) {
    this.chain = this.chain.then(task).catch((e) => console.error("usage tracker", e));
    return this.chain;
  }

  private async ensureSession(sessionId: string, now: number): Promise<TrackedSession> {
    let s = this.sessions.get(sessionId);
    if (s) return s;
    const stored = toCursor(await backend.statsSessionCursor(this.provider, sessionId));
    if (!stored) this.pending.sessions += 1;
    s = {
      cursor: stored ?? { linesAdded: 0, linesRemoved: 0, costUsd: 0, apiDurationMs: 0, contextTokens: 0, lastCallKey: null },
      model: null,
      ended: false,
      lastSeen: now,
      dirty: !stored,
      hasApiDuration: false,
    };
    this.sessions.set(sessionId, s);
    return s;
  }

  observe(obs: UsageObservation) {
    return this.enqueue(async () => {
      const s = await this.ensureSession(obs.sessionId, obs.observedAt);
      const { delta, next } = computeDelta(s.cursor, obs);
      s.cursor = next;
      s.model = obs.model ?? s.model;
      s.lastSeen = obs.observedAt;
      s.dirty = true;
      if (obs.cumulative.apiDurationMs !== null) s.hasApiDuration = true;
      const p = this.pending;
      p.linesAdded += delta.linesAdded;
      p.linesRemoved += delta.linesRemoved;
      p.costUsd += delta.costUsd;
      p.codingMs += delta.apiDurationMs;
      p.inputTokens += delta.inputTokens;
      p.outputTokens += delta.outputTokens;
      const source = obs.limitsSource ?? "claude_statusline";
      this.trackWindow("five_hour", obs.fiveHourPct, obs.fiveHourResetsAt, obs.observedAt, source);
      this.trackWindow("seven_day", obs.weeklyPct, obs.weeklyResetsAt, obs.observedAt, source);
    });
  }

  lifecycle(e: LifecycleEvent) {
    return this.enqueue(async () => {
      const s = await this.ensureSession(e.sessionId, e.at);
      s.lastSeen = e.at;
      if (e.kind === "turn_complete") this.pending.turns += 1;
      if (e.kind === "session_end" && !s.ended) {
        s.ended = true;
        s.dirty = true;
        this.pending.sessionsEnded += 1;
      }
    }).then(() => (e.kind === "session_end" ? this.flush() : undefined));
  }

  /**
   * Fallback coding time for sessions that do not report api duration: time spent in
   * an active state (DERIVED). Called on every status update.
   */
  activityTick(status: AIStatus, now: number) {
    const prev = this.lastActivityTick;
    this.lastActivityTick = now;
    if (prev === null || !ACTIVE.includes(status.activity) || !status.sessionId) return;
    const s = this.sessions.get(status.sessionId);
    if (s?.hasApiDuration) return;
    this.pending.codingMs += Math.min(now - prev, 5_000);
  }

  private trackWindow(metric: string, pct: number | null, resetsAt: number | null, now: number, source: DataSource) {
    if (pct === null) return;
    const prev = this.windows.get(metric) ?? null;
    const reset = isWindowReset(prev, { pct, resetsAt });
    const due =
      !prev || reset || (Math.abs(pct - prev.sampledPct) >= 1 && now - prev.sampledAt >= SAMPLE_MIN_INTERVAL_MS);
    if (due) {
      this.samples.push({
        ts: now,
        provider: this.provider,
        metric,
        value: pct,
        source,
        resetDetected: reset,
      });
    }
    this.windows.set(metric, {
      pct,
      resetsAt,
      sampledAt: due ? now : (prev?.sampledAt ?? now),
      sampledPct: due ? pct : (prev?.sampledPct ?? pct),
    });
  }

  flush() {
    return this.enqueue(async () => {
      const p = this.pending;
      const dirty = [...this.sessions.entries()].filter(([, s]) => s.dirty);
      const hasWork = Object.values(p).some((v) => v > 0) || dirty.length > 0;
      if (this.samples.length) {
        const samples = this.samples;
        this.samples = [];
        await backend.statsRecordSamples(samples).catch(() => this.samples.unshift(...samples));
      }
      if (!hasWork) return;

      const rawXp =
        xpFor({
          codingMs: p.codingMs,
          linesAdded: p.linesAdded,
          linesRemoved: p.linesRemoved,
          turns: p.turns,
          sessionsEnded: p.sessionsEnded,
          outputTokens: p.outputTokens,
        }) + this.xpCarry;
      const xp = Math.floor(rawXp);

      this.pending = zero();
      dirty.forEach(([, s]) => (s.dirty = false));
      try {
        const progress = await backend.statsApply({
          date: localDate(new Date()),
          provider: this.provider,
          codingMs: Math.round(p.codingMs),
          sessions: p.sessions,
          turns: p.turns,
          inputTokens: p.inputTokens,
          outputTokens: p.outputTokens,
          linesAdded: p.linesAdded,
          linesRemoved: p.linesRemoved,
          costUsd: p.costUsd,
          xp,
          cursors: dirty.map(([sessionId, s]) => ({
            sessionId,
            model: s.model,
            ended: s.ended,
            cursor: s.cursor,
            lastSeen: s.lastSeen,
          })),
        });
        this.xpCarry = rawXp - xp;
        this.onProgress(progress);
      } catch (e) {
        // Put the numbers back; they will be retried on the next flush.
        for (const k of Object.keys(p) as (keyof Pending)[]) this.pending[k] += p[k];
        dirty.forEach(([, s]) => (s.dirty = true));
        throw e;
      }
      // Forget ended sessions once persisted.
      for (const [id, s] of this.sessions) if (s.ended && !s.dirty) this.sessions.delete(id);
    });
  }
}
