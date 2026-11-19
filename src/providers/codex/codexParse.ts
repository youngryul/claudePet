/**
 * Null-safe parsing of Codex CLI hook payloads as forwarded by our collector
 * (https://learn.chatgpt.com/docs/hooks). The collector keeps only whitelisted fields
 * and adds numbers-only `rollout_usage` read from the session log, whose format is
 * internal to Codex — so every field here is optional.
 */

export interface CodexTokens {
  input: number;
  cachedInput: number;
  output: number;
  total: number;
}

export interface CodexRateWindow {
  usedPercent: number;
  windowMinutes: number | null;
  /** Epoch ms, resolved against the event time when only "seconds from now" is known. */
  resetsAt: number | null;
}

export interface CodexRolloutUsage {
  last: CodexTokens | null;
  contextWindow: number | null;
  fiveHour: CodexRateWindow | null;
  weekly: CodexRateWindow | null;
}

export interface ParsedCodexHook {
  event: string;
  sessionId: string | null;
  turnId: string | null;
  model: string | null;
  toolName: string | null;
  /** SessionStart: startup | resume | clear | compact | fork. */
  source: string | null;
  /** PostModelRequest: completed | failed | cancelled. */
  status: string | null;
  error: string | null;
  isSubagent: boolean;
  tokenUsage: CodexTokens | null;
  rollout: CodexRolloutUsage | null;
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseTokens(v: unknown): CodexTokens | null {
  const o = obj(v);
  if (!o) return null;
  const input = num(o.input_tokens);
  const output = num(o.output_tokens);
  if (input === null && output === null) return null;
  const cachedInput = num(o.cached_input_tokens) ?? 0;
  return {
    input: input ?? 0,
    cachedInput,
    output: output ?? 0,
    total: num(o.total_tokens) ?? (input ?? 0) + (output ?? 0),
  };
}

function parseWindow(v: unknown, receivedAt: number): CodexRateWindow | null {
  const o = obj(v);
  const usedPercent = num(o?.used_percent);
  if (!o || usedPercent === null) return null;
  const at = num(o.resets_at);
  const inSec = num(o.resets_in_seconds);
  return {
    usedPercent,
    windowMinutes: num(o.window_minutes),
    resetsAt: at !== null ? at * 1000 : inSec !== null ? receivedAt + inSec * 1000 : null,
  };
}

/** A weekly window is 10080 minutes; anything up to a day counts as the short one. */
const isWeekly = (w: CodexRateWindow) => w.windowMinutes !== null && w.windowMinutes > 24 * 60;

export function parseRollout(v: unknown, receivedAt: number): CodexRolloutUsage | null {
  const o = obj(v);
  if (!o) return null;
  const windows = [parseWindow(o.primary, receivedAt), parseWindow(o.secondary, receivedAt)];
  let fiveHour: CodexRateWindow | null = null;
  let weekly: CodexRateWindow | null = null;
  windows.forEach((w, i) => {
    if (!w) return;
    // Classify by length when known; otherwise primary = 5h, secondary = weekly.
    const week = w.windowMinutes !== null ? isWeekly(w) : i === 1;
    if (week) weekly ??= w;
    else fiveHour ??= w;
  });
  return { last: parseTokens(o.last), contextWindow: num(o.context_window), fiveHour, weekly };
}

export function parseCodexHook(payload: unknown, receivedAt: number): ParsedCodexHook | null {
  const p = obj(payload);
  const event = str(p?.hook_event_name);
  if (!p || !event) return null;
  return {
    event,
    sessionId: str(p.session_id),
    turnId: str(p.turn_id),
    model: str(p.model),
    toolName: str(p.tool_name),
    source: str(p.source),
    status: str(p.status),
    error: str(p.error),
    isSubagent: str(p.agent_id) !== null,
    tokenUsage: parseTokens(p.token_usage),
    rollout: parseRollout(p.rollout_usage, receivedAt),
  };
}
