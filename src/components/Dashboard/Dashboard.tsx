import { useEffect, useState, type ReactNode } from "react";
import { backend, on, type DashboardData } from "@/lib/backend";
import { levelFromXp } from "@/pet/xp";
import { resolvePetState } from "@/pet/PetStateMachine";
import { getSkin } from "@/pet/skins";
import { EVT_PROGRESS, EVT_SYNC_CHANGED } from "@/services/runtime";
import { useT } from "@/i18n";
import { selectStatus, useAI } from "@/stores/aiStore";
import { useSettings } from "@/stores/settingsStore";
import { formatDuration, formatInt } from "@/utils/format";
import { localDate } from "@/utils/format";
import { ActivityChip } from "../common/ActivityChip";
import { WeekChart } from "./WeekChart";

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="tnum mt-1 text-[22px] font-bold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const status = useAI(selectStatus);
  const skin = useSettings((s) => s.settings.pet.skin);
  const t = useT();

  useEffect(() => {
    const load = () => void backend.statsDashboard(localDate(new Date()), 7).then(setData).catch(console.error);
    load();
    const t = setInterval(load, 30_000);
    const p = on(EVT_PROGRESS, load);
    const s = on(EVT_SYNC_CHANGED, load);
    return () => {
      clearInterval(t);
      void p.then((u) => u());
      void s.then((u) => u());
    };
  }, []);

  const lvl = levelFromXp(data?.progress.xp ?? 0);
  const today = data?.today;
  const pet = resolvePetState({
    activity: status.activity,
    fiveHour: status.fiveHour.usedPercentage.value,
    weekly: status.weekly.usedPercentage.value,
    context: status.context.usedPercentage.value,
  });
  const Skin = getSkin(skin).Renderer;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className="card flex items-center gap-4 p-4">
          <Skin state={pet.state} modifiers={pet.modifiers} animate size={112} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-[18px] font-bold">{t.dashboard.level(lvl.level)}</div>
              <div className="tnum text-[12px] text-[color:var(--text-muted)]">
                {formatInt(lvl.intoLevel)} / {formatInt(lvl.needed)} XP
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
              <div className="h-full rounded-full" style={{ width: `${lvl.progress * 100}%`, background: "var(--accent)" }} />
            </div>
            <div className="flex flex-wrap gap-2 text-[12px]">
              <span className="chip">{t.petStates[pet.state].label}</span>
              <span className="chip">{t.dashboard.totalXp(formatInt(data?.progress.xp ?? 0))}</span>
              <span className="chip">
                {data && data.progress.streak > 0 ? t.dashboard.streak(data.progress.streak) : t.dashboard.noStreak}
              </span>
              {data && data.progress.bestStreak > 1 && <span className="chip">{t.dashboard.best(data.progress.bestStreak)}</span>}
            </div>
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold">{status.providerName}</div>
              <div className="text-[12px] text-[color:var(--text-muted)]">
                {status.model ?? t.dashboard.noSession}
                {status.activeSessions > 1 && t.dashboard.sessionsSuffix(status.activeSessions)}
              </div>
            </div>
            <ActivityChip status={status} />
          </div>
        </div>
      </div>

      <div>
        <div className="label mb-2">{t.dashboard.today}</div>
        <div className="grid grid-cols-3 gap-3">
          <Tile label={t.dashboard.codingTime} value={formatDuration(today?.codingMs ?? 0)} sub={t.dashboard.turns(formatInt(today?.turns ?? 0))} />
          <Tile label={t.dashboard.sessions} value={formatInt(today?.sessions ?? 0)} />
          <Tile
            label={t.dashboard.code}
            value={
              <>
                <span style={{ color: "var(--ok)" }}>+{formatInt(today?.linesAdded ?? 0)}</span>{" "}
                <span style={{ color: "var(--danger)" }}>-{formatInt(today?.linesRemoved ?? 0)}</span>
              </>
            }
          />
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="font-bold">{t.dashboard.last7}</div>
          <div className="tnum text-[12px] text-[color:var(--text-muted)]">
            {t.dashboard.allTime(
              formatDuration(data?.totals.codingMs ?? 0),
              formatInt(data?.totals.sessions ?? 0),
              formatInt(data?.totals.linesAdded ?? 0),
            )}
          </div>
        </div>
        {data && <WeekChart days={data.days} />}
      </div>

      <p className="text-[11px] leading-relaxed text-[color:var(--text-muted)]">
        {t.dashboard.footnote}
      </p>
    </div>
  );
}
