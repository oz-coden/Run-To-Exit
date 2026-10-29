import type { Actor } from "./actor";
import { ComponentPhase, type UpdateContext } from "./component";
import { EngineError } from "./diagnostics";
import type { Engine } from "./engine";
import { EventBus } from "./events";
import type { InputSystem } from "./input";
import { cleanupAll, Lifetime, type LifetimeOwner } from "./lifetime";
import { SimulationTimers } from "./timers";

// Fixed identifiers are resolved once, outside per-Actor dispatch loops.
const inputPhase = ComponentPhase.Input,
  updatePhase = ComponentPhase.Update,
  integratePhase = ComponentPhase.Integrate,
  latePhase = ComponentPhase.LateUpdate;
export const SceneState = {
  Preparing: "preparing",
  Ready: "ready",
  Active: "active",
  Inactive: "inactive",
  Disposed: "disposed",
} as const;
export type SceneState = (typeof SceneState)[keyof typeof SceneState];
export class Scene {
  private phase: SceneState = SceneState.Preparing;
  private engineOwner: Engine | undefined;
  private inputScope: InputSystem | undefined;
  private readonly members = new Map<string, Actor>();
  private roster: readonly Actor[] = [];
  private rosterDirty = false;
  private nextId = 0;
  private updateRevision = -1;
  private updateActors: readonly Actor[] = [];
  private frameActors: readonly Actor[] = [];
  private readonly postUpdates = new Set<(seconds: number) => void>();
  private postPlan: readonly ((seconds: number) => void)[] = [];
  private version = 0;
  private readonly lifetime = new Lifetime();
  private bus: EventBus | undefined;
  private timers: SimulationTimers | undefined;
  private readonly updates = new Set<(seconds: number) => void>();
  private updatePlan: readonly ((seconds: number) => void)[] = [];
  private readonly activations = new Set<() => void>();
  private readonly deactivations = new Set<() => void>();
  constructor(readonly id: string) {
    if (!id.trim())
      throw new EngineError("INVALID_ID", "Scene id cannot be empty");
  }
  get state(): SceneState {
    return this.phase;
  }
  get disposed(): boolean {
    return this.phase === SceneState.Disposed;
  }
  get revision(): number {
    return this.version;
  }
  get actors(): readonly Actor[] {
    if (this.rosterDirty) {
      this.roster = [...this.members.values()];
      this.rosterDirty = false;
    }
    return this.roster;
  }
  get events(): EventBus {
    this.assertAlive();
    this.bus ??= new EventBus();
    return this.bus;
  }
  private assertAlive(): void {
    if (this.disposed || this.phase === SceneState.Inactive)
      throw new EngineError(
        "SCENE_DISPOSED",
        "Scene can no longer acquire resources",
        { sceneId: this.id },
      );
  }
  add<T extends Actor>(actor: T): T {
    this.assertAlive();
    if (actor.disposed || actor.scene)
      throw new EngineError(
        "ACTOR_OWNERSHIP",
        "Actor must be new and unowned",
        { sceneId: this.id, actorId: actor.id },
      );
    let id = actor.id;
    if (id === undefined)
      do {
        id = `actor-${++this.nextId}`;
      } while (this.members.has(id));
    if (this.members.has(id))
      throw new EngineError("DUPLICATE_ACTOR", "Actor id already exists", {
        sceneId: this.id,
        actorId: id,
      });
    actor.attachTo(this, id);
    this.members.set(id, actor);
    this.rosterDirty = true;
    this.touch();
    return actor;
  }
  find(id: string): Actor | undefined {
    return this.members.get(id);
  }
  remove(actorOrId: Actor | string): boolean {
    const actor =
      typeof actorOrId === "string" ? this.members.get(actorOrId) : actorOrId;
    if (
      !actor ||
      actor.scene !== this ||
      actor.id === undefined ||
      this.members.get(actor.id) !== actor
    )
      return false;
    this.members.delete(actor.id);
    this.rosterDirty = true;
    this.touch();
    actor.destroyOwned();
    return true;
  }
  /** @internal */ touch(): void {
    this.version++;
  }
  onUpdate(callback: (seconds: number) => void): () => void {
    this.assertAlive();
    this.updates.add(callback);
    this.updatePlan = [...this.updates];
    return () => {
      this.updates.delete(callback);
      this.updatePlan = [...this.updates];
    };
  }
  /** Runs after every captured Actor component update and before timers/onUpdate. */
  onPostUpdate(callback: (seconds: number) => void): () => void {
    this.assertAlive();
    this.postUpdates.add(callback);
    this.postPlan = [...this.postUpdates];
    return () => {
      this.postUpdates.delete(callback);
      this.postPlan = [...this.postUpdates];
    };
  }
  onActivate(callback: () => void): () => void {
    this.assertAlive();
    if (this.phase !== SceneState.Preparing && this.phase !== SceneState.Ready)
      throw new EngineError(
        "SCENE_STATE",
        "Register activation callbacks before activation",
        { sceneId: this.id },
      );
    this.activations.add(callback);
    return () => {
      this.activations.delete(callback);
    };
  }
  onDeactivate(callback: () => void): () => void {
    this.assertAlive();
    this.deactivations.add(callback);
    return () => {
      this.deactivations.delete(callback);
    };
  }
  onDispose(callback: () => void): () => void {
    this.assertAlive();
    return this.lifetime.onDispose(callback);
  }
  after(
    seconds: number,
    callback: () => void,
    owner?: LifetimeOwner,
  ): () => void {
    this.assertAlive();
    this.timers ??= new SimulationTimers();
    return this.timers.schedule(seconds, callback, false, owner);
  }
  every(
    seconds: number,
    callback: () => void,
    owner?: LifetimeOwner,
  ): () => void {
    this.assertAlive();
    this.timers ??= new SimulationTimers();
    return this.timers.schedule(seconds, callback, true, owner);
  }
  markReady(): void {
    this.assertAlive();
    if (this.phase !== SceneState.Preparing)
      throw new EngineError(
        "SCENE_STATE",
        "Only a preparing scene can become ready",
        { sceneId: this.id },
      );
    this.phase = SceneState.Ready;
  }
  /** @internal */ get inputOwner(): InputSystem | undefined {
    return this.engineOwner?.input;
  }
  /** @internal */ claimInput(input: InputSystem): void {
    this.assertAlive();
    if (
      (this.inputScope && this.inputScope !== input) ||
      (this.engineOwner && this.engineOwner.input !== input)
    )
      throw new EngineError(
        "SCENE_OWNERSHIP",
        "Action input must belong to the Scene's Engine",
        { sceneId: this.id },
      );
    this.inputScope = input;
  }
  /** @internal */ validateOwner(engine: Engine): void {
    this.assertAlive();
    if (
      (this.engineOwner && this.engineOwner !== engine) ||
      (this.inputScope && this.inputScope !== engine.input)
    )
      throw new EngineError(
        "SCENE_OWNERSHIP",
        "Scene belongs to another engine",
        { sceneId: this.id },
      );
  }
  /** @internal */ claim(engine: Engine): void {
    this.validateOwner(engine);
    this.engineOwner = engine;
  }
  /** @internal */ activateOwned(): void {
    this.phase = SceneState.Active;
  }
  /** @internal */ notifyActivated(): void {
    if (!this.disposed)
      cleanupAll(this.activations, "Scene activation callbacks failed");
  }
  /** @internal */ deactivateOwned(): void {
    if (this.phase !== SceneState.Active) return;
    this.phase = SceneState.Inactive;
    cleanupAll(this.deactivations, "Scene deactivation callbacks failed");
  }
  /** @internal */ beginStep(): void {
    if (this.phase !== SceneState.Active)
      throw new EngineError("SCENE_STATE", "Only active scenes can update", {
        sceneId: this.id,
      });
    this.timers?.beginStep();
    if (this.updateRevision !== this.revision) {
      this.updateActors = this.actors.filter((actor) => actor.hasUpdates);
      this.updateRevision = this.revision;
    }
    this.frameActors = this.updateActors;
    for (const actor of this.frameActors) actor.beginStep();
  }
  /** @internal */ step(context: UpdateContext): void {
    const actors = this.frameActors;
    for (const actor of actors) actor.updatePhase(inputPhase, context);
    for (const actor of actors) actor.updatePhase(updatePhase, context);
    for (const actor of actors) actor.updatePhase(integratePhase, context);
    for (const actor of actors) actor.updatePhase(latePhase, context);
    if (this.disposed) return;
    for (const callback of this.postPlan) {
      if (this.disposed) return;
      if (this.postUpdates.has(callback)) callback(context.delta);
    }
    if (this.disposed) return;
    this.timers?.step(context.delta);
    // Callback plans change only on subscription changes; iteration stays stable.
    if (this.updates.size)
      for (const callback of this.updatePlan) {
        if (this.disposed) break;
        if (this.updates.has(callback)) callback(context.delta);
      }
  }
  dispose(): void {
    if (this.disposed) return;
    const wasActive = this.phase === SceneState.Active;
    this.phase = SceneState.Disposed;
    const actors = this.actors;
    this.engineOwner = undefined;
    this.inputScope = undefined;
    this.members.clear();
    this.roster = [];
    this.rosterDirty = false;
    this.touch();
    try {
      cleanupAll(
        [
          ...(wasActive
            ? [
                () =>
                  cleanupAll(
                    this.deactivations,
                    "Scene deactivation callbacks failed",
                  ),
              ]
            : []),
          () => this.timers?.dispose(),
          () => this.bus?.dispose(),
          ...[...actors].reverse().map((actor) => () => actor.destroyOwned()),
          () => this.lifetime.dispose(),
        ],
        "Scene cleanup failed",
      );
    } finally {
      this.updateActors = [];
      this.frameActors = [];
      this.postUpdates.clear();
      this.postPlan = [];
      this.updates.clear();
      this.updatePlan = [];
      this.activations.clear();
      this.deactivations.clear();
      this.bus = undefined;
      this.timers = undefined;
    }
  }
}
