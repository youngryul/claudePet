import type { AIStatus } from "@/providers/core/types";

const COLORS: Record<AIStatus["activity"], string> = {
  offline: "#8d95a5",
  idle: "#5fd3a5",
  thinking: "#9ad8ff",
  working: "#5fd3a5",
  tool: "#c3a6ff",
  waiting: "#ffd166",
  completed: "#5fd3a5",
  error: "#e5484d",
};

const LABEL: Record<AIStatus["activity"], string> = {
  offline: "Offline",
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  tool: "Tool",
  waiting: "Waiting for you",
  completed: "Completed",
  error: "Error",
};

export function ActivityChip({ status }: { status: AIStatus }) {
  const derived = status.activitySource === "derived" || status.activitySource === "process_probe";
  return (
    <span
      className="chip"
      title={derived ? "Inferred state (DERIVED_STATE)" : `From ${status.activitySource.replace("_", " ")}`}
    >
      <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: COLORS[status.activity] }} />
      {LABEL[status.activity]}
      {status.activity === "tool" && status.activityDetail ? ` · ${status.activityDetail}` : ""}
      {status.activity === "error" && status.activityDetail ? ` · ${status.activityDetail}` : ""}
    </span>
  );
}
