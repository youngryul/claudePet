/**
 * Maps AI status -> pet state with a declarative, prioritised rule table.
 * Exactly one state wins: the highest-priority matching rule.
 * To change behaviour, edit the table - not the resolver.
 */
import type { AIActivityState } from "@/providers/core/types";
import type { PetState } from "./PetStates";

export interface PetContext {
  activity: AIActivityState;
  /** Inside the lunch break of the work schedule (see `workday.ts`). */
  lunch?: boolean;
  /** A cheer-up minute of the work schedule (see `isCheerTime`). */
  cheer?: boolean;
}

export interface PetRule {
  id: string;
  priority: number;
  state: PetState;
  when: (c: PetContext) => boolean;
}

const is = (...a: AIActivityState[]) => (c: PetContext) => a.includes(c.activity);

export const PET_RULES: PetRule[] = [
  // Schedule moments win over everything except what needs attention (an error, a prompt).
  {
    id: "lunch",
    priority: 1100,
    state: "eating",
    when: (c) => !!c.lunch && c.activity !== "error" && c.activity !== "waiting",
  },
  {
    id: "cheer",
    priority: 1050,
    state: "cheering",
    when: (c) => !!c.cheer && c.activity !== "error" && c.activity !== "waiting",
  },
  { id: "offline", priority: 1000, state: "sleeping", when: is("offline") },
  { id: "error", priority: 900, state: "dizzy", when: is("error") },
  { id: "waiting", priority: 850, state: "looking_at_user", when: is("waiting") },
  { id: "completed", priority: 800, state: "celebrating", when: is("completed") },
  { id: "thinking", priority: 700, state: "thinking", when: is("thinking") },
  { id: "tool", priority: 650, state: "working", when: is("tool") },
  { id: "working", priority: 600, state: "coding", when: is("working") },
  { id: "idle", priority: 0, state: "idle", when: () => true },
];

export interface PetResolution {
  state: PetState;
  ruleId: string;
}

export function resolvePetState(ctx: PetContext, rules: PetRule[] = PET_RULES): PetResolution {
  const winner = [...rules].sort((a, b) => b.priority - a.priority).find((r) => r.when(ctx));
  return winner ? { state: winner.state, ruleId: winner.id } : { state: "idle", ruleId: "idle" };
}
