import { useMemo, useState } from "react";
import { broadcast } from "@/lib/backend";
import { resolvePetState } from "@/pet/PetStateMachine";
import { getSkin } from "@/pet/skins";
import { allScenarios, type MockScenario } from "@/services/mockScenarios";
import { EVT_MOCK } from "@/services/runtime";
import { useAI } from "@/stores/aiStore";

/** Mock any AI state to test the pet without running Claude Code. */
export function DevPanel() {
  const scenarios = useMemo(() => allScenarios(), []);
  const [active, setActive] = useState<string | null>(useAI.getState().mock?.id ?? null);

  const apply = (s: MockScenario | null) => {
    setActive(s?.id ?? null);
    useAI.getState().setMock(s);
    void broadcast(EVT_MOCK, s);
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold">Developer Mode</h2>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            Overrides the live status on the desktop pet. Hidden in production unless AI_PET_DEV_MODE=1.
          </p>
        </div>
        <button className="btn" onClick={() => apply(null)} disabled={!active}>
          Back to live data
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {scenarios.map((s) => {
          const r = resolvePetState({
            activity: s.status.activity,
            fiveHour: s.status.fiveHour.usedPercentage.value,
            weekly: s.status.weekly.usedPercentage.value,
            context: s.status.context.usedPercentage.value,
          });
          const Skin = getSkin("sprout").Renderer;
          return (
            <button
              key={s.id}
              onClick={() => apply(s)}
              className="card flex flex-col items-center p-2 text-[12px] transition-transform hover:-translate-y-0.5"
              style={active === s.id ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent-soft)" } : undefined}
            >
              <Skin state={r.state} modifiers={r.modifiers} animate size={84} detail={s.status.activityDetail} />
              <span className="mono font-semibold">{s.label}</span>
              <span className="text-[11px] text-[color:var(--text-muted)]">
                → {r.state}
                {r.modifiers.length ? ` +${r.modifiers.join(",")}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
