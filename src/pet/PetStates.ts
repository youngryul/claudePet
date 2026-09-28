/** Pet-side vocabulary. Independent of any AI provider. */

export type PetState =
  | "sleeping"
  | "idle"
  | "coding"
  | "thinking"
  | "working"
  | "looking_at_user"
  | "celebrating"
  | "dizzy"
  | "slightly_tired"
  | "tired"
  | "exhausted"
  | "confused"
  | "overwhelmed";

/** Condition overlays that can decorate an activity state (e.g. coding while tired). */
export type PetModifier = "sweat" | "question" | "heavy_eyes";

export const PET_STATE_INFO: Record<PetState, { label: string; mood: string }> = {
  sleeping: { label: "Sleeping", mood: "Zzz… no agent running" },
  idle: { label: "Idle", mood: "Hanging out" },
  coding: { label: "Coding", mood: "Typing away" },
  thinking: { label: "Thinking", mood: "Hmm…" },
  working: { label: "Using tools", mood: "Running a tool" },
  looking_at_user: { label: "Waiting for you", mood: "Needs your input!" },
  celebrating: { label: "Done!", mood: "Task complete 🎉" },
  dizzy: { label: "Error", mood: "Something went wrong" },
  slightly_tired: { label: "A bit tired", mood: "5h usage over 60%" },
  tired: { label: "Tired", mood: "Usage over 80%" },
  exhausted: { label: "Exhausted", mood: "Usage nearly maxed" },
  confused: { label: "Confused", mood: "Context over 80%" },
  overwhelmed: { label: "Overwhelmed", mood: "Context nearly full" },
};
