import { describe, expect, it, vi } from "vitest";
import type { LifecycleEvent, UsageObservation } from "../core/types";
import { newSession } from "../core/sessionActivity";
import { reduceCodexHook } from "./CodexActivity";
import { CodexProvider, toLastCall } from "./CodexProvider";
import { parseCodexHook, parseRollout } from "./codexParse";

vi.mock("@/lib/backend", () => ({ backend: {} }));

const hook = (e: Record<string, unknown>) => parseCodexHook({ session_id: "s", ...e }, 1_000)!;

describe("parseRollout", () => {
  it("classifies windows by length and resolves relative resets", () => {
    const r = parseRollout(
      {
        last: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 50, total_tokens: 550 },
        context_window: 272000,
        // Order swapped on purpose: the 7-day window comes first here.
        primary: { used_percent: 40, window_minutes: 10080, resets_at: 1_764_000_000 },
        secondary: { used_percent: 12.5, window_minutes: 300, resets_in_seconds: 60 },
      },
      1_000,
    )!;
    expect(r.weekly).toEqual({ usedPercent: 40, windowMinutes: 10080, resetsAt: 1_764_000_000_000 });
    expect(r.fiveHour).toEqual({ usedPercent: 12.5, windowMinutes: 300, resetsAt: 61_000 });
    expect(r.last?.total).toBe(550);
  });

  it("is null-safe", () => {
    expect(parseRollout(null, 0)).toBeNull();
    expect(parseRollout({ primary: { used_percent: "x" } }, 0)).toEqual({
      last: null,
      contextWindow: null,
      fiveHour: null,
      weekly: null,
    });
    expect(parseCodexHook({ session_id: "s" }, 0)).toBeNull();
  });
});

describe("reduceCodexHook", () => {
  it("follows a turn with a tool call", () => {
    let s = newSession("s", 0);
    s = reduceCodexHook(s, hook({ hook_event_name: "UserPromptSubmit" }), 1);
    expect(s.activity).toBe("thinking");
    s = reduceCodexHook(s, hook({ hook_event_name: "PreToolUse", tool_name: "Bash" }), 2);
    expect([s.activity, s.detail, s.source]).toEqual(["tool", "Bash", "codex_hook"]);
    s = reduceCodexHook(s, hook({ hook_event_name: "PostModelRequest", status: "completed" }), 3);
    expect(s.activity).toBe("tool");
    s = reduceCodexHook(s, hook({ hook_event_name: "PostToolUse" }), 4);
    expect(s.activity).toBe("working");
    s = reduceCodexHook(s, hook({ hook_event_name: "Stop" }), 5);
    expect(s.activity).toBe("completed");
  });

  it("maps approvals, failures and interrupts", () => {
    const s0 = newSession("s", 0);
    expect(reduceCodexHook(s0, hook({ hook_event_name: "PermissionRequest", tool_name: "Bash" }), 1).activity).toBe("waiting");
    const failed = reduceCodexHook(s0, hook({ hook_event_name: "PostModelRequest", status: "failed", error: "rate" }), 1);
    expect([failed.activity, failed.detail]).toEqual(["error", "rate"]);
    expect(reduceCodexHook(s0, hook({ hook_event_name: "Interrupt" }), 1).activity).toBe("idle");
    expect(reduceCodexHook(s0, hook({ hook_event_name: "SessionEnd" }), 1).ended).toBe(true);
  });

  it("does not let a subagent end the parent's turn", () => {
    const busy = reduceCodexHook(newSession("s", 0), hook({ hook_event_name: "UserPromptSubmit" }), 1);
    const s = reduceCodexHook(busy, hook({ hook_event_name: "SubagentStop", agent_id: "a" }), 2);
    expect(s.activity).toBe("working");
  });
});

