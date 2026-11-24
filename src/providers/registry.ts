import { ClaudeProvider } from "./claude/ClaudeProvider";
import { CodexProvider } from "./codex/CodexProvider";
import type { AIProvider } from "./core/types";
import { GeminiProvider } from "./gemini/GeminiProvider";

/**
 * All known providers. To add one: implement `AIProvider` (see README "Adding another
 * Provider") and register a factory here. The pet only ever sees `AIStatus`.
 */
export const PROVIDER_FACTORIES: Record<string, () => AIProvider> = {
  claude: () => new ClaudeProvider(),
  codex: () => new CodexProvider(),
  gemini: () => new GeminiProvider(),
};

export const PROVIDER_INFO = [
  { id: "claude", name: "Claude Code", implemented: true },
  { id: "codex", name: "Codex", implemented: true },
  { id: "gemini", name: "Gemini CLI", implemented: false },
] as const;

export type ProviderId = (typeof PROVIDER_INFO)[number]["id"];
