import type { Actor } from "./actor";
import { EngineError } from "./diagnostics";
import { EventBus, type EventType } from "./events";
import { cleanupAll, Lifetime } from "./lifetime";
import type { Scene } from "./scene";
export const ComponentPhase = {
  Input: "input",
  Update: "update",
  Integrate: "integrate",
  LateUpdate: "late-update",
} as const;
export type ComponentPhase =
  (typeof ComponentPhase)[keyof typeof ComponentPhase];
export interface UpdateContext {
  readonly delta: number;
  readonly scene: Scene;
}
export interface ComponentType<T extends Component = Component> {
  readonly id: symbol;
  readonly name: string;
  readonly requires: readonly ComponentType[];
  readonly instance?: T;
}
export function defineComponent<T extends Component>(
  name: string,
  requires: readonly ComponentType[] = [],
): ComponentType<T> {
  return Object.freeze({
    id: Symbol(name),
    name,
    requires: Object.freeze([...requires]),
  });
}
export abstract class Component {
  abstract readonly type: ComponentType;
  readonly phase: ComponentPhase = ComponentPhase.Update;
  private owner: Actor | undefined;
  private readonly lifetime = new Lifetime();
  private bus: EventBus | undefined;
  private on = true;
  get actor(): Actor {
    if (!this.owner)
      throw new EngineError("COMPONENT_DETACHED", "Component is not attached", {
        component: this.type.name,
      });
    return this.owner;
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    if (this.disposed)
      throw new EngineError(
        "COMPONENT_DISPOSED",
        "Component has been disposed",
      );
    if (this.on === value) return;
    this.on = value;
    if (!value) this.onDisable();
  }
  get events(): EventBus {
    if (this.disposed)
      throw new EngineError(
        "COMPONENT_DISPOSED",
        "Component has been disposed",
      );
    this.bus ??= new EventBus();
    return this.bus;
  }
  protected emit<T>(type: EventType<T>, payload: NoInfer<T>): void {
    this.bus?.emit(type, payload);
  }
  onDispose(callback: () => void): () => void {
    return this.lifetime.onDispose(callback);
  }
  protected onAttach(): void {}
  protected onDisable(): void {}
  protected onDestroy(): void {}
  update(_context: UpdateContext): void {}
  /** @internal */ attachTo(actor: Actor): void {
    if (this.disposed || this.owner)
      throw new EngineError(
        "COMPONENT_OWNERSHIP",
        "Component must be new and unowned",
        { component: this.type.name },
      );
    this.owner = actor;
    try {
      this.onAttach();
    } catch (error) {
      try {
        this.destroyOwned();
      } catch {
        /* Preserve the attach error. */
      }
      throw error;
    }
  }
  /** @internal */ destroyOwned(): void {
    if (this.disposed) return;
    try {
      cleanupAll(
        [
          () => this.lifetime.dispose(),
          () => this.bus?.dispose(),
          () => this.onDestroy(),
        ],
        "Component cleanup failed",
      );
    } finally {
      this.owner = undefined;
      this.bus = undefined;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    if (this.owner) this.owner.remove(this.type);
    else this.destroyOwned();
  }
}
