import { describe, expect, it } from "vitest";
import { parseStatusLine } from "./claudeParse";

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
