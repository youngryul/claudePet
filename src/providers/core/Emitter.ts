import type { Unsubscribe } from "./types";

/** Tiny typed listener set. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();

  on(listener: (v: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const l of this.listeners) {
      try {
        l(value);
      } catch (err) {
        console.error("listener failed", err);
      }
    }
  }
}
