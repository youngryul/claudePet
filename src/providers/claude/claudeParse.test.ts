import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "./ClaudeProvider";
import { parseHook, parseStatusLine } from "./claudeParse";

describe("hook token usage (no statusLine: desktop app / IDE)", () => {
  const stop = {
    hook_event_name: "Stop",
    session_id: "s1",
    transcript_usage: {
      model: "claude-opus-5-5",
      input_tokens: 10,
      output_tokens: 500,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 48_000,
    },
  };

  it("parses the numbers our hook CLI attaches", () => {
    const u = parseHook(stop)!.usage!;
    expect(u.contextTokens).toBe(50_010);
    expect(u.lastCall.outputTokens).toBe(500);
    expect(parseHook({ hook_event_name: "Stop" })!.usage).toBeNull();
  });

  it("fills context tokens and emits usage when no statusLine arrives", async () => {
    const p = new ClaudeProvider(() => 1_000);
    const seen: unknown[] = [];
    p.onUsage((o) => seen.push(o));
    p.ingest({ provider: "claude", channel: "hook", receivedAt: 1_000, payload: stop }, { replay: false });
    const s = await p.getStatus();
    expect(s.context.inputTokens.value).toBe(50_010);
    expect(s.context.outputTokens.value).toBe(500);
    expect(Math.round(s.context.usedPercentage.value!)).toBe(25); // of an assumed 200K window
    expect(s.model).toBe("claude-opus-5-5");
    expect(seen).toHaveLength(1);
  });

  it("prefers the statusLine when there is one, and does not double-count", async () => {
    const p = new ClaudeProvider(() => 1_000);
    const seen: unknown[] = [];
    p.onUsage((o) => seen.push(o));
    const sl = { session_id: "s1", context_window: { total_input_tokens: 7, total_output_tokens: 8, used_percentage: 1 } };
    p.ingest({ provider: "claude", channel: "statusline", receivedAt: 1_000, payload: sl }, { replay: false });
    p.ingest({ provider: "claude", channel: "hook", receivedAt: 1_000, payload: stop }, { replay: false });
    expect((await p.getStatus()).context.inputTokens.value).toBe(7);
    expect(seen).toHaveLength(1); // only the statusLine observation
  });
});

describe("parseStatusLine", () => {
  it("parses the documented payload", () => {
    const p = parseStatusLine({
      session_id: "abc",
      model: { id: "claude-opus", display_name: "Opus" },
      cost: { total_cost_usd: 0.01, total_api_duration_ms: 2300, total_lines_added: 156, total_lines_removed: 23 },
      context_window: {
        total_input_tokens: 15500,
        total_output_tokens: 1200,
        context_window_size: 200000,
        used_percentage: 8,
        current_usage: { input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000 },
      },
      rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } },
      thinking: { enabled: true },
    })!;
    expect(p.model).toBe("Opus");
    expect(p.fiveHourPct).toBe(23.5);
    expect(p.fiveHourResetsAt).toBe(1738425600_000);
    expect(p.weeklyPct).toBeNull();
    expect(p.lastCall?.cacheReadTokens).toBe(2000);
    expect(p.effortLevel).toBeNull();
  });

  it("is null-safe for old/partial payloads", () => {
    const p = parseStatusLine({ model: null, context_window: { used_percentage: null, current_usage: null }, rate_limits: null })!;
    expect(p.contextPct).toBeNull();
    expect(p.lastCall).toBeNull();
    expect(p.fiveHourPct).toBeNull();
    expect(parseStatusLine("garbage")).toBeNull();
    expect(parseStatusLine([])).toBeNull();
  });
});
