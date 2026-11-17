/**
 * Chat with the pet. Rust runs `claude -p` and streams `chat://event`s; this store
 * keeps the conversation and a `phase` the pet window turns into an animation.
 */
import { create } from "zustand";
import { backend, inTauri, on } from "@/lib/backend";

export type ChatPhase = "idle" | "thinking" | "talking" | "done" | "error";

export interface ChatMessage {
  role: "user" | "pet";
  text: string;
  error?: boolean;
}

export type ChatEvent =
  | { kind: "started" }
  | { kind: "delta"; text: string }
  | { kind: "done"; text: string | null }
  | { kind: "error"; message: string };

interface ChatStore {
  messages: ChatMessage[];
  phase: ChatPhase;
  send: (text: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  apply: (e: ChatEvent) => void;
}

/** How long the pet keeps celebrating / looking dizzy after a reply. */
const AFTERGLOW_MS = { done: 2500, error: 3500 };
let afterglow: ReturnType<typeof setTimeout> | undefined;

const busy = (p: ChatPhase) => p === "thinking" || p === "talking";

/** Replace (or append) the pet's message for the reply in progress. */
function withPetText(messages: ChatMessage[], update: (prev: string) => string, error = false): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "pet") return [...messages.slice(0, -1), { role: "pet", text: update(last.text), error }];
  return [...messages, { role: "pet", text: update(""), error }];
}

export const useChat = create<ChatStore>((set, get) => ({
  messages: [],
  phase: "idle",

  apply: (e) => {
    clearTimeout(afterglow);
    switch (e.kind) {
      case "started":
        set({ phase: "thinking" });
        return;
      case "delta":
        set((s) => ({ phase: "talking", messages: withPetText(s.messages, (prev) => prev + e.text) }));
        return;
      case "done":
        // Prefer the CLI's final text; it is complete even if a delta was missed.
        set((s) => ({ phase: "done", messages: e.text ? withPetText(s.messages, () => e.text ?? "") : s.messages }));
        break;
      case "error":
        set((s) => ({ phase: "error", messages: withPetText(s.messages, () => e.message, true) }));
        break;
    }
    const phase = get().phase as "done" | "error";
    afterglow = setTimeout(() => set({ phase: "idle" }), AFTERGLOW_MS[phase]);
  },

  send: async (raw) => {
    const text = raw.trim();
    if (!text || busy(get().phase)) return;
    set((s) => ({ messages: [...s.messages, { role: "user", text }], phase: "thinking" }));
    if (!inTauri) return mockReply(get().apply);
    try {
      await backend.chatSend(text);
    } catch (err) {
      get().apply({ kind: "error", message: String(err) });
    }
  },

  cancel: () => {
    if (busy(get().phase)) void backend.chatCancel();
  },

  reset: () => {
    if (busy(get().phase)) return;
    void backend.chatReset();
    set({ messages: [] });
  },
}));

/** Subscribe the store to backend chat events. Call once from the pet window. */
export const listenChat = () => on<ChatEvent>("chat://event", (e) => useChat.getState().apply(e));

/** Browser preview (`npm run dev`) has no backend: fake a short streamed reply. */
function mockReply(apply: (e: ChatEvent) => void) {
  const words = "냐옹! 브라우저 미리보기라서 진짜 Claude 대신 제가 대답해요. 앱에서는 Claude Code가 답해 줄 거예요.".split(" ");
  apply({ kind: "started" });
  words.forEach((w, i) => setTimeout(() => apply({ kind: "delta", text: (i ? " " : "") + w }), 600 + i * 120));
  setTimeout(() => apply({ kind: "done", text: null }), 700 + words.length * 120);
}
