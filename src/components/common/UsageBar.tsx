import { useT } from "@/i18n";
import type { Metric } from "@/providers/core/types";
import { formatRelative } from "@/utils/format";

export function barColor(pct: number): string {
  if (pct >= 95) return "var(--danger)";
  if (pct >= 80) return "var(--hot)";
  if (pct >= 60) return "var(--warn)";
  return "var(--ok)";
}

interface Props {
  label: string;
  metric: Metric;
  hint?: string | null;
  compact?: boolean;
  unavailableText?: string;
}

/** A labelled percentage bar that makes missing data explicit instead of showing 0%. */
export function UsageBar({ label, metric, hint, compact, unavailableText }: Props) {
  const t = useT();
  const v = metric.value;
  const title = `${t.metricSource[metric.source]}${metric.updatedAt ? ` · ${t.updated(formatRelative(metric.updatedAt))}` : ""}`;
  return (
    <div title={title} className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-[color:var(--text-muted)]">
          {label}
          {metric.source === "derived" && <span className="ml-1 opacity-70">≈</span>}
        </span>
        <span className="tnum text-[12px] font-semibold">
          {v === null ? <span className="font-normal text-[color:var(--text-muted)]">{unavailableText ?? t.unavailable}</span> : `${Math.round(v)}%`}
        </span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
        {v !== null && (
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: barColor(v) }}
          />
        )}
      </div>
      {hint && <div className="text-[10px] text-[color:var(--text-muted)]">{hint}</div>}
    </div>
  );
}