describe("CodexProvider usage", () => {
  const ev = (payload: Record<string, unknown>, receivedAt = 1_000) => ({
    provider: "codex",
    channel: "hook" as const,
    receivedAt,
    payload: { session_id: "s", ...payload },
  });

  it("separates cached input tokens", () => {
    expect(toLastCall({ input: 500, cachedInput: 200, output: 50, total: 550 })).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 200,
    });
  });

  it("counts tokens from PostModelRequest and takes limits from the session log", async () => {
    const p = new CodexProvider(() => 5_000);
    const usage: UsageObservation[] = [];
    const life: LifecycleEvent[] = [];
    p.onUsage((o) => usage.push(o));
    p.onLifecycle((e) => life.push(e));
    const rollout = {
      last: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      context_window: 1000,
      primary: { used_percent: 30, window_minutes: 300, resets_at: 9_999_999_999 },
    };
    p.ingest(ev({ hook_event_name: "SessionStart", source: "startup", model: "gpt-5" }), { replay: false });
    p.ingest(ev({ hook_event_name: "PostModelRequest", status: "completed", token_usage: { input_tokens: 100, output_tokens: 10 }, rollout_usage: rollout }), { replay: false });
    // The session log repeats the same call later: limits only, no second count.
    p.ingest(ev({ hook_event_name: "Stop", rollout_usage: rollout }), { replay: false });

    expect(life.map((e) => e.kind)).toEqual(["session_start", "turn_complete"]);
    expect(usage[0]?.lastCall?.inputTokens).toBe(100);
    expect(usage[1]?.lastCall).toBeNull();
    expect(usage[1]?.fiveHourPct).toBe(30);
    const st = await p.getStatus();
    expect(st.context.usedPercentage.value).toBe(11);
    expect(st.fiveHour.usedPercentage).toMatchObject({ value: 30, source: "codex_rollout" });
    expect(st.model).toBe("gpt-5");
  });

  it("falls back to session-log tokens when PostModelRequest has none", () => {
    const p = new CodexProvider(() => 5_000);
    const usage: UsageObservation[] = [];
    p.onUsage((o) => usage.push(o));
    p.ingest(ev({ hook_event_name: "Stop", rollout_usage: { last: { input_tokens: 40, output_tokens: 4 } } }), { replay: false });
    expect(usage[0]?.lastCall?.outputTokens).toBe(4);
  });

  it("works from the session log alone, with no hooks", async () => {
    const p = new CodexProvider(() => 5_000);
    const usage: UsageObservation[] = [];
    p.onUsage((o) => usage.push(o));
    const log = (e: Record<string, unknown>) => ev({ via: "session_log", ...e });
    p.ingest(log({ hook_event_name: "UserPromptSubmit" }), { replay: false });
    p.ingest(log({ hook_event_name: "PreToolUse", tool_name: "shell" }), { replay: false });
    const st = await p.getStatus();
    expect([st.activity, st.activityDetail, st.activitySource]).toEqual(["tool", "shell", "codex_rollout"]);
    p.ingest(log({ hook_event_name: "PostModelRequest", status: "completed", rollout_usage: { last: { input_tokens: 7, output_tokens: 1 } } }), { replay: false });
    expect(usage.map((u) => u.lastCall?.inputTokens)).toEqual([7]);
  });

  it("ignores the session log for a session that real hooks report on", async () => {
    const p = new CodexProvider(() => 5_000);
    const usage: UsageObservation[] = [];
    p.onUsage((o) => usage.push(o));
    p.ingest(ev({ hook_event_name: "PreToolUse", tool_name: "Bash" }), { replay: false });
    p.ingest(ev({ via: "session_log", hook_event_name: "Stop" }), { replay: false });
    p.ingest(ev({ via: "session_log", hook_event_name: "PostModelRequest", rollout_usage: { last: { input_tokens: 7, output_tokens: 1 } } }), { replay: false });
    expect((await p.getStatus()).activity).toBe("tool");
    expect(usage).toEqual([]);
  });

  it("does not re-fire XP events on replay", () => {
    const p = new CodexProvider(() => 5_000);
    const life: LifecycleEvent[] = [];
    p.onLifecycle((e) => life.push(e));
    p.ingest(ev({ hook_event_name: "Stop" }), { replay: true });
    expect(life).toEqual([]);
  });
});
