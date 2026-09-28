import { Emitter } from "./Emitter";
import { emptyStatus } from "./metric";
import type { AIProvider, AIStatus, AIUsage, LifecycleEvent, ProviderCapabilities, UsageObservation } from "./types";

/**
 * Base for providers that are declared but not implemented yet (Codex, Gemini CLI).
 * They always report "offline" so the UI and registry can already list them.
 */
export class PlaceholderProvider implements AIProvider {
  readonly implemented: boolean = false;
  readonly capabilities: ProviderCapabilities = {
    activity: false,
    contextUsage: false,
    subscriptionLimits: false,
    tokenCounts: false,
    codeChanges: false,
  };
  private status = new Emitter<AIStatus>();
  private usage = new Emitter<UsageObservation>();
  private lifecycle = new Emitter<LifecycleEvent>();

  constructor(readonly id: string, readonly name: string) {}

  async getStatus(): Promise<AIStatus> {
    return emptyStatus(this.id, this.name);
  }
  async getUsage(): Promise<AIUsage> {
    const { context, fiveHour, weekly, session } = emptyStatus(this.id, this.name);
    return { context, fiveHour, weekly, session };
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onStatus = (l: (s: AIStatus) => void) => this.status.on(l);
  onUsage = (l: (o: UsageObservation) => void) => this.usage.on(l);
  onLifecycle = (l: (e: LifecycleEvent) => void) => this.lifecycle.on(l);
}
