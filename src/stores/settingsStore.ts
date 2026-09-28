import { create } from "zustand";
import { backend, on } from "@/lib/backend";

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
  };
  providers: {
    /** Providers the runtime starts. Only implemented ones do anything. */
    enabled: string[];
    primary: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  pet: { visible: true, alwaysOnTop: true, scale: 1, opacity: 1, animations: true, clickThrough: true, skin: "sprout" },
  display: { showUsage: true, showUsageBadge: false },
  providers: { enabled: ["claude"], primary: "claude" },
};

/** Deep-merge stored settings over defaults so new fields get sane values. */
export function mergeSettings(stored: unknown): AppSettings {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<AppSettings>;
  return {
    version: 1,
    pet: { ...DEFAULT_SETTINGS.pet, ...(s.pet ?? {}) },
    display: { ...DEFAULT_SETTINGS.display, ...(s.display ?? {}) },
    providers: { ...DEFAULT_SETTINGS.providers, ...(s.providers ?? {}) },
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
