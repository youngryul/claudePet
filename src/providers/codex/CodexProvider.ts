/**
 * OpenAI Codex provider (CLI, desktop app, IDE extensions). The backend follows Codex's
 * session logs and turns them into hook-shaped events, so this works with no setup.
 * Optional hooks deliver the same events a little sooner; once a session has real
 * hooks, its log events are ignored so nothing is counted twice. Token usage comes
 * from PostModelRequest, context size and 5h / weekly limits from the log numbers.
 */
import { backend } from "@/lib/backend";
import { Emitter } from "../core/Emitter";
import { clampPct, emptyStatus, metric, unavailable } from "../core/metric";
import { decay, isOffline, mostSalient, newSession, type SessionActivity } from "../core/sessionActivity";
import type {
  AIProvider,
  AIStatus,
  AIUsage,
  LifecycleEvent,
  ProviderCapabilities,
  RateWindow,
  UsageObservation,
} from "../core/types";
import type { CollectorEvent } from "../claude/ClaudeTypes";
import { reduceCodexHook } from "./CodexActivity";
import { parseCodexHook, type CodexRateWindow, type CodexTokens, type ParsedCodexHook } from "./codexParse";

const TICK_MS = 1_000;
const PROCESS_POLL_MS = 5_000;
const SESSION_TTL_MS = 6 * 3600_000;
const UNKNOWN_SESSION = "unknown";

interface ContextEntry {
  tokens: number;
  window: number | null;
  at: number;
}

interface RateEntry {
  window: CodexRateWindow;
  at: number;
}

/** Codex counts cached tokens inside `input_tokens`; the tracker wants them apart. */
export function toLastCall(t: CodexTokens): NonNullable<UsageObservation["lastCall"]> {
  const cached = Math.min(t.cachedInput, t.input);
  return { inputTokens: t.input - cached, outputTokens: t.output, cacheCreationTokens: 0, cacheReadTokens: cached };
}

export class CodexProvider implements AIProvider {
  readonly id = "codex";
  readonly name = "Codex";
  readonly implemented = true;
  readonly capabilities: ProviderCapabilities = {
    activity: true,
    contextUsage: true,
    subscriptionLimits: true,
    tokenCounts: true,
    codeChanges: false,
  };

  private sessions = new Map<string, SessionActivity>();
  private context = new Map<string, ContextEntry>();
  private models = new Map<string, string>();
  /** Sessions whose PostModelRequest reports tokens: the session log is then only
   *  used for limits and context, so no call is counted twice. */
  private modelHookUsage = new Set<string>();
  /** Sessions that real hooks report on; their session-log events are dropped. */
  private hookSessions = new Set<string>();
  private fiveHour: RateEntry | null = null;
  private weekly: RateEntry | null = null;
  private processRunning: boolean | null = null;
  private lastEventAt: number | null = null;
  private current: AIStatus = emptyStatus(this.id, this.name);
  private lastEmitted = "";
  private timers: ReturnType<typeof setInterval>[] = [];
  private unlisten: (() => void) | null = null;

  private statusEmitter = new Emitter<AIStatus>();
  private usageEmitter = new Emitter<UsageObservation>();
  private lifecycleEmitter = new Emitter<LifecycleEvent>();

  constructor(private readonly now: () => number = Date.now) {}

  onStatus = (l: (s: AIStatus) => void) => this.statusEmitter.on(l);
  onUsage = (l: (o: UsageObservation) => void) => this.usageEmitter.on(l);
  onLifecycle = (l: (e: LifecycleEvent) => void) => this.lifecycleEmitter.on(l);

