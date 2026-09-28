import { create } from "zustand";
import { emptyStatus } from "@/providers/core/metric";
import type { AIStatus } from "@/providers/core/types";
import type { MockScenario } from "@/services/mockScenarios";

interface AIStore {
  /** Real status from the primary provider. */
  live: AIStatus;
  /** Developer-mode override; when set, the pet shows this instead. */
  mock: MockScenario | null;
  setLive: (s: AIStatus) => void;
  setMock: (m: MockScenario | null) => void;
}

export const useAI = create<AIStore>((set) => ({
  live: emptyStatus("claude", "Claude Code"),
  mock: null,
  setLive: (live) => set({ live }),
  setMock: (mock) => set({ mock }),
}));

/** The status the UI should display (mock wins in developer mode). */
export const selectStatus = (s: AIStore): AIStatus => s.mock?.status ?? s.live;
