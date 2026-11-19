/**
 * RAW_EVENT -> DERIVED_STATE for Codex CLI. Codex hooks mirror Claude Code's closely;
 * the differences are PostModelRequest (outcome of each model call), Interrupt (Esc)
 * and the absence of a Notification event. Decay and salience are shared
 * (`core/sessionActivity`).
 */
import type { AIActivityState } from "../core/types";
import { setFromHook, type SessionActivity } from "../core/sessionActivity";
import type { ParsedCodexHook } from "./codexParse";

const set = (s: SessionActivity, activity: AIActivityState, now: number, detail: string | null = null) =>
  setFromHook(s, "codex_hook", activity, now, detail);

export function reduceCodexHook(prev: SessionActivity, hook: ParsedCodexHook, now: number): SessionActivity {
  const s = { ...prev, lastEventAt: now, hooksSeen: true, ended: false };
  // Subagents share the parent's session id; their own start/stop must not end the
  // parent's turn, so they only keep the session busy.
  if (hook.isSubagent && hook.event !== "PreToolUse" && hook.event !== "PermissionRequest") {
    return s.activity === "waiting" ? s : set(s, "working", now);
  }
  switch (hook.event) {
    case "SessionStart":
      return set(s, "idle", now);
    case "UserPromptSubmit":
      return set(s, "thinking", now);
    case "PreToolUse":
      return set(s, "tool", now, hook.toolName);
    case "PostToolUse":
      return set(s, "working", now);
    case "PermissionRequest":
      return set(s, "waiting", now, hook.toolName);
    case "PostModelRequest":
      if (hook.status === "failed") return set(s, "error", now, hook.error ?? "model_request_failed");
      if (hook.status === "cancelled") return set(s, "idle", now);
      // A tool call or the final answer follows; keep a running tool as it is.
      return s.activity === "tool" || s.activity === "waiting" ? s : set(s, "working", now);
    case "PreCompact":
      return set(s, "working", now, "compacting");
    case "PostCompact":
    case "SubagentStart":
    case "SubagentStop":
      return s.activity === "waiting" ? s : set(s, "working", now);
    case "Stop":
      return set(s, "completed", now);
    case "Interrupt":
      return set(s, "idle", now);
    case "SessionEnd":
      return { ...set(s, "offline", now), ended: true };
    default:
      return s;
  }
}