  async start(): Promise<void> {
    await this.pollProcess();
    this.unlisten = await backend.onCollectorEvent((e) => {
      if (e.provider === this.id) this.ingest(e, { replay: false });
    });
    // Rebuild state after a reload from the backend's buffer, without re-firing XP.
    const snap = await backend.collectorSnapshot();
    snap.recentHooks
      .filter((e) => e.provider === this.id)
      .sort((a, b) => a.receivedAt - b.receivedAt)
      .forEach((e) => this.ingest(e, { replay: true }));
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => void this.pollProcess(), PROCESS_POLL_MS));
    this.tick();
  }

  async stop(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  async getStatus(): Promise<AIStatus> {
    return this.current;
  }

  async getUsage(): Promise<AIUsage> {
    const { context, fiveHour, weekly, session } = this.current;
    return { context, fiveHour, weekly, session };
  }

  private async pollProcess() {
    try {
      this.processRunning = await backend.codexProcessRunning();
    } catch {
      this.processRunning = null;
    }
  }

  /** Entry point for collector events (also used by tests). */
  ingest(e: CollectorEvent, { replay }: { replay: boolean }): void {
    if (e.channel !== "hook") return;
    const now = replay ? e.receivedAt : this.now();
    const h = parseCodexHook(e.payload, e.receivedAt);
    if (!h) return;
    const id = h.sessionId ?? UNKNOWN_SESSION;
    if (h.fromLog && this.hookSessions.has(id)) return;
    if (!h.fromLog) this.hookSessions.add(id);
    this.sessions.set(id, reduceCodexHook(this.sessions.get(id) ?? newSession(id, now), h, now));
    if (h.model) this.models.set(id, h.model);
    this.lastEventAt = Math.max(this.lastEventAt ?? 0, e.receivedAt);
    this.onUsageData(h, id, now, replay);

    if (!replay && h.sessionId && !h.isSubagent) {
      const kind =
        h.event === "SessionStart" && h.source !== "compact"
          ? "session_start"
          : h.event === "Stop"
            ? "turn_complete"
            : h.event === "SessionEnd"
              ? "session_end"
              : null;
      if (kind) this.lifecycleEmitter.emit({ provider: this.id, sessionId: h.sessionId, kind, at: now });
    }
    this.tick();
  }

  private onUsageData(h: ParsedCodexHook, id: string, now: number, replay: boolean) {
    const r = h.rollout;
    if (r?.last) this.context.set(id, { tokens: r.last.total, window: r.contextWindow, at: now });
    if (r?.fiveHour) this.fiveHour = { window: r.fiveHour, at: now };
    if (r?.weekly) this.weekly = { window: r.weekly, at: now };

    if (h.tokenUsage) this.modelHookUsage.add(id);
    const call = h.tokenUsage ?? (this.modelHookUsage.has(id) ? null : (r?.last ?? null));
    if (replay || !h.sessionId || (!call && !r?.fiveHour && !r?.weekly)) return;
    this.usageEmitter.emit({
      provider: this.id,
      sessionId: h.sessionId,
      model: h.model ?? this.models.get(id) ?? null,
      observedAt: now,
      cumulative: { linesAdded: null, linesRemoved: null, costUsd: null, apiDurationMs: null },
      lastCall: call ? toLastCall(call) : null,
      contextTokens: null,
      fiveHourPct: r?.fiveHour?.usedPercent ?? null,
      fiveHourResetsAt: r?.fiveHour?.resetsAt ?? null,
      weeklyPct: r?.weekly?.usedPercent ?? null,
      weeklyResetsAt: r?.weekly?.resetsAt ?? null,
      limitsSource: "codex_rollout",
    });
  }

  private rateWindow(entry: RateEntry | null, now: number): RateWindow {
    if (!entry) return { usedPercentage: unavailable(), resetsAt: null };
    const { usedPercent, resetsAt } = entry.window;
    if (resetsAt !== null && now >= resetsAt) {
      return { usedPercentage: { value: 0, source: "derived", updatedAt: now }, resetsAt: null };
    }
    return { usedPercentage: metric(clampPct(usedPercent), "codex_rollout", entry.at), resetsAt };
  }

  private tick() {
    const now = this.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastEventAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.context.delete(id);
        this.models.delete(id);
        this.modelHookUsage.delete(id);
        this.hookSessions.delete(id);
        continue;
      }
      const next = decay(s, now);
      if (next !== s) this.sessions.set(id, next);
    }
    this.current = this.compute(now);
    const key = JSON.stringify({ ...this.current, updatedAt: 0 });
    if (key !== this.lastEmitted) {
      this.lastEmitted = key;
      this.statusEmitter.emit(this.current);
    }
  }

  private compute(now: number): AIStatus {
    const live = [...this.sessions.values()].filter((s) => !s.ended);
    const salient = mostSalient(live);
    const offline = isOffline({ liveSessions: live.length, processRunning: this.processRunning, lastEventAt: this.lastEventAt, now });

    let ctx = salient ? this.context.get(salient.sessionId) : undefined;
    if (!ctx) for (const c of this.context.values()) if (!ctx || c.at > ctx.at) ctx = c;
    const c = <T,>(v: T | null | undefined) => metric(v, "codex_rollout", ctx?.at ?? now);
    const sessionId = salient?.sessionId ?? null;

    return {
      ...emptyStatus(this.id, this.name, now),
      connected: this.processRunning === true || (this.lastEventAt !== null && now - this.lastEventAt < 10 * 60_000),
      activity: offline ? "offline" : (salient?.activity ?? "idle"),
      activitySource: offline ? (this.processRunning === false ? "process_probe" : "derived") : (salient?.source ?? "derived"),
      activityDetail: offline ? null : (salient?.detail ?? null),
      model: (sessionId && this.models.get(sessionId)) || null,
      sessionId,
      activeSessions: live.length,
      context: {
        usedPercentage: c(ctx?.window ? clampPct((ctx.tokens / ctx.window) * 100) : null),
        inputTokens: c(ctx?.tokens),
        outputTokens: unavailable(),
        windowSize: ctx?.window ?? null,
      },
      fiveHour: this.rateWindow(this.fiveHour, now),
      weekly: this.rateWindow(this.weekly, now),
    };
  }
}
