import { useT } from "@/i18n";
import { isValidSchedule, type WorkSchedule } from "@/pet/workday";
import { useSettings } from "@/stores/settingsStore";

const timeInput = "rounded-[9px] px-2 py-1 text-[13px] tnum outline-none";
const timeStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" };

function Time({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className={timeInput}
      style={timeStyle}
    />
  );
}

/** Work hours that drive the pet's countdown speech bubble. */
export function ScheduleSettings() {
  const L = useT().schedule;
  const schedule = useSettings((s) => s.settings.schedule);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<WorkSchedule>) => void update((s) => ({ ...s, schedule: { ...s.schedule, ...patch } }));
  const toggleDay = (d: number) =>
    set({ workdays: schedule.workdays.includes(d) ? schedule.workdays.filter((x) => x !== d) : [...schedule.workdays, d].sort((a, b) => a - b) });
  const valid = isValidSchedule(schedule);
  const row = "flex items-center justify-between gap-4 border-t py-3";
  const border = { borderColor: "var(--border)" };

  const toggle = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "var(--accent)" : "var(--track)" }}
    >
      <span className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]" style={{ left: checked ? 21 : 3 }} />
    </button>
  );

  return (
    <section className="card px-4 py-1">
      <div className="flex items-center justify-between gap-4 py-3">
        <div>
          <div className="text-[13px] font-semibold">{L.title}</div>
          <div className="text-[12px] text-[color:var(--text-muted)]">{L.hint}</div>
        </div>
        {toggle(schedule.enabled, (v) => set({ enabled: v }), L.enable)}
      </div>

      {schedule.enabled && (
        <>
          <div className={row} style={border}>
            <div className="text-[13px] font-semibold">{L.workStart}</div>
            <Time label={L.workStart} value={schedule.workStart} onChange={(v) => set({ workStart: v })} />
          </div>
          <div className={row} style={border}>
            <div className="text-[13px] font-semibold">{L.lunch}</div>
            <div className="flex items-center gap-1.5">
              <Time label={`${L.lunch} 1`} value={schedule.lunchStart} onChange={(v) => set({ lunchStart: v })} />
              <span className="text-[color:var(--text-muted)]">~</span>
              <Time label={`${L.lunch} 2`} value={schedule.lunchEnd} onChange={(v) => set({ lunchEnd: v })} />
            </div>
          </div>
          <div className={row} style={border}>
            <div className="text-[13px] font-semibold">{L.workEnd}</div>
            <Time label={L.workEnd} value={schedule.workEnd} onChange={(v) => set({ workEnd: v })} />
          </div>
          <div className={row} style={border}>
            <div className="text-[13px] font-semibold">{L.workdays}</div>
            <div className="flex gap-1">
              {L.dayNames.map((name, d) => {
                const on = schedule.workdays.includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    className="h-7 w-7 rounded-full text-[12px] font-semibold"
                    style={on ? { background: "var(--accent)", color: "#0d2a1f" } : { background: "var(--surface-2)", color: "var(--text-muted)" }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={row} style={border}>
            <div className="text-[13px] font-semibold">{L.cheers}</div>
            {toggle(schedule.cheers, (v) => set({ cheers: v }), L.cheers)}
          </div>
          {!valid && (
            <div className="pb-3 text-[12px]" style={{ color: "var(--danger)" }}>
              {L.invalid}
            </div>
          )}
        </>
      )}
    </section>
  );
}
