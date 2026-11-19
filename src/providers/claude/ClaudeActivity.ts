/**
 * RAW_EVENT -> DERIVED_STATE for Claude Code.
 *
 * Claude Code does not report an "activity state". We derive one per session from hook
 * events (`reduceHook`), fall back to statusLine heuristics when hooks are not
 * configured (`reduceStatusLine`), and apply time-based decay (`decay`, shared with
 * other providers in `core/sessionActivity`). All results are tagged with where they
 * came from.
 */
import type { AIActivityState } from "../core/types";
import { setFromHook, type SessionActivity } from "../core/sessionActivity";
import type { ParsedHook } from "./claudeParse";

export {
  DECAY,
  decay,
  isOffline,
  mostSalient,
  newSession,
  type OfflineInput,
  type SessionActivity,
} from "../core/sessionActivity";

/** Notification types that mean "Claude is waiting for the user". */
const WAITING_NOTIFICATIONS = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

const set = (s: SessionActivity, activity: AIActivityState, now: number, detail: string | null = null) =>
  setFromHook(s, "claude_hook", activity, now, detail);

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
