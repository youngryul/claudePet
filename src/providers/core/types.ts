/**
 * Provider-agnostic model. Nothing in here knows about Claude.
 *
 * Data trust: every number carries a `source`. Values an agent reports directly are
 * RAW (e.g. "claude_statusline"); values we infer are "derived". The UI shows the
 * difference, and never mixes up context-window tokens with subscription limits.
 */

export type AIActivityState =
  | "offline"
  | "idle"
  | "working"
  | "thinking"
  | "tool"
  | "waiting"
  | "completed"
  | "error";

export type DataSource =
  | "claude_statusline"
  | "claude_hook"
  | "process_probe"
  | "derived"
  | "mock"
  | "unavailable";

export interface Metric<T = number> {
  value: T | null;
  source: DataSource;
  updatedAt: number | null;
}

export interface RateWindow {
  /** Subscription limit consumed, 0-100. NOT a token count. */
  usedPercentage: Metric;
  /** Epoch ms when the window resets, if known. */
  resetsAt: number | null;
}

export interface ContextUsage {
  /** Share of the model's context window currently filled (input side only). */
  usedPercentage: Metric;
  /** Tokens currently in the context window (a gauge, not a lifetime counter). */
  inputTokens: Metric;
  /** Output tokens of the most recent response (a gauge). */
  outputTokens: Metric;
  windowSize: number | null;
}

export interface SessionUsage {
  linesAdded: Metric;
  linesRemoved: Metric;
  costUsd: Metric;
}

export interface AIUsage {
  context: ContextUsage;
  fiveHour: RateWindow;
  weekly: RateWindow;
  session: SessionUsage;
}

export interface AIStatus extends AIUsage {
  provider: string;
  providerName: string;
  /** We are receiving data from the agent (or its process is running). */
  connected: boolean;
  activity: AIActivityState;
  /** Where `activity` came from: raw hook, heuristics, process probe or mock. */
  activitySource: DataSource;
  /** e.g. the running tool name or an error type. */
  activityDetail: string | null;
  model: string | null;
  sessionId: string | null;
  activeSessions: number;
  thinkingEnabled: boolean | null;
  effortLevel: string | null;
  updatedAt: number;
}

/**
 * Cumulative counters observed for one session. The usage tracker turns consecutive
 * observations into deltas, so values are never double-counted.
 */
export interface UsageObservation {
  provider: string;
  sessionId: string;
  model: string | null;
  observedAt: number;
  /** Lifetime-of-session counters (monotonic unless the session restarts). */
  cumulative: {
    linesAdded: number | null;
    linesRemoved: number | null;
    costUsd: number | null;
    apiDurationMs: number | null;
  };
  /** Token usage of the most recent API call, if the agent reports it. */
  lastCall: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  } | null;
  /** Current context size (gauge) - used only as a fallback token estimate. */
  contextTokens: number | null;
  fiveHourPct: number | null;
  fiveHourResetsAt: number | null;
  weeklyPct: number | null;
  weeklyResetsAt: number | null;
}

export type LifecycleKind = "session_start" | "turn_complete" | "session_end";

export interface LifecycleEvent {
  provider: string;
  sessionId: string;
  kind: LifecycleKind;
  at: number;
}

export type Unsubscribe = () => void;

export interface ProviderCapabilities {
  activity: boolean;
  contextUsage: boolean;
  subscriptionLimits: boolean;
  tokenCounts: boolean;
  codeChanges: boolean;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** false for providers that are placeholders in this build. */
  readonly implemented: boolean;
  getStatus(): Promise<AIStatus>;
  getUsage(): Promise<AIUsage>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onStatus(listener: (s: AIStatus) => void): Unsubscribe;
  onUsage(listener: (o: UsageObservation) => void): Unsubscribe;
  onLifecycle(listener: (e: LifecycleEvent) => void): Unsubscribe;
}
