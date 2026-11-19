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
  | "eating"
  | "cheering";

export const PET_STATE_INFO: Record<PetState, { label: string; mood: string }> = {
  sleeping: { label: "Sleeping", mood: "Zzz… no agent running" },
  idle: { label: "Idle", mood: "Hanging out" },
  coding: { label: "Coding", mood: "Typing away" },
  thinking: { label: "Thinking", mood: "Hmm…" },
  working: { label: "Using tools", mood: "Running a tool" },
  looking_at_user: { label: "Waiting for you", mood: "Needs your input!" },
  celebrating: { label: "Done!", mood: "Task complete 🎉" },
  dizzy: { label: "Error", mood: "Something went wrong" },
  eating: { label: "Lunch break", mood: "Slurp… yum" },
  cheering: { label: "Cheering", mood: "You can do it!" },
};
