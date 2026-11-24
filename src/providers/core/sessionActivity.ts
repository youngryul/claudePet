/**
 * Per-session activity shared by every hook-based provider (Claude Code, Codex):
 * the session record, time-based decay, which session wins, and when to call the
 * agent offline. Each provider maps its own hook events onto `SessionActivity`.
 */
import type { AIActivityState, DataSource } from "./types";

export interface SessionActivity {
  sessionId: string;
  activity: AIActivityState;
  source: DataSource;
  detail: string | null;
  /** When `activity` last changed. */
  since: number;
  /** Last raw event of any kind for this session. */
  lastEventAt: number;
  ended: boolean;
  /** Hooks have been seen for this session (so heuristics must not override them). */
  hooksSeen: boolean;
  lastStatusSignature: string | null;
}

/** Decay timings (ms). */
export const DECAY = {
  completedToIdle: 6_000,
  errorToIdle: 30_000,
  /** Model generating/thinking with no event at all: probably interrupted (Esc). */
  staleActive: 3 * 60_000,
  /** A tool can legitimately run for a long time (tests, builds). */
  staleTool: 15 * 60_000,
  /** Heuristic "working" from statusLine changes only. */
  heuristicWorking: 15_000,
} as const;

export function newSession(sessionId: string, now: number): SessionActivity {
  return {
    sessionId,
    activity: "idle",
    source: "derived",
    detail: null,
    since: now,
    lastEventAt: now,
    ended: false,
    hooksSeen: false,
    lastStatusSignature: null,
  };
}

/** Set an activity reported by a hook (`source`), keeping `since` if nothing changed. */
export function setFromHook(
  s: SessionActivity,
  source: DataSource,
  activity: AIActivityState,
  now: number,
  detail: string | null = null,
): SessionActivity {
  return {
    ...s,
    activity,
    detail,
    source,
    since: s.activity === activity && s.detail === detail ? s.since : now,
    lastEventAt: now,
    hooksSeen: true,
  };
}

/** Time-based transitions (DERIVED_STATE). Pure: returns the same object if unchanged. */
export function decay(s: SessionActivity, now: number): SessionActivity {
  const age = now - s.since;
  const quiet = now - s.lastEventAt;
  const to = (activity: AIActivityState): SessionActivity => ({ ...s, activity, source: "derived", detail: null, since: now });
  switch (s.activity) {
    case "completed":
      return age > DECAY.completedToIdle ? to("idle") : s;
    case "error":
      return age > DECAY.errorToIdle ? to("idle") : s;
    case "tool":
      return quiet > DECAY.staleTool ? to("idle") : s;
    case "thinking":
    case "working":
      if (s.source === "derived" && !s.hooksSeen) return quiet > DECAY.heuristicWorking ? to("idle") : s;
      return quiet > DECAY.staleActive ? to("idle") : s;
    default:
      return s;
  }
}

/** Which state wins when several sessions (or agents) run at once. */
export const SALIENCE: Record<AIActivityState, number> = {
  error: 7,
  waiting: 6,
  completed: 5,
  tool: 4,
  working: 3,
  thinking: 2,
  idle: 1,
  offline: 0,
};

export function mostSalient(sessions: SessionActivity[]): SessionActivity | null {
  let best: SessionActivity | null = null;
  for (const s of sessions) {
    if (s.ended) continue;
    if (
      !best ||
      SALIENCE[s.activity] > SALIENCE[best.activity] ||
      (SALIENCE[s.activity] === SALIENCE[best.activity] && s.lastEventAt > best.lastEventAt)
    ) {
      best = s;
    }
  }
  return best;
}

export interface OfflineInput {
  liveSessions: number;
  processRunning: boolean | null;
  lastEventAt: number | null;
  now: number;
}

/** No agent process -> offline. Unknown process state -> rely on recent events. */
export function isOffline({ liveSessions, processRunning, lastEventAt, now }: OfflineInput): boolean {
  if (processRunning === false) return true;
  if (processRunning === true) return false;
  if (liveSessions === 0) return true;
  return lastEventAt === null || now - lastEventAt > 30 * 60_000;
}
