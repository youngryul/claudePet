/**
 * Frontend side of the Claude collector: receives RAW_EVENTs forwarded by the Rust
 * backend (statusLine payloads + hook payloads) and hands them to the provider.
 */
import { backend } from "@/lib/backend";
import type { CollectorEvent } from "./ClaudeTypes";

export interface CollectorSink {
  (event: CollectorEvent, opts: { replay: boolean }): void;
}

export class ClaudeCollector {
  private unlisten: (() => void) | null = null;

  constructor(private readonly sink: CollectorSink) {}

  async start(): Promise<void> {
    this.unlisten = await backend.onCollectorEvent((e) => {
      if (e.provider === "claude") this.sink(e, { replay: false });
    });
    // Rebuild state after a reload/restart from the backend's in-memory buffer.
    // Replayed events update activity/usage but never re-fire lifecycle (XP) events.
    const snap = await backend.collectorSnapshot();
    const replay = [...snap.recentHooks, ...(snap.lastStatusline ? [snap.lastStatusline] : [])].sort(
      (a, b) => a.receivedAt - b.receivedAt,
    );
    for (const e of replay) this.sink(e, { replay: true });
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}
