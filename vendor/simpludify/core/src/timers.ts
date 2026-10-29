import { EngineError, positive } from "./diagnostics";
import { cleanupAll, type LifetimeOwner } from "./lifetime";

interface Timer {
  remaining: number;
  interval: number;
  callback(): void;
  cancel(): void;
  removeOwner?: () => void;
  active: boolean;
}
export class SimulationTimers {
  private readonly timers = new Set<Timer>();
  private dead = false;
  private plan: readonly Timer[] = [];
  schedule(
    seconds: number,
    callback: () => void,
    repeat: boolean,
    owner?: LifetimeOwner,
  ): () => void {
    if (this.dead || owner?.disposed)
      throw new EngineError("OWNER_DISPOSED", "Timer owner has been disposed");
    if (repeat) positive(seconds, "interval");
    else if (!Number.isFinite(seconds) || seconds < 0)
      throw new EngineError(
        "INVALID_VALUE",
        "Timer delay must be finite and nonnegative",
      );
    const timer: Timer = {
      remaining: seconds,
      interval: repeat ? seconds : 0,
      callback,
      active: true,
      cancel: () => {
        if (!timer.active) return;
        timer.active = false;
        this.timers.delete(timer);
        const remove = timer.removeOwner;
        delete timer.removeOwner;
        remove?.();
      },
    };
    this.timers.add(timer);
    if (owner) {
      try {
        timer.removeOwner = owner.onDispose(timer.cancel);
      } catch (error) {
        timer.cancel();
        throw error;
      }
    }
    return timer.cancel;
  }
  /** Capture eligibility before any Scene update phase. */
  beginStep(): void {
    this.plan = [...this.timers];
  }
  step(seconds: number): void {
    const plan = this.plan;
    this.plan = [];
    if (!plan.length) return;
    const errors: unknown[] = [];
    for (const timer of plan) {
      if (!timer.active) continue;
      timer.remaining -= seconds;
      if (timer.remaining > 1e-12) continue;
      if (timer.interval === 0) {
        try {
          timer.cancel();
        } catch (error) {
          errors.push(error);
        }
      } else {
        // Preserve phase, but deliver at most once after a long step.
        const remainder = Math.max(0, -timer.remaining) % timer.interval;
        timer.remaining = timer.interval - remainder;
        if (timer.remaining <= 1e-12) timer.remaining = timer.interval;
      }
      try {
        timer.callback();
      } catch (error) {
        errors.push(error);
      }
      if (this.dead) break;
    }
    if (errors.length)
      throw new AggregateError(errors, "Timer callbacks failed");
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const timers = [...this.timers];
    try {
      cleanupAll(
        timers.map((timer) => timer.cancel),
        "Timer cleanup failed",
      );
    } finally {
      this.timers.clear();
      this.plan = [];
    }
  }
}
