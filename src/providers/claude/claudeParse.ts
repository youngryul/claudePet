/** Null-safe readers. Unknown/malformed input degrades to `null`, never throws. */
import type { UsageObservation } from "../core/types";
import type { ClaudeHookPayload, ClaudeStatusLinePayload } from "./ClaudeTypes";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
export const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export interface ParsedStatusLine {
  sessionId: string | null;
  model: string | null;
  version: string | null;
  contextPct: number | null;
  contextInputTokens: number | null;
  contextOutputTokens: number | null;
  contextWindowSize: number | null;
  lastCall: UsageObservation["lastCall"];
  fiveHourPct: number | null;
  fiveHourResetsAt: number | null;
  weeklyPct: number | null;
  weeklyResetsAt: number | null;
  thinkingEnabled: boolean | null;
  effortLevel: string | null;
  costUsd: number | null;
  apiDurationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

/** resets_at is Unix epoch *seconds*; we use ms internally. */
const secToMs = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n * 1000;
};

export function parseStatusLine(raw: unknown): ParsedStatusLine | null {
  if (!isObj(raw)) return null;
  const p = raw as ClaudeStatusLinePayload;
  const cu = get(p, "context_window", "current_usage");
  const lastCall = isObj(cu)
    ? {
        inputTokens: num(cu.input_tokens) ?? 0,
        outputTokens: num(cu.output_tokens) ?? 0,
        cacheCreationTokens: num(cu.cache_creation_input_tokens) ?? 0,
        cacheReadTokens: num(cu.cache_read_input_tokens) ?? 0,
      }
    : null;
  return {
    sessionId: str(p.session_id),
    model: str(get(p, "model", "display_name")) ?? str(get(p, "model", "id")),
    version: str(p.version),
    contextPct: num(get(p, "context_window", "used_percentage")),
    contextInputTokens: num(get(p, "context_window", "total_input_tokens")),
    contextOutputTokens: num(get(p, "context_window", "total_output_tokens")),
    contextWindowSize: num(get(p, "context_window", "context_window_size")),
    lastCall,
    fiveHourPct: num(get(p, "rate_limits", "five_hour", "used_percentage")),
    fiveHourResetsAt: secToMs(get(p, "rate_limits", "five_hour", "resets_at")),
    weeklyPct: num(get(p, "rate_limits", "seven_day", "used_percentage")),
    weeklyResetsAt: secToMs(get(p, "rate_limits", "seven_day", "resets_at")),
    thinkingEnabled: bool(get(p, "thinking", "enabled")),
    effortLevel: str(get(p, "effort", "level")),
    costUsd: num(get(p, "cost", "total_cost_usd")),
    apiDurationMs: num(get(p, "cost", "total_api_duration_ms")),
    linesAdded: num(get(p, "cost", "total_lines_added")),
    linesRemoved: num(get(p, "cost", "total_lines_removed")),
  };
}

export interface ParsedHook {
  event: string;
  sessionId: string | null;
  isSubagent: boolean;
  toolName: string | null;
  isInterrupt: boolean;
  notificationType: string | null;
  error: string | null;
  source: string | null;
  model: string | null;
  /** Latest response's tokens, for clients without a statusLine (desktop app, IDEs). */
  usage: HookUsage | null;
}

export interface HookUsage {
  model: string | null;
  lastCall: NonNullable<UsageObservation["lastCall"]>;
  /** Tokens now in the context window: all input kinds of the latest call. */
  contextTokens: number;
}

function parseHookUsage(u: unknown): HookUsage | null {
  if (!isObj(u)) return null;
  const lastCall = {
    inputTokens: num(u.input_tokens) ?? 0,
    outputTokens: num(u.output_tokens) ?? 0,
    cacheCreationTokens: num(u.cache_creation_input_tokens) ?? 0,
    cacheReadTokens: num(u.cache_read_input_tokens) ?? 0,
  };
  const contextTokens = lastCall.inputTokens + lastCall.cacheCreationTokens + lastCall.cacheReadTokens;
  if (contextTokens === 0 && lastCall.outputTokens === 0) return null;
  return { model: str(u.model), lastCall, contextTokens };
}

export function parseHook(raw: unknown): ParsedHook | null {
  if (!isObj(raw)) return null;
  const p = raw as ClaudeHookPayload;
  const event = str(p.hook_event_name);
  if (!event) return null;
  return {
    event,
    sessionId: str(p.session_id),
    isSubagent: str(p.agent_id) !== null,
    toolName: str(p.tool_name),
    isInterrupt: bool(p.is_interrupt) === true,
    notificationType: str(p.notification_type),
    error: str(p.error),
    source: str(p.source),
    model: str(p.model),
    usage: parseHookUsage(p.transcript_usage),
  };
}
