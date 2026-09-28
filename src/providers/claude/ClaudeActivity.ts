/**
 * RAW_EVENT -> DERIVED_STATE for Claude Code.
 *
 * Claude Code does not report an "activity state". We derive one per session from hook
 * events (`reduceHook`), fall back to statusLine heuristics when hooks are not
 * configured (`reduceStatusLine`), and apply time-based decay (`decay`). All results
 * are tagged with where they came from.
 */
import type { AIActivityState, DataSource } from "../core/types";
import type { ParsedHook } from "./claudeParse";

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

/** Notification types that mean "Claude is waiting for the user". */
const WAITING_NOTIFICATIONS = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

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

function set(s: SessionActivity, activity: AIActivityState, now: number, detail: string | null = null): SessionActivity {
  return {
    ...s,
    activity,
    detail,
    source: "claude_hook",
    since: s.activity === activity && s.detail === detail ? s.since : now,
    lastEventAt: now,
    hooksSeen: true,
  };
}

/** Map a single hook event onto the session's activity. Unknown events only bump time. */
export function reduceHook(prev: SessionActivity, hook: ParsedHook, now: number): SessionActivity {
  const s = { ...prev, lastEventAt: now, hooksSeen: true, ended: false };
  switch (hook.event) {
    case "SessionStart":
      return set(s, "idle", now);
    case "UserPromptSubmit":
      return set(s, "thinking", now);
    case "PreToolUse":
      return set(s, "tool", now, hook.toolName);
    case "PostToolUse":
      return set(s, "working", now);
    case "PostToolUseFailure":
      return hook.isInterrupt ? set(s, "idle", now) : set(s, "working", now);
    case "PermissionRequest":
      return set(s, "waiting", now, hook.toolName);
    case "Notification":
      if (hook.notificationType && WAITING_NOTIFICATIONS.has(hook.notificationType)) {
        return set(s, "waiting", now, hook.notificationType);
      }
      if (hook.notificationType === "idle_prompt") return set(s, "idle", now);
      return s;
    case "Stop":
      // A subagent's own Stop is reported as SubagentStop, so this is the main turn.
      return set(s, "completed", now);
    case "StopFailure":
      return set(s, "error", now, hook.error ?? "unknown");
    case "SubagentStart":
    case "SubagentStop":
    case "PreCompact":
      return s.activity === "waiting" ? s : set(s, "working", now, hook.event === "PreCompact" ? "compacting" : null);
    case "SessionEnd":
      return { ...set(s, "offline", now), ended: true };
    default:
      return s;
  }
}

/**
 * Heuristic fallback when no hooks are configured: a statusLine update whose token
 * counters changed means Claude produced a response recently.
 */
export function reduceStatusLine(prev: SessionActivity, signature: string, now: number): SessionActivity {
  const changed = prev.lastStatusSignature !== null && prev.lastStatusSignature !== signature;
  const s = { ...prev, lastStatusSignature: signature, lastEventAt: now, ended: false };
  if (prev.hooksSeen || !changed) return s;
  return { ...s, activity: "working", source: "derived", detail: null, since: prev.activity === "working" ? prev.since : now };
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

/** Which session's state wins when several run at once. */
const SALIENCE: Record<AIActivityState, number> = {
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

/** No Claude process -> offline. Unknown process state -> rely on recent events. */
export function isOffline({ liveSessions, processRunning, lastEventAt, now }: OfflineInput): boolean {
  if (processRunning === false) return true;
  if (processRunning === true) return false;
  if (liveSessions === 0) return true;
  return lastEventAt === null || now - lastEventAt > 30 * 60_000;
}
