/**
 * Typed bridge to the Rust backend. The only file that calls `invoke` directly.
 * When running in a plain browser (`npm run dev` without Tauri) calls resolve to
 * harmless defaults so the UI can still be previewed.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CollectorEvent, CollectorSnapshot } from "@/providers/claude/ClaudeTypes";

export const inTauri = isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!inTauri) return fallback as T;
  return invoke<T>(cmd, args);
}

export async function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return () => {};
  return listen<T>(event, (e) => handler(e.payload));
}

export async function broadcast<T>(event: string, payload: T): Promise<void> {
  if (!inTauri) {
    window.dispatchEvent(new CustomEvent(event, { detail: payload }));
    return;
  }
  await emit(event, payload);
}

export interface AppInfo {
  version: string;
  devMode: boolean;
  platform: string;
  dataDir: string | null;
  collectorPort: number | null;
}

export interface DailyRow {
  date: string;
  codingMs: number;
  sessions: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  linesAdded: number;
  linesRemoved: number;
  costUsd: number;
  xp: number;
}

export interface PetProgress {
  xp: number;
  streak: number;
  bestStreak: number;
  lastActiveDate: string | null;
  streakBonusXp: number;
}

export interface DashboardData {
  today: DailyRow;
  totals: DailyRow;
  days: DailyRow[];
  progress: PetProgress;
}

export interface SessionCursorRow {
  sessionId: string;
  model: string | null;
  ended: boolean;
  cursor: unknown;
  lastSeen: number;
}

export interface UsageDeltaBatch {
  date: string;
  provider: string;
  codingMs: number;
  sessions: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  linesAdded: number;
  linesRemoved: number;
  costUsd: number;
  xp: number;
  cursors: SessionCursorRow[];
}

export interface UsageSample {
  ts: number;
  provider: string;
  metric: string;
  value: number;
  source: string;
  resetDetected: boolean;
}

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectionStatus {
  statusLineConnected: boolean;
  connectedHooks: string[];
  missingHooks: string[];
  foreignStatusLine: unknown | null;
  fullyConnected: boolean;
}

export interface ClaudeDetection {
  installed: boolean;
  cliPath: string | null;
  version: string | null;
  configDir: string | null;
  configDirExists: boolean;
  settingsPath: string | null;
  settingsExists: boolean;
  settingsError: string | null;
  status: ConnectionStatus;
  exePath: string | null;
  isDevBuild: boolean;
  shell: string;
}

export interface SettingsChange {
  kind: "add" | "update" | "wrap" | "remove" | "restore";
  description: string;
}

export interface SettingsPreview {
  action: "connect" | "disconnect";
  settingsPath: string;
  before: string;
  after: string;
  changes: SettingsChange[];
  baseHash: string;
  warnings: string[];
}

export interface ApplyResult {
  backupPath: string | null;
  status: ConnectionStatus;
  changed: boolean;
}

export interface ConnectionTest {
  collectorOk: boolean;
  lastClaudeEventAt: number | null;
  message: string;
}

const emptyDay = (date: string): DailyRow => ({
  date,
  codingMs: 0,
  sessions: 0,
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  linesAdded: 0,
  linesRemoved: 0,
  costUsd: 0,
  xp: 0,
});

export const backend = {
  appInfo: () =>
    call<AppInfo>("app_info", undefined, {
      version: "dev",
      devMode: true,
      platform: "browser",
      dataDir: null,
      collectorPort: null,
    }),
  collectorSnapshot: () =>
    call<CollectorSnapshot>("collector_snapshot", undefined, {
      port: null,
      lastStatusline: null,
      recentHooks: [],
      lastEventAt: null,
    }),
  onCollectorEvent: (h: (e: CollectorEvent) => void) => on<CollectorEvent>("collector://event", h),
  claudeProcessRunning: () => call<boolean | null>("claude_process_running", undefined, null),

  settingsLoad: () => call<unknown | null>("settings_load", undefined, null),
  settingsSave: (settings: unknown) => call<void>("settings_save", { settings }),

  statsApply: (batch: UsageDeltaBatch) =>
    call<PetProgress>("stats_apply", { batch }, { xp: 0, streak: 0, bestStreak: 0, lastActiveDate: null, streakBonusXp: 0 }),
  statsDashboard: (today: string, days: number) =>
    call<DashboardData>("stats_dashboard", { today, days }, {
      today: emptyDay(today),
      totals: emptyDay("total"),
      days: Array.from({ length: days }, (_, i) => emptyDay(`d${i}`)),
      progress: { xp: 0, streak: 0, bestStreak: 0, lastActiveDate: null, streakBonusXp: 0 },
    }),
  statsSessionCursor: (provider: string, sessionId: string) =>
    call<unknown | null>("stats_session_cursor", { provider, sessionId }, null),
  statsRecordSamples: (samples: UsageSample[]) => call<void>("stats_record_samples", { samples }),

  petSetInteraction: (clickThrough: boolean, interactive: boolean, hit: HitRect | null) =>
    call<void>("pet_set_interaction", { clickThrough, interactive, hit }),
  petSetVisible: (visible: boolean) => call<void>("pet_set_visible", { visible }),
  petResetPosition: () => call<void>("pet_reset_position"),
  openDashboard: (tab?: string) => call<void>("open_dashboard", { tab: tab ?? null }),
  traySetStatus: (label: string) => call<void>("tray_set_status", { label }),
  autostartChanged: () => call<void>("autostart_changed"),

  claudeDetect: () => call<ClaudeDetection>("claude_detect"),
  claudePreview: (action: "connect" | "disconnect") => call<SettingsPreview>("claude_preview", { action }),
  claudeApply: (action: "connect" | "disconnect", baseHash: string) =>
    call<ApplyResult>("claude_apply", { action, baseHash }),
  claudeTestConnection: () => call<ConnectionTest>("claude_test_connection"),
};
