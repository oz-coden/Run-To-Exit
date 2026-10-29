import { EngineError } from "./diagnostics";
import { cleanupAll, type LifetimeOwner } from "./lifetime";
/** @internal Shared lifetime for logical and device contributions. */
export abstract class OwnedInputSource {
  private dead = false;
  private removeOwner: (() => void) | undefined;
  get disposed(): boolean {
    return this.dead;
  }
  /** @internal */ own(owner: LifetimeOwner): void {
    if (owner.disposed)
      throw new EngineError("OWNER_DISPOSED", "Input owner has been disposed");
    this.removeOwner = owner.onDispose(() => this.dispose());
  }
  protected writable(neutral: boolean): boolean {
    if (!this.dead) return true;
    if (neutral) return false;
    throw new EngineError("OWNER_DISPOSED", "Input source has been disposed");
  }
  protected abstract release(remove: boolean): void;
  clear(): void {
    if (!this.dead) this.release(false);
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const remove = this.removeOwner;
    this.removeOwner = undefined;
    cleanupAll(
      [() => this.release(true), () => remove?.()],
      "Input source cleanup failed",
    );
  }
}
