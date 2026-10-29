import { EngineError } from "./diagnostics";
import { cleanupAll, type LifetimeOwner } from "./lifetime";
export interface EventType<T> {
  readonly id: symbol;
  readonly name: string;
  readonly payload?: (value: T) => T;
}
export function defineEvent<T>(name: string): EventType<T> {
  return Object.freeze({ id: Symbol(name), name });
}
interface Subscription {
  active: boolean;
  deliver(payload: unknown): void;
  off(): void;
}
/** Synchronous registration-order delivery. Recursive delivery of the same token is rejected. */
export class EventBus {
  private readonly listeners = new Map<symbol, Set<Subscription>>();
  private readonly dispatching = new Set<symbol>();
  private dead = false;
  private assertAlive(): void {
    if (this.dead)
      throw new EngineError(
        "EVENT_BUS_DISPOSED",
        "Event bus has been disposed",
      );
  }
  on<T>(
    type: EventType<T>,
    handler: (payload: T) => void,
    owner?: LifetimeOwner,
  ): () => void {
    this.assertAlive();
    if (owner?.disposed)
      throw new EngineError(
        "OWNER_DISPOSED",
        "Cannot subscribe using a disposed owner",
        { event: type.name },
      );
    let removeOwnership: (() => void) | undefined;
    const group = this.listeners.get(type.id) ?? new Set<Subscription>();
    this.listeners.set(type.id, group);
    const subscription: Subscription = {
      active: true,
      deliver: (value) => {
        const result: unknown = handler(value as T);
        if (
          result &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          void Promise.resolve(result).catch(() => {});
          throw new EngineError(
            "EVENT_ASYNC_HANDLER",
            "Event handlers must be synchronous; own asynchronous tasks explicitly",
            { event: type.name },
          );
        }
      },
      off: () => {
        if (!subscription.active) return;
        subscription.active = false;
        group.delete(subscription);
        if (group.size === 0) this.listeners.delete(type.id);
        const remove = removeOwnership;
        removeOwnership = undefined;
        remove?.();
      },
    };
    group.add(subscription);
    if (owner) {
      try {
        removeOwnership = owner.onDispose(subscription.off);
      } catch (error) {
        subscription.off();
        throw error;
      }
    }
    return subscription.off;
  }
  emit<T>(type: EventType<T>, payload: NoInfer<T>): void {
    this.assertAlive();
    if (this.dispatching.has(type.id))
      throw new EngineError(
        "EVENT_REENTRANT",
        "Recursive delivery of the same event is not allowed",
        { event: type.name },
      );
    const group = this.listeners.get(type.id);
    if (!group?.size) return;
    const errors: unknown[] = [];
    this.dispatching.add(type.id);
    try {
      for (const subscription of [...group])
        if (subscription.active) {
          try {
            subscription.deliver(payload);
          } catch (error) {
            errors.push(error);
          }
        }
    } finally {
      this.dispatching.delete(type.id);
    }
    if (errors.length)
      throw new AggregateError(errors, `Event handlers failed: ${type.name}`);
  }
  listenerCount<T>(type?: EventType<T>): number {
    if (type) return this.listeners.get(type.id)?.size ?? 0;
    let count = 0;
    for (const group of this.listeners.values()) count += group.size;
    return count;
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const subscriptions = [...this.listeners.values()].flatMap((group) => [
      ...group,
    ]);
    try {
      cleanupAll(
        subscriptions.map((subscription) => subscription.off),
        "Event bus cleanup failed",
      );
    } finally {
      this.listeners.clear();
    }
  }
}
