import { useState } from "react";
import type { DailyRow } from "@/lib/backend";
import { formatCompact, formatDuration } from "@/utils/format";

type MetricKey = "time" | "lines" | "tokens";

const METRICS: Record<MetricKey, { label: string; value: (d: DailyRow) => number; format: (n: number) => string }> = {
  time: { label: "Coding time", value: (d) => d.codingMs, format: formatDuration },
  lines: { label: "Lines added", value: (d) => d.linesAdded, format: (n) => formatCompact(n) },
  tokens: { label: "Tokens (in + out)", value: (d) => d.inputTokens + d.outputTokens, format: (n) => formatCompact(n) },
};

const weekday = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: "short" });
};

/** Single-series bar chart, hand-rolled SVG (no chart library needed). */
export function WeekChart({ days }: { days: DailyRow[] }) {
  const [metric, setMetric] = useState<MetricKey>("time");
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const m = METRICS[metric];
  const values = days.map(m.value);
  const max = Math.max(1, ...values);

  const W = 560;
  const H = 170;
  const padB = 22;
  const plotH = H - padB - 8;
  const slot = W / Math.max(1, days.length);
  const barW = Math.min(44, slot - 14);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <button
            key={k}
            className="chip cursor-pointer"
            style={k === metric ? { background: "var(--accent-soft)", color: "var(--text)", borderColor: "var(--accent)" } : undefined}
            onClick={() => setMetric(k)}
          >
            {METRICS[k].label}
          </button>
        ))}
        <button className="chip ml-auto cursor-pointer" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      {asTable ? (
        <table className="tnum w-full text-[12px]">
          <thead className="text-left text-[color:var(--text-muted)]">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{m.label}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.date} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1">
                  {weekday(d.date)} <span className="text-[color:var(--text-muted)]">{d.date}</span>
                </td>
                <td className="py-1 text-right">{m.format(values[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : values.every((v) => v === 0) ? (
        <div className="flex h-[170px] items-center justify-center text-[13px] text-[color:var(--text-muted)]">
          No activity recorded in the last {days.length} days yet.
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${m.label}, last ${days.length} days`}>
            <line x1={0} x2={W} y1={plotH + 8} y2={plotH + 8} stroke="var(--border)" strokeWidth={1} />
            {days.map((d, i) => {
              const v = values[i] ?? 0;
              const h = v > 0 ? Math.max(4, (v / max) * plotH) : 0;
              const x = i * slot + (slot - barW) / 2;
              const y = plotH + 8 - h;
              const r = Math.min(4, h / 2, barW / 2);
              const isToday = i === days.length - 1;
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x} ${plotH + 8} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + barW - r} Q${x + barW} ${y} ${x + barW} ${y + r} V${plotH + 8} Z`}
                      fill="var(--accent)"
                      opacity={hover === null || hover === i ? (isToday ? 1 : 0.78) : 0.4}
                    />
                  )}
                  <text
                    x={i * slot + slot / 2}
                    y={H - 4}
                    textAnchor="middle"
                    fontSize={11}
                    fill={isToday ? "var(--text)" : "var(--text-muted)"}
                    fontWeight={isToday ? 600 : 400}
                  >
                    {isToday ? "Today" : weekday(d.date)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && days[hover] && (
            <div
              className="card pointer-events-none absolute -translate-x-1/2 px-2.5 py-1.5 text-[12px] shadow-md"
              style={{ left: `${((hover + 0.5) / days.length) * 100}%`, top: 0 }}
            >
              <div className="text-[11px] text-[color:var(--text-muted)]">{days[hover]!.date}</div>
              <div className="tnum font-semibold">{m.format(values[hover] ?? 0)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
