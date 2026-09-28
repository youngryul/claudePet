/**
 * Maps AI status -> pet state with a declarative, prioritised rule table.
 *
 * - Exactly one *primary* state wins: the highest-priority matching rule.
 * - Condition rules (fatigue/context) that did not win become *modifiers*, so e.g.
 *   "coding while at 85% of the 5h limit" shows the coding animation with sweat.
 * To change behaviour, edit the table - not the resolver.
 */
import type { AIActivityState } from "@/providers/core/types";
import type { PetModifier, PetState } from "./PetStates";

export interface PetContext {
  activity: AIActivityState;
  /** Subscription usage, 0-100, or null when unknown. */
  fiveHour: number | null;
  weekly: number | null;
  /** Context window usage, 0-100, or null when unknown. */
  context: number | null;
}

export interface PetRule {
  id: string;
  priority: number;
  state: PetState;
  when: (c: PetContext) => boolean;
  /** Overlay to show when this condition holds but another rule won. */
  modifier?: PetModifier;
}

const gte = (v: number | null, t: number) => v !== null && v >= t;
const usage = (c: PetContext) => Math.max(c.fiveHour ?? -1, c.weekly ?? -1);
const is = (...a: AIActivityState[]) => (c: PetContext) => a.includes(c.activity);

export const THRESHOLDS = {
  slightlyTired: 60,
  tired: 80,
  exhausted: 95,
  confused: 80,
  overwhelmed: 95,
} as const;

export const PET_RULES: PetRule[] = [
  { id: "offline", priority: 1000, state: "sleeping", when: is("offline") },
  { id: "error", priority: 900, state: "dizzy", when: is("error") },
  { id: "waiting", priority: 850, state: "looking_at_user", when: is("waiting") },
  { id: "completed", priority: 800, state: "celebrating", when: is("completed") },
  {
    id: "context-overwhelmed",
    priority: 750,
    state: "overwhelmed",
    when: (c) => gte(c.context, THRESHOLDS.overwhelmed),
    modifier: "question",
  },
  { id: "thinking", priority: 700, state: "thinking", when: is("thinking") },
  { id: "tool", priority: 650, state: "working", when: is("tool") },
  { id: "working", priority: 600, state: "coding", when: is("working") },
  {
    id: "usage-exhausted",
    priority: 500,
    state: "exhausted",
    when: (c) => usage(c) >= THRESHOLDS.exhausted,
    modifier: "sweat",
  },
  {
    id: "usage-tired",
    priority: 450,
    state: "tired",
    when: (c) => usage(c) >= THRESHOLDS.tired,
    modifier: "sweat",
  },
  {
    id: "context-confused",
    priority: 420,
    state: "confused",
    when: (c) => gte(c.context, THRESHOLDS.confused),
    modifier: "question",
  },
  {
    id: "usage-slightly-tired",
    priority: 400,
    state: "slightly_tired",
    when: (c) => usage(c) >= THRESHOLDS.slightlyTired,
    modifier: "heavy_eyes",
  },
  { id: "idle", priority: 0, state: "idle", when: () => true },
];

export interface PetResolution {
  state: PetState;
  ruleId: string;
  modifiers: PetModifier[];
}

export function resolvePetState(ctx: PetContext, rules: PetRule[] = PET_RULES): PetResolution {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const matching = sorted.filter((r) => r.when(ctx));
  const winner = matching[0] ?? { id: "idle", state: "idle" as PetState };
  const modifiers: PetModifier[] = [];
  if (winner.id !== "offline") {
    for (const r of matching) {
      if (r !== winner && r.modifier && !modifiers.includes(r.modifier)) modifiers.push(r.modifier);
    }
  }
  return { state: winner.state, ruleId: winner.id, modifiers };
}
