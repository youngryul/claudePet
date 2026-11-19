import { describe, expect, it, vi } from "vitest";
import { emptyStatus } from "@/providers/core/metric";
import type { AIStatus } from "@/providers/core/types";
import { pickDisplayed } from "./runtime";

vi.mock("@/lib/backend", () => ({ backend: {}, broadcast: vi.fn(), on: vi.fn() }));

const st = (provider: string, activity: AIStatus["activity"]): AIStatus => ({ ...emptyStatus(provider, provider), activity });

describe("pickDisplayed", () => {
  it("follows the busier agent", () => {
    expect(pickDisplayed([st("claude", "idle"), st("codex", "tool")], "claude")?.provider).toBe("codex");
    expect(pickDisplayed([st("claude", "waiting"), st("codex", "working")], "claude")?.provider).toBe("claude");
  });

  it("prefers the primary on a tie and when both are offline", () => {
    expect(pickDisplayed([st("codex", "idle"), st("claude", "idle")], "claude")?.provider).toBe("claude");
    expect(pickDisplayed([st("codex", "offline"), st("claude", "offline")], "claude")?.provider).toBe("claude");
    expect(pickDisplayed([st("claude", "offline"), st("codex", "idle")], "claude")?.provider).toBe("codex");
  });

  it("returns null without statuses", () => {
    expect(pickDisplayed([], "claude")).toBeNull();
  });
});
