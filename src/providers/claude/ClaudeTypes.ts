/**
 * Claude Code payload shapes, per the official docs:
 *  - statusLine: https://code.claude.com/docs/en/statusline
 *  - hooks:      https://code.claude.com/docs/en/hooks
 *
 * EVERY field is optional/nullable: fields vary by Claude Code version, plan
 * (rate_limits is Pro/Max only and absent before the first API response) and model.
 */

export interface ClaudeStatusLinePayload {
  session_id?: string | null;
  session_name?: string | null;
  version?: string | null;
  model?: { id?: string | null; display_name?: string | null } | null;
  workspace?: { current_dir?: string | null; project_dir?: string | null } | null;
  cost?: {
    total_cost_usd?: number | null;
    total_duration_ms?: number | null;
    total_api_duration_ms?: number | null;
    total_lines_added?: number | null;
    total_lines_removed?: number | null;
  } | null;
  context_window?: {
    total_input_tokens?: number | null;
    total_output_tokens?: number | null;
    context_window_size?: number | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: {
      input_tokens?: number | null;
      output_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    } | null;
  } | null;
  exceeds_200k_tokens?: boolean | null;
  effort?: { level?: string | null } | null;
  thinking?: { enabled?: boolean | null } | null;
  rate_limits?: {
    five_hour?: { used_percentage?: number | null; resets_at?: number | null } | null;
    seven_day?: { used_percentage?: number | null; resets_at?: number | null } | null;
  } | null;
}

/** Hook events we subscribe to (all exist in Claude Code >= 2.1.78). */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "SessionEnd",
] as const;

export type ClaudeHookEventName = (typeof CLAUDE_HOOK_EVENTS)[number];

/** RAW_EVENT: a hook payload as delivered by Claude Code. */
export interface ClaudeHookPayload {
  hook_event_name?: string | null;
  session_id?: string | null;
  cwd?: string | null;
  permission_mode?: string | null;
  agent_id?: string | null;
  // SessionStart
  source?: string | null;
  model?: string | null;
  // tools
  tool_name?: string | null;
  is_interrupt?: boolean | null;
  // Notification
  notification_type?: string | null;
  message?: string | null;
  // StopFailure
  error?: string | null;
  error_details?: string | null;
  // SessionEnd
  reason?: string | null;
  /** Added by our hook CLI: token usage of the latest response, read from the transcript. */
  transcript_usage?: {
    message_id?: string | null;
    model?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null;
}

/** Envelope emitted by the Rust collector (`collector://event`). */
export interface CollectorEvent {
  provider: string;
  channel: "statusline" | "hook" | "selftest";
  receivedAt: number;
  payload: unknown;
}

export interface CollectorSnapshot {
  port: number | null;
  lastStatusline: CollectorEvent | null;
  recentHooks: CollectorEvent[];
  lastEventAt: number | null;
}
