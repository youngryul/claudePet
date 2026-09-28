import { useEffect, useState, type ReactNode } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { backend, inTauri, on } from "@/lib/backend";
import { PROVIDER_INFO } from "@/providers/registry";
import { PET_SKINS } from "@/pet/skins";
import { useSettings, type AppSettings } from "@/stores/settingsStore";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <div>
        <div className="text-[13px] font-semibold">{label}</div>
        {hint && <div className="text-[12px] text-[color:var(--text-muted)]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[40px] rounded-full transition-colors"
      style={{ background: checked ? "var(--accent)" : "var(--track)" }}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]"
        style={{ left: checked ? 21 : 3 }}
      />
    </button>
  );
}

export function Settings() {
  const { settings, update } = useSettings();
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    void isEnabled().then(setAutostart).catch(() => setAutostart(null));
    const p = on<boolean>("autostart://changed", setAutostart);
    return () => void p.then((u) => u());
  }, []);

  const set = (fn: (s: AppSettings) => AppSettings) => void update(fn);
  const pet = (patch: Partial<AppSettings["pet"]>) => set((s) => ({ ...s, pet: { ...s.pet, ...patch } }));
  const display = (patch: Partial<AppSettings["display"]>) => set((s) => ({ ...s, display: { ...s.display, ...patch } }));

  const toggleAutostart = async (v: boolean) => {
    try {
      await (v ? enable() : disable());
      setAutostart(await isEnabled());
      await backend.autostartChanged();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-[18px] font-bold">Settings</h2>

      <section className="card px-4 py-1">
        <Row label="Show pet">
          <Toggle label="Show pet" checked={settings.pet.visible} onChange={(v) => pet({ visible: v })} />
        </Row>
        <Row label="Always on top">
          <Toggle label="Always on top" checked={settings.pet.alwaysOnTop} onChange={(v) => pet({ alwaysOnTop: v })} />
        </Row>
        <Row label="Start at login" hint={autostart === null ? "Unavailable in this environment" : undefined}>
          <Toggle label="Start at login" checked={!!autostart} onChange={(v) => void toggleAutostart(v)} />
        </Row>
        <Row label="Click-through" hint="Clicks on the transparent area around the pet go to the app below">
          <Toggle label="Click-through" checked={settings.pet.clickThrough} onChange={(v) => pet({ clickThrough: v })} />
        </Row>
        <Row label="Animations">
          <Toggle label="Animations" checked={settings.pet.animations} onChange={(v) => pet({ animations: v })} />
        </Row>
        <Row label="Pet size" hint={`${Math.round(settings.pet.scale * 100)}%`}>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={settings.pet.scale}
            onChange={(e) => pet({ scale: Number(e.target.value) })}
          />
        </Row>
        <Row label="Pet opacity" hint={`${Math.round(settings.pet.opacity * 100)}%`}>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={settings.pet.opacity}
            onChange={(e) => pet({ opacity: Number(e.target.value) })}
          />
        </Row>
        <Row label="Pet">
          <select
            className="btn"
            value={settings.pet.skin}
            onChange={(e) => pet({ skin: e.target.value })}
          >
            {Object.values(PET_SKINS).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Pet position" hint="Move the pet back to the bottom-right corner">
          <button className="btn" onClick={() => void backend.petResetPosition()}>
            Reset position
          </button>
        </Row>
      </section>

      <section className="card px-4 py-1">
        <Row label="Show usage in popover" hint="Plan limits and context window">
          <Toggle label="Show usage" checked={settings.display.showUsage} onChange={(v) => display({ showUsage: v })} />
        </Row>
        <Row label="Usage badge under the pet">
          <Toggle label="Usage badge" checked={settings.display.showUsageBadge} onChange={(v) => display({ showUsageBadge: v })} />
        </Row>
      </section>

      <section className="card px-4 py-1">
        <div className="label pt-3">AI providers</div>
        {PROVIDER_INFO.map((p) => {
          const on = settings.providers.enabled.includes(p.id);
          return (
            <Row key={p.id} label={p.name} hint={p.implemented ? (settings.providers.primary === p.id ? "Primary - drives the pet" : undefined) : "Coming soon"}>
              <Toggle
                label={p.name}
                checked={on && p.implemented}
                onChange={(v) =>
                  p.implemented &&
                  set((s) => ({
                    ...s,
                    providers: {
                      ...s.providers,
                      enabled: v ? [...new Set([...s.providers.enabled, p.id])] : s.providers.enabled.filter((x) => x !== p.id),
                    },
                  }))
                }
              />
            </Row>
          );
        })}
        <div className="pb-3 text-[12px] text-[color:var(--text-muted)]">Provider changes apply after restarting the app.</div>
      </section>
    </div>
  );
}
