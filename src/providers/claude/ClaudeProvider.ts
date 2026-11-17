import { backend } from "@/lib/backend";
import { Emitter } from "../core/Emitter";
import { clampPct, emptyStatus, metric, unavailable } from "../core/metric";
import type {
  AIProvider,
  AIStatus,
  AIUsage,
  LifecycleEvent,
  Metric,
  ProviderCapabilities,
  RateWindow,
  UsageObservation,
} from "../core/types";
import { decay, isOffline, mostSalient, newSession, reduceHook, reduceStatusLine, type SessionActivity } from "./ClaudeActivity";
import { ClaudeCollector } from "./ClaudeCollector";
import type { CollectorEvent } from "./ClaudeTypes";
import { parseHook, parseStatusLine, type HookUsage, type ParsedStatusLine } from "./claudeParse";

const TICK_MS = 1_000;
const PROCESS_POLL_MS = 5_000;
const SESSION_TTL_MS = 6 * 3600_000;
const UNKNOWN_SESSION = "unknown";

interface StatusEntry {
  parsed: ParsedStatusLine;
  at: number;
}

interface HookUsageEntry {
  usage: HookUsage;
  at: number;
}

/** Without a statusLine the window size is unknown: assume the standard 200K, or 1M once
 *  the context has grown past 200K (only the 1M window allows that). */
const guessWindow = (tokens: number) => (tokens > 200_000 ? 1_000_000 : 200_000);

interface RateEntry {
  pct: number;
  resetsAt: number | null;
  at: number;
}

export class ClaudeProvider implements AIProvider {
  readonly id = "claude";
  readonly name = "Claude Code";
  readonly implemented = true;
  readonly capabilities: ProviderCapabilities = {
    activity: true,
    contextUsage: true,
    subscriptionLimits: true,
    tokenCounts: true,
    codeChanges: true,
  };

  private sessions = new Map<string, SessionActivity>();
  private statusLines = new Map<string, StatusEntry>();
  /** Token usage from hooks; the only source in the desktop app and IDE extensions. */
  private hookUsage = new Map<string, HookUsageEntry>();
  private fiveHour: RateEntry | null = null;
  private weekly: RateEntry | null = null;
  private processRunning: boolean | null = null;
  private lastEventAt: number | null = null;
  private current: AIStatus = emptyStatus(this.id, this.name);
  private lastEmitted = "";
  private timers: ReturnType<typeof setInterval>[] = [];
  private collector = new ClaudeCollector((e, o) => this.ingest(e, o));

  private statusEmitter = new Emitter<AIStatus>();
  private usageEmitter = new Emitter<UsageObservation>();
  private lifecycleEmitter = new Emitter<LifecycleEvent>();

  constructor(private readonly now: () => number = Date.now) {}

  onStatus = (l: (s: AIStatus) => void) => this.statusEmitter.on(l);
  onUsage = (l: (o: UsageObservation) => void) => this.usageEmitter.on(l);
  onLifecycle = (l: (e: LifecycleEvent) => void) => this.lifecycleEmitter.on(l);

