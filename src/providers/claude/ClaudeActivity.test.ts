import { describe, expect, it } from "vitest";
import { decay, DECAY, isOffline, mostSalient, newSession, reduceHook, reduceStatusLine } from "./ClaudeActivity";
import { parseHook } from "./claudeParse";

const hook = (e: Record<string, unknown>) => parseHook({ session_id: "s", ...e })!;

describe("reduceHook", () => {
  it("follows a typical turn", () => {
    let s = newSession("s", 0);
    s = reduceHook(s, hook({ hook_event_name: "UserPromptSubmit" }), 1);
    expect(s.activity).toBe("thinking");
    s = reduceHook(s, hook({ hook_event_name: "PreToolUse", tool_name: "Bash" }), 2);
    expect([s.activity, s.detail]).toEqual(["tool", "Bash"]);
    s = reduceHook(s, hook({ hook_event_name: "PostToolUse", tool_name: "Bash" }), 3);
    expect(s.activity).toBe("working");
    s = reduceHook(s, hook({ hook_event_name: "PermissionRequest", tool_name: "Edit" }), 4);
    expect(s.activity).toBe("waiting");
    s = reduceHook(s, hook({ hook_event_name: "Stop" }), 5);
    expect(s.activity).toBe("completed");
    expect(s.source).toBe("claude_hook");
    expect(decay(s, 5 + DECAY.completedToIdle + 1).activity).toBe("idle");
    expect(decay(s, 5 + DECAY.completedToIdle + 1).source).toBe("derived");
  });

  it("maps StopFailure to error and SessionEnd to ended", () => {
    let s = reduceHook(newSession("s", 0), hook({ hook_event_name: "StopFailure", error: "rate_limit" }), 1);
    expect([s.activity, s.detail]).toEqual(["error", "rate_limit"]);
    s = reduceHook(s, hook({ hook_event_name: "SessionEnd", reason: "other" }), 2);
    expect(s.ended).toBe(true);
  });

  it("notification types", () => {
    const s = newSession("s", 0);
    expect(reduceHook(s, hook({ hook_event_name: "Notification", notification_type: "permission_prompt" }), 1).activity).toBe("waiting");
    expect(reduceHook(s, hook({ hook_event_name: "Notification", notification_type: "idle_prompt" }), 1).activity).toBe("idle");
    expect(reduceHook(s, hook({ hook_event_name: "Notification", notification_type: "auth_success" }), 1).activity).toBe("idle");
  });

  it("ignores unknown events and malformed payloads", () => {
    const s = newSession("s", 0);
    expect(reduceHook(s, hook({ hook_event_name: "SomethingNew" }), 1).activity).toBe("idle");
    expect(parseHook(null)).toBeNull();
    expect(parseHook({})).toBeNull();
  });
});

describe("statusLine heuristic", () => {
  it("only applies without hooks and decays", () => {
    let s = reduceStatusLine(newSession("s", 0), "a", 0);
    s = reduceStatusLine(s, "b", 1000);
    expect([s.activity, s.source]).toEqual(["working", "derived"]);
    expect(decay(s, 1000 + DECAY.heuristicWorking + 1).activity).toBe("idle");
    const withHooks = reduceHook(newSession("s", 0), hook({ hook_event_name: "SessionStart" }), 0);
    expect(reduceStatusLine(reduceStatusLine(withHooks, "a", 1), "b", 2).activity).toBe("idle");
  });
});

describe("aggregation", () => {
  it("picks the most salient live session", () => {
    const a = reduceHook(newSession("a", 0), hook({ hook_event_name: "UserPromptSubmit" }), 1);
    const b = reduceHook(newSession("b", 0), hook({ hook_event_name: "PermissionRequest" }), 1);
    expect(mostSalient([a, b])?.sessionId).toBe("b");
  });
  it("offline detection", () => {
    expect(isOffline({ liveSessions: 2, processRunning: false, lastEventAt: 1, now: 2 })).toBe(true);
    expect(isOffline({ liveSessions: 0, processRunning: true, lastEventAt: null, now: 2 })).toBe(false);
    expect(isOffline({ liveSessions: 1, processRunning: null, lastEventAt: 0, now: 60_000 })).toBe(false);
    expect(isOffline({ liveSessions: 0, processRunning: null, lastEventAt: 0, now: 1 })).toBe(true);
  });
});
