import type { ReactNode } from "react";
import { levelFromXp } from "@/pet/xp";
import { useT } from "@/i18n";
import { selectStatus, useAI } from "@/stores/aiStore";
import { usePet } from "@/stores/petStore";
import { formatDuration, formatInt } from "@/utils/format";
import { ActivityChip } from "../common/ActivityChip";

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-[color:var(--text-muted)]">{label}</div>
      <div className="tnum text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="label">{title}</div>
      {children}
    </section>
  );
}

export function UsagePanel({ onOpenDashboard }: { onOpenDashboard: () => void }) {
  const status = useAI(selectStatus);
  const mock = useAI((s) => s.mock);
  const { progress, todayCodingMs } = usePet();
  const lvl = levelFromXp(progress.xp);
  const u = useT().usage;

  return (
    <div className="space-y-3 p-3.5 text-[13px]">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold">{status.providerName}</div>
          <div className="truncate text-[11px] text-[color:var(--text-muted)]">
            {status.model ?? u.noModel}
            {mock && " · mock"}
          </div>
        </div>
        <ActivityChip status={status} />
      </header>

      <Section title={u.pet}>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-bold">{u.level(lvl.level)}</span>
          <span className="tnum text-[11px] text-[color:var(--text-muted)]">
            XP {formatInt(lvl.intoLevel)} / {formatInt(lvl.needed)}
          </span>
        </div>
        <div className="h-[6px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
          <div className="h-full rounded-full" style={{ width: `${lvl.progress * 100}%`, background: "var(--accent)" }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={u.today} value={formatDuration(todayCodingMs)} />
          <Stat label={u.streak} value={progress.streak > 0 ? u.streakDays(progress.streak) : "—"} />
          <Stat
            label={u.lines}
            value={
              status.session.linesAdded.value === null ? (
                "—"
              ) : (
                <>
                  <span style={{ color: "var(--ok)" }}>+{formatInt(status.session.linesAdded.value)}</span>{" "}
                  <span style={{ color: "var(--danger)" }}>-{formatInt(status.session.linesRemoved.value)}</span>
                </>
              )
            }
          />
        </div>
      </Section>

      <button className="btn btn-primary w-full justify-center" onClick={onOpenDashboard}>
        {u.openDashboard}
      </button>
    </div>
  );
}
