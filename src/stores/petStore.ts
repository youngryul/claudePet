import { create } from "zustand";
import type { PetProgress } from "@/lib/backend";

interface PetStore {
  progress: PetProgress;
  todayCodingMs: number;
  popoverOpen: boolean;
  setProgress: (p: PetProgress) => void;
  setTodayCodingMs: (ms: number) => void;
  setPopoverOpen: (open: boolean) => void;
}

export const usePet = create<PetStore>((set) => ({
  progress: { xp: 0, streak: 0, bestStreak: 0, lastActiveDate: null, streakBonusXp: 0 },
  todayCodingMs: 0,
  popoverOpen: false,
  setProgress: (progress) => set({ progress }),
  setTodayCodingMs: (todayCodingMs) => set({ todayCodingMs }),
  setPopoverOpen: (popoverOpen) => set({ popoverOpen }),
}));
