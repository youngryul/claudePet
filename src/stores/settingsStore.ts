import { create } from "zustand";
import { backend, on } from "@/lib/backend";
import { DEFAULT_SCHEDULE, type WorkSchedule } from "@/pet/workday";

export interface AppSettings {
  version: 1;
  pet: {
    visible: boolean;
    alwaysOnTop: boolean;
    scale: number;
    opacity: number;
    animations: boolean;
    clickThrough: boolean;
    skin: string;
  };
  display: {
    /** Show subscription/context usage in the popover. */
    showUsage: boolean;
    /** Tiny usage chip under the pet. */
    showUsageBadge: boolean;
    /** UI language for the dashboard and pet popover. */
    language: "ko" | "en";
  };
  providers: {
    /** Providers the runtime starts. Only implemented ones do anything. */
    enabled: string[];
    primary: string;
  };
  /** Work hours for the pet's countdown bubble. */
  schedule: WorkSchedule;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  pet: { visible: true, alwaysOnTop: true, scale: 1, opacity: 1, animations: true, clickThrough: true, skin: "bluecat" },
  display: { showUsage: true, showUsageBadge: false, language: "ko" },
  providers: { enabled: ["claude"], primary: "claude" },
  schedule: DEFAULT_SCHEDULE,
};

/** Deep-merge stored settings over defaults so new fields get sane values. */
export function mergeSettings(stored: unknown): AppSettings {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<AppSettings>;
  return {
    version: 1,
    pet: { ...DEFAULT_SETTINGS.pet, ...(s.pet ?? {}) },
    display: { ...DEFAULT_SETTINGS.display, ...(s.display ?? {}) },
    providers: { ...DEFAULT_SETTINGS.providers, ...(s.providers ?? {}) },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(s.schedule ?? {}) },
  };
}

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: (s: AppSettings) => AppSettings) => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const stored = await backend.settingsLoad().catch(() => null);
    set({ settings: mergeSettings(stored), loaded: true });
  },
  update: async (patch) => {
    const next = patch(get().settings);
    set({ settings: next });
    await backend.settingsSave(next);
  },
}));

/** Keep every window in sync (the backend broadcasts after each save). */
export function syncSettingsAcrossWindows() {
  return on<unknown>("settings://changed", (s) => useSettings.setState({ settings: mergeSettings(s) }));
}