  async start(): Promise<void> {
    await this.pollProcess();
    await this.collector.start();
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => void this.pollProcess(), PROCESS_POLL_MS));
    this.tick();
  }

  async stop(): Promise<void> {
    this.collector.stop();
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
      this.processRunning = await backend.claudeProcessRunning();
    } catch {
      this.processRunning = null;
    }
  }

  private session(id: string, now: number): SessionActivity {
    return this.sessions.get(id) ?? newSession(id, now);
  }

  /** Entry point for collector events (also used by tests). */
  ingest(e: CollectorEvent, { replay }: { replay: boolean }): void {
    const now = replay ? e.receivedAt : this.now();
    if (e.channel === "statusline") this.onStatusLine(e.payload, now);
    else if (e.channel === "hook") this.onHook(e.payload, now, replay);
    else return;
    this.lastEventAt = Math.max(this.lastEventAt ?? 0, e.receivedAt);
    this.tick();
  }

  private onStatusLine(payload: unknown, now: number) {
    const p = parseStatusLine(payload);
    if (!p) return;
    const id = p.sessionId ?? UNKNOWN_SESSION;
    this.statusLines.set(id, { parsed: p, at: now });
    const signature = [p.contextInputTokens, p.contextOutputTokens, p.linesAdded, p.costUsd].join("|");
    this.sessions.set(id, reduceStatusLine(this.session(id, now), signature, now));

    // Rate limits are account-wide; each window may be independently absent.
    if (p.fiveHourPct !== null) this.fiveHour = { pct: p.fiveHourPct, resetsAt: p.fiveHourResetsAt, at: now };
    if (p.weeklyPct !== null) this.weekly = { pct: p.weeklyPct, resetsAt: p.weeklyResetsAt, at: now };

    if (p.sessionId) {
      this.usageEmitter.emit({
        provider: this.id,
        sessionId: p.sessionId,
        model: p.model,
        observedAt: now,
        cumulative: {
          linesAdded: p.linesAdded,
          linesRemoved: p.linesRemoved,
          costUsd: p.costUsd,
          apiDurationMs: p.apiDurationMs,
        },
        lastCall: p.lastCall,
        contextTokens: p.contextInputTokens,
        fiveHourPct: p.fiveHourPct,
        fiveHourResetsAt: p.fiveHourResetsAt,
        weeklyPct: p.weeklyPct,
        weeklyResetsAt: p.weeklyResetsAt,
      });
    }
  }

  private onHook(payload: unknown, now: number, replay: boolean) {
    const h = parseHook(payload);
    if (!h) return;
    const id = h.sessionId ?? UNKNOWN_SESSION;
    this.sessions.set(id, reduceHook(this.session(id, now), h, now));
    if (h.usage) {
      this.hookUsage.set(id, { usage: h.usage, at: now });
      // Sessions with a statusLine already report the same call; counting both would
      // double the daily token totals.
      if (!replay && h.sessionId && !this.statusLines.has(id)) {
        this.usageEmitter.emit({
          provider: this.id,
          sessionId: h.sessionId,
          model: h.usage.model,
          observedAt: now,
          cumulative: { linesAdded: null, linesRemoved: null, costUsd: null, apiDurationMs: null },
          lastCall: h.usage.lastCall,
          contextTokens: h.usage.contextTokens,
          fiveHourPct: null,
          fiveHourResetsAt: null,
          weeklyPct: null,
          weeklyResetsAt: null,
        });
      }
    }

    if (replay || !h.sessionId) return;
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

  private rateWindow(entry: RateEntry | null, now: number): RateWindow {
    if (!entry) return { usedPercentage: unavailable(), resetsAt: null };
    // Claude Code drops a window after resets_at; until the next payload we know
    // usage restarted from ~0, so show that as a derived value.
    if (entry.resetsAt !== null && now >= entry.resetsAt) {
      return { usedPercentage: { value: 0, source: "derived", updatedAt: now }, resetsAt: null };
    }
    return { usedPercentage: metric(clampPct(entry.pct), "claude_statusline", entry.at), resetsAt: entry.resetsAt };
  }

  private tick() {
    const now = this.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastEventAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.statusLines.delete(id);
        this.hookUsage.delete(id);
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
    const offline = isOffline({
      liveSessions: live.length,
      processRunning: this.processRunning,
      lastEventAt: this.lastEventAt,
      now,
    });

    // Context/session numbers come from the salient session, else the latest statusLine.
    let entry = salient ? this.statusLines.get(salient.sessionId) : undefined;
    if (!entry) {
      for (const e of this.statusLines.values()) if (!entry || e.at > entry.at) entry = e;
    }
    const p = entry?.parsed;
    const at = entry?.at ?? now;
    const sl = <T,>(v: T | null | undefined): Metric<T> => metric(v, "claude_statusline", at);

    // No statusLine context numbers (desktop app / IDE): fall back to hook token usage.
    let hu = salient ? this.hookUsage.get(salient.sessionId) : undefined;
    if (!hu) for (const e of this.hookUsage.values()) if (!hu || e.at > hu.at) hu = e;
    const useHook = (p?.contextInputTokens ?? null) === null && hu !== undefined;
    const fromHook = <T,>(v: T | null): Metric<T> => metric(v, "derived", hu?.at ?? now);
    const ctxTokens = hu?.usage.contextTokens ?? 0;
    const context = useHook
      ? {
          usedPercentage: fromHook(
            clampPct((ctxTokens / (p?.contextWindowSize ?? guessWindow(ctxTokens))) * 100),
          ),
          inputTokens: fromHook(ctxTokens),
          outputTokens: fromHook(hu?.usage.lastCall.outputTokens ?? null),
          windowSize: p?.contextWindowSize ?? guessWindow(ctxTokens),
        }
      : {
          usedPercentage: sl(clampPct(p?.contextPct)),
          inputTokens: sl(p?.contextInputTokens),
          outputTokens: sl(p?.contextOutputTokens),
          windowSize: p?.contextWindowSize ?? null,
        };

    return {
      provider: this.id,
      providerName: this.name,
      connected: this.processRunning === true || (this.lastEventAt !== null && now - this.lastEventAt < 10 * 60_000),
      activity: offline ? "offline" : (salient?.activity ?? "idle"),
      activitySource: offline
        ? this.processRunning === false
          ? "process_probe"
          : "derived"
        : (salient?.source ?? "derived"),
      activityDetail: offline ? null : (salient?.detail ?? null),
      model: p?.model ?? hu?.usage.model ?? null,
      sessionId: salient?.sessionId ?? p?.sessionId ?? null,
      activeSessions: live.length,
      thinkingEnabled: p?.thinkingEnabled ?? null,
      effortLevel: p?.effortLevel ?? null,
      context,
      fiveHour: this.rateWindow(this.fiveHour, now),
      weekly: this.rateWindow(this.weekly, now),
      session: {
        linesAdded: sl(p?.linesAdded),
        linesRemoved: sl(p?.linesRemoved),
        costUsd: sl(p?.costUsd),
      },
      updatedAt: now,
    };
  }
}
