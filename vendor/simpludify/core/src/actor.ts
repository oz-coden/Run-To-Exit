import {
  Component,
  ComponentPhase,
  type ComponentType,
  type UpdateContext,
} from "./component";
import { EngineError } from "./diagnostics";
import { EventBus } from "./events";
import { cleanupAll, Lifetime } from "./lifetime";
import type { Scene } from "./scene";

// Fixed identifiers are resolved once, outside per-Actor dispatch loops.
const inputPhase = ComponentPhase.Input,
  updatePhase = ComponentPhase.Update,
  integratePhase = ComponentPhase.Integrate,
  latePhase = ComponentPhase.LateUpdate;
export const ActorState = {
  Detached: "detached",
  Attached: "attached",
  Disposed: "disposed",
} as const;
export type ActorState = (typeof ActorState)[keyof typeof ActorState];
export interface ActorOptions {
  id?: string;
  enabled?: boolean;
}
const emptyPlan: readonly Component[] = Object.freeze([]);
const phases = Object.values(ComponentPhase);
export class Actor {
  private identifier: string | undefined;
  private owner: Scene | undefined;
  private readonly components = new Map<symbol, Component>();
  private inputPlan = emptyPlan;
  private updatePlan = emptyPlan;
  private integratePlan = emptyPlan;
  private latePlan = emptyPlan;
  private frameInput = emptyPlan;
  private frameUpdates = emptyPlan;
  private frameIntegrate = emptyPlan;
  private frameLate = emptyPlan;
  private attaching = false;
  private frameEligible = false;
  private readonly lifetime = new Lifetime();
  private bus: EventBus | undefined;
  private on: boolean;
  private destroying = false;
  constructor(options: ActorOptions = {}) {
    if (options.id !== undefined && !options.id.trim())
      throw new EngineError("INVALID_ID", "Actor id cannot be empty");
    this.identifier = options.id;
    this.on = options.enabled ?? true;
  }
  get id(): string | undefined {
    return this.identifier;
  }
  get scene(): Scene | undefined {
    return this.owner;
  }
  get state(): ActorState {
    return this.disposed
      ? ActorState.Disposed
      : this.owner
        ? ActorState.Attached
        : ActorState.Detached;
  }
  get disposed(): boolean {
    return this.destroying || this.lifetime.disposed;
  }
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    this.assertAlive();
    this.on = value;
  }
  get events(): EventBus {
    this.assertAlive();
    this.bus ??= new EventBus();
    return this.bus;
  }
  onDispose(callback: () => void): () => void {
    this.assertAlive();
    return this.lifetime.onDispose(callback);
  }
  private assertAlive(): void {
    if (this.disposed)
      throw new EngineError("ACTOR_DISPOSED", "Actor has been disposed", {
        actorId: this.id,
      });
  }
  get<T extends Component>(type: ComponentType<T>): T | undefined {
    return this.components.get(type.id) as T | undefined;
  }
  require<T extends Component>(type: ComponentType<T>): T {
    const value = this.get(type);
    if (!value)
      throw new EngineError(
        "COMPONENT_MISSING",
        "Required component is missing",
        { actorId: this.id, component: type.name },
      );
    return value;
  }
  private validate(
    type: ComponentType,
    visiting = new Set<symbol>(),
    visited = new Set<symbol>(),
  ): void {
    if (visiting.has(type.id))
      throw new EngineError(
        "COMPONENT_CYCLE",
        "Cyclic component requirements",
        { component: type.name, actorId: this.id },
      );
    if (visited.has(type.id)) return;
    visiting.add(type.id);
    for (const dependency of type.requires)
      this.validate(dependency, visiting, visited);
    visiting.delete(type.id);
    visited.add(type.id);
  }
  add<T extends Component>(component: T): T {
    this.assertAlive();
    if (this.attaching)
      throw new EngineError(
        "COMPONENT_MUTATION_REENTRANT",
        "Do not change component structure from onAttach",
      );
    this.validate(component.type);
    if (!phases.includes(component.phase))
      throw new EngineError("COMPONENT_PHASE", "Unknown Component phase", {
        component: component.type.name,
      });
    if (this.components.has(component.type.id))
      throw new EngineError(
        "COMPONENT_DUPLICATE",
        "Component type already exists",
        { actorId: this.id, component: component.type.name },
      );
    for (const dependency of component.type.requires)
      if (!this.components.has(dependency.id))
        throw new EngineError(
          "COMPONENT_MISSING",
          "Add required components before dependents",
          {
            actorId: this.id,
            component: component.type.name,
            dependency: dependency.name,
          },
        );
    if (component.disposed)
      throw new EngineError(
        "COMPONENT_OWNERSHIP",
        "Cannot add a disposed component",
      );
    this.components.set(component.type.id, component);
    this.attaching = true;
    try {
      component.attachTo(this);
      this.assertAlive();
      if (component.disposed)
        throw new EngineError(
          "COMPONENT_DISPOSED",
          "Component was disposed during attachment",
        );
    } catch (error) {
      this.components.delete(component.type.id);
      throw error;
    } finally {
      this.attaching = false;
    }
    this.rebuild();
    return component;
  }
  remove<T extends Component>(type: ComponentType<T>): boolean {
    this.assertAlive();
    if (this.attaching)
      throw new EngineError(
        "COMPONENT_MUTATION_REENTRANT",
        "Do not change component structure from onAttach",
      );
    const component = this.components.get(type.id);
    if (!component) return false;
    for (const other of this.components.values())
      if (other.type.requires.some((required) => required.id === type.id))
        throw new EngineError(
          "COMPONENT_REQUIRED",
          "Remove dependents before their dependency",
          {
            actorId: this.id,
            component: type.name,
            dependent: other.type.name,
          },
        );
    this.components.delete(type.id);
    this.rebuild();
    component.destroyOwned();
    return true;
  }
  private rebuild(): void {
    let input: Component[] | undefined,
      update: Component[] | undefined,
      integrate: Component[] | undefined,
      late: Component[] | undefined;
    for (const component of this.components.values())
      if (component.update !== Component.prototype.update) {
        switch (component.phase) {
          case inputPhase:
            input ??= [];
            input.push(component);
            break;
          case updatePhase:
            update ??= [];
            update.push(component);
            break;
          case integratePhase:
            integrate ??= [];
            integrate.push(component);
            break;
          case latePhase:
            late ??= [];
            late.push(component);
            break;
        }
      }
    this.inputPlan = input ?? emptyPlan;
    this.updatePlan = update ?? emptyPlan;
    this.integratePlan = integrate ?? emptyPlan;
    this.latePlan = late ?? emptyPlan;
    this.owner?.touch();
  }
  /** @internal */ attachTo(scene: Scene, id: string): void {
    this.assertAlive();
    if (this.owner)
      throw new EngineError(
        "ACTOR_OWNERSHIP",
        "Actor already belongs to a scene",
        { actorId: this.id },
      );
    this.identifier = id;
    this.owner = scene;
  }
  /** @internal */ get hasUpdates(): boolean {
    return (
      this.inputPlan.length > 0 ||
      this.updatePlan.length > 0 ||
      this.integratePlan.length > 0 ||
      this.latePlan.length > 0
    );
  }
  /** @internal */ beginStep(): void {
    this.frameInput = this.inputPlan;
    this.frameUpdates = this.updatePlan;
    this.frameIntegrate = this.integratePlan;
    this.frameLate = this.latePlan;
    this.frameEligible = this.enabled && !this.disposed;
  }
  /** @internal */ updatePhase(
    phase: ComponentPhase,
    context: UpdateContext,
  ): void {
    const plan =
      phase === inputPhase
        ? this.frameInput
        : phase === updatePhase
          ? this.frameUpdates
          : phase === integratePhase
            ? this.frameIntegrate
            : this.frameLate;
    if (!plan.length) return;
    if (
      !this.frameEligible ||
      !this.enabled ||
      this.disposed ||
      this.owner !== context.scene
    )
      return;
    for (const component of plan) {
      if (!this.enabled || this.disposed || this.owner !== context.scene) break;
      if (component.enabled && !component.disposed) component.update(context);
    }
  }
  /** @internal */ destroyOwned(): void {
    if (this.disposed) return;
    this.destroying = true;
    this.owner = undefined;
    const components = [...this.components.values()].reverse();
    this.inputPlan = emptyPlan;
    this.updatePlan = emptyPlan;
    this.integratePlan = emptyPlan;
    this.latePlan = emptyPlan;
    this.frameInput = emptyPlan;
    this.frameUpdates = emptyPlan;
    this.frameIntegrate = emptyPlan;
    this.frameLate = emptyPlan;
    try {
      cleanupAll(
        [
          () => this.lifetime.dispose(),
          () => this.bus?.dispose(),
          ...components.map((component) => () => {
            try {
              component.destroyOwned();
            } finally {
              this.components.delete(component.type.id);
            }
          }),
        ],
        "Actor cleanup failed",
      );
    } finally {
      this.components.clear();
      this.bus = undefined;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    if (this.owner) this.owner.remove(this);
    else this.destroyOwned();
  }
}
