import { EngineError } from "./diagnostics";
export interface LifetimeOwner {
  readonly disposed: boolean;
  onDispose(callback: () => void): () => void;
}
/** Lazy, removable LIFO cleanup. Disposed owners cannot acquire new resources. */
export class Lifetime implements LifetimeOwner {
  private callbacks: Set<() => void> | undefined;
  private dead = false;
  get disposed(): boolean {
    return this.dead;
  }
  onDispose(callback: () => void): () => void {
    if (this.dead)
      throw new EngineError(
        "OWNER_DISPOSED",
        "Cannot register cleanup on a disposed owner",
      );
    this.callbacks ??= new Set();
    this.callbacks.add(callback);
    return () => {
      this.callbacks?.delete(callback);
    };
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const callbacks = this.callbacks;
    this.callbacks = undefined;
    const errors: unknown[] = [];
    if (callbacks)
      for (const callback of [...callbacks].reverse()) {
        try {
          callback();
        } catch (error) {
          errors.push(error);
        }
      }
    if (errors.length)
      throw new AggregateError(errors, "Owned resource cleanup failed");
  }
}
/** Execute every cleanup even when one throws. */
export function cleanupAll(
  actions: Iterable<() => void>,
  message: string,
): void {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, message);
}
