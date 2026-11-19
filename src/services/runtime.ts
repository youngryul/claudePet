/**
 * AgentRuntime runs in the pet window (always alive, even when hidden). It owns the
 * providers and the usage tracker, and broadcasts status to other windows.
 *
 *   Provider (RAW -> AIStatus) -> pickDisplayed -> aiStore -> PetStateMachine -> Pet UI
 *            (UsageObservation) -> UsageTracker -> SQLite
 */
import { backend, broadcast, on } from "@/lib/backend";
import { PROVIDER_FACTORIES } from "@/providers/registry";
import { SALIENCE } from "@/providers/core/sessionActivity";
import type { AIProvider, AIStatus } from "@/providers/core/types";
import { useAI } from "@/stores/aiStore";
import { usePet } from "@/stores/petStore";
import { useSettings } from "@/stores/settingsStore";
import { localDate } from "@/utils/format";
import type { MockScenario } from "./mockScenarios";
import { UsageTracker } from "./usageTracker";

export const EVT_STATUS = "ai://status";
export const EVT_REQUEST_STATUS = "ai://request-status";
export const EVT_MOCK = "dev://mock";
export const EVT_PROGRESS = "pet://progress";
/** The sync folder changed; account-wide totals must be reloaded. */
export const EVT_SYNC_CHANGED = "sync://changed";
/** Other devices write to the sync folder on their own schedule; poll for their XP. */
const REFRESH_MS = 60_000;

function trayLabel(s: AIStatus): string {
  if (!s.connected) return `○ ${s.providerName} Offline`;
  const act = s.activity === "offline" ? "" : ` — ${s.activity}`;
  return `● ${s.providerName} Connected${act}`;
}

/**
 * With several agents enabled the pet follows the busiest one (waiting beats working
 * beats idle); on a tie, the primary provider.
 */
export function pickDisplayed(statuses: AIStatus[], primary: string): AIStatus | null {
  let best: AIStatus | null = null;
  for (const s of statuses) {
    const rank = SALIENCE[s.activity] * 2 + (s.provider === primary ? 1 : 0);
    const bestRank = best ? SALIENCE[best.activity] * 2 + (best.provider === primary ? 1 : 0) : -1;
    if (rank > bestRank) best = s;
  }
  return best;
}

export async function startRuntime(): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const { providers } = useSettings.getState().settings;
  const active: AIProvider[] = providers.enabled
    .map((id) => PROVIDER_FACTORIES[id]?.())
    .filter((p): p is AIProvider => !!p && p.implemented);

  const refreshToday = async () => {
    const d = await backend.statsDashboard(localDate(new Date()), 1).catch(() => null);
    if (d) {
      usePet.getState().setProgress(d.progress);
      usePet.getState().setTodayCodingMs(d.today.codingMs);
    }
  };
  await refreshToday();
  const refreshTimer = setInterval(() => void refreshToday(), REFRESH_MS);
  cleanups.push(() => clearInterval(refreshTimer));
  cleanups.push(await on(EVT_SYNC_CHANGED, () => void refreshToday()));

  let lastTray = "";
  const latest = new Map<string, AIStatus>();
  const show = () => {
    const s = pickDisplayed([...latest.values()], providers.primary);
    if (!s) return;
    useAI.getState().setLive(s);
    void broadcast(EVT_STATUS, s);
    const label = trayLabel(s);
    if (label !== lastTray) {
      lastTray = label;
      void backend.traySetStatus(label);
    }
  };
  for (const provider of active) {
    const tracker = new UsageTracker(provider.id, (progress) => {
      usePet.getState().setProgress(progress);
      void refreshToday();
      void broadcast(EVT_PROGRESS, progress);
    });
    tracker.start();
    cleanups.push(() => void tracker.stop());
    cleanups.push(provider.onUsage((o) => void tracker.observe(o)));
    cleanups.push(provider.onLifecycle((e) => void tracker.lifecycle(e)));

    cleanups.push(
      provider.onStatus((s) => {
        tracker.activityTick(s, Date.now());
        latest.set(provider.id, s);
        show();
      }),
    );
    await provider.start();
    cleanups.push(() => void provider.stop());
  }

  // Dashboard windows ask for the current status when they open.
  cleanups.push(
    await on(EVT_REQUEST_STATUS, () => {
      void broadcast(EVT_STATUS, useAI.getState().live);
    }),
  );
  cleanups.push(await on<MockScenario | null>(EVT_MOCK, (m) => useAI.getState().setMock(m)));

  const flushOnExit = () => cleanups.forEach((c) => c());
  window.addEventListener("beforeunload", flushOnExit);
  return () => {
    window.removeEventListener("beforeunload", flushOnExit);
    flushOnExit();
  };
}
