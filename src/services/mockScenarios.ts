/**
 * Developer Mode scenarios: exercise every pet state without running Claude Code.
 * Enabled in dev builds, or in production with AI_PET_DEV_MODE=1.
 */
import { emptyStatus } from "@/providers/core/metric";
import type { AIActivityState, AIStatus, Metric } from "@/providers/core/types";

export interface MockScenario {
  id: string;
  label: string;
  status: AIStatus;
}

const m = (value: number | null): Metric => ({ value, source: "mock", updatedAt: value === null ? null : Date.now() });

interface MockOpts {
  activity?: AIActivityState;
  fiveHour?: number;
  weekly?: number;
  context?: number;
  detail?: string;
}

export function mockStatus({ activity = "idle", fiveHour = 34, weekly = 21, context = 42, detail }: MockOpts): AIStatus {
  const now = Date.now();
  const s = emptyStatus("claude", "Claude Code", now);
  return {
    ...s,
    connected: activity !== "offline",
    activity,
    activitySource: "mock",
    activityDetail: detail ?? null,
    model: "Opus (mock)",
    sessionId: "mock-session",
    activeSessions: activity === "offline" ? 0 : 1,
    thinkingEnabled: true,
    effortLevel: "high",
    context: { usedPercentage: m(context), inputTokens: m(84_120), outputTokens: m(2_310), windowSize: 200_000 },
    fiveHour: { usedPercentage: m(fiveHour), resetsAt: now + 2 * 3600_000 },
    weekly: { usedPercentage: m(weekly), resetsAt: now + 4 * 86400_000 },
    session: { linesAdded: m(1283), linesRemoved: m(318), costUsd: m(2.41) },
  };
}

const scenario = (id: string, label: string, o: MockOpts): MockScenario => ({ id, label, status: mockStatus(o) });

export function allScenarios(): MockScenario[] {
  return [
    scenario("offline", "offline", { activity: "offline" }),
    scenario("idle", "idle", { activity: "idle" }),
    scenario("working", "working", { activity: "working" }),
    scenario("tool", "tool", { activity: "tool", detail: "Bash" }),
    scenario("thinking", "thinking", { activity: "thinking" }),
    scenario("waiting", "waiting", { activity: "waiting", detail: "permission_prompt" }),
    scenario("completed", "completed", { activity: "completed" }),
    scenario("error", "error", { activity: "error", detail: "rate_limit" }),
    scenario("5h-10", "fiveHour = 10", { fiveHour: 10 }),
    scenario("5h-70", "fiveHour = 70", { fiveHour: 70 }),
    scenario("5h-90", "fiveHour = 90", { fiveHour: 90 }),
    scenario("5h-99", "fiveHour = 99", { fiveHour: 99 }),
    scenario("ctx-85", "context = 85", { context: 85 }),
    scenario("ctx-95", "context = 95", { context: 95 }),
    scenario("coding-tired", "working + 5h 88%", { activity: "working", fiveHour: 88 }),
  ];
}
