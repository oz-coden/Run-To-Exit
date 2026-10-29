import type { Actor } from "./actor";
import {
  Collider,
  CollisionResponse,
  CollisionShape,
  type Contact,
  ContactEnter,
  ContactExit,
  ContactStay,
} from "./collider";
import { CollisionBody } from "./collision-body";
import {
  contactPhase,
  type Mutable,
  observeContact,
} from "./collision-contact";
import {
  contactManifold,
  createGeometry,
  type Geometry,
  type Manifold,
  updateGeometry,
} from "./collision-geometry";
import { allowsPair, pairResponse } from "./collision-policy";
import { correctPositions } from "./collision-response";
import { Transform } from "./components";
import { EngineError } from "./diagnostics";
import type { EventType } from "./events";
import { Lifetime } from "./lifetime";
import { type Scene, SceneState } from "./scene";
import {
  exposedFaces,
  tileGeometry,
  tileRange,
  tileResponseManifold,
} from "./tile-collision-geometry";
import {
  type TileContact,
  TileContactEnter,
  TileContactExit,
  TileContactStay,
} from "./tile-contact";
import { type Tilemap, TilemapLayer } from "./tilemap";
import type { ResolvedTileCollision } from "./tilemap-collision";

export * from "./collider";
export * from "./collision-body";
export * from "./tile-contact";

interface Entry {
  readonly id: number;
  readonly collider: Collider;
  readonly actor: Actor;
  readonly transform: Transform;
  readonly geometry: Geometry;
}
interface MapEntry {
  readonly id: number;
  readonly map: Tilemap<string>;
  /** Geometry records exist only for observed cells, shared by their contact pairs. */
  readonly targets: Map<number, TileTarget>;
}
interface TileTarget {
  readonly owner: MapEntry;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly collider: { readonly shape: typeof CollisionShape.Box };
  readonly geometry: Geometry;
  policy: ResolvedTileCollision;
  users: number;
}
interface PairState {
  seen: number;
  aEntered: boolean;
  bEntered: boolean;
}
interface ActorPair extends PairState {
  readonly kind: "actor";
  readonly a: Entry;
  readonly b: Entry;
  readonly aContact: Mutable<Contact>;
  readonly bContact: Mutable<Contact>;
}
interface TilePair extends PairState {
  readonly kind: "tile";
  readonly a: Entry;
  readonly b: TileTarget;
  readonly aContact: Mutable<TileContact>;
  previous: TileContact | undefined;
}
type Pair = ActorPair | TilePair;
export interface CollisionWorldOptions {
  iterations?: number;
  tolerance?: number;
}
const sceneWorlds = new WeakMap<Scene, CollisionWorld>();
const actorEvents = {
  enter: ContactEnter,
  stay: ContactStay,
  exit: ContactExit,
};
const tileEvents = {
  enter: TileContactEnter,
  stay: TileContactStay,
  exit: TileContactExit,
};
const tileShape = { shape: CollisionShape.Box } as const;
/** One Scene-owned candidate/response/contact pipeline, with typed delivery at its boundary. */
export class CollisionWorld {
  private readonly lifetime = new Lifetime();
  private readonly entries = new Map<Collider, Entry>();
  private readonly maps = new Map<Tilemap<string>, MapEntry>();
  private readonly pairs = new Map<Entry, Map<Entry | TileTarget, Pair>>();
  private readonly sorted: Entry[] = [];
  private readonly activeMaps: MapEntry[] = [];
  private readonly delivery: Pair[] = [];
  private readonly solving: Pair[] = [];
  private readonly manifold: Manifold = { normalX: 0, normalY: 0, depth: 0 };
  private readonly scratchTile = {
    collider: tileShape,
    geometry: createGeometry(),
  };
  private readonly range = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly iterations: number;
  private readonly tolerance: number;
  private corrections = 0;
  private solverPasses = 0;
  private unresolved = 0;
  private revision = -1;
  private serial = 0;
  private mapSerial = 0;
  private pass = 0;
  private stepping = false;
  private contactCount = 0;
  private candidates = 0;
  private tests = 0;
  private tileCount = 0;
  private tileCandidates = 0;
  private policyRejected = 0;
  private tileTests = 0;
  private tileCorrections = 0;
  private tileResponseTests = 0;
  private tileUnresolved = 0;
  private neighborProbes = 0;
  constructor(
    readonly scene: Scene,
    options: CollisionWorldOptions = {},
  ) {
    this.iterations = options.iterations ?? 6;
    this.tolerance = options.tolerance ?? 1e-7;
    if (
      !Number.isInteger(this.iterations) ||
      this.iterations < 1 ||
      this.iterations > 32 ||
      !Number.isFinite(this.tolerance) ||
      this.tolerance < 0
    )
      throw new EngineError(
        "INVALID_VALUE",
        "Collision iterations must be 1..32 and tolerance must be finite and nonnegative",
      );
    if (sceneWorlds.has(scene))
      throw new EngineError(
        "COLLISION_WORLD_DUPLICATE",
        "Only one automatic collision world may own a scene",
      );
    this.lifetime.onDispose(scene.onPostUpdate(() => this.step()));
    this.lifetime.onDispose(scene.onDispose(() => this.dispose()));
    sceneWorlds.set(scene, this);
    this.lifetime.onDispose(() => {
      sceneWorlds.delete(scene);
    });
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  /** Actor broad-phase counters retain their existing meaning; terrain is separate below. */
  get diagnostics() {
    return {
      colliders: this.entries.size,
      contacts: this.contactCount,
      candidates: this.candidates,
      narrowTests: this.tests,
    };
  }
  get responseDiagnostics() {
    return {
      passes: this.solverPasses,
      corrections: this.corrections,
      unresolved: this.unresolved,
    };
  }
  get tileDiagnostics() {
    let retainedCells = 0;
    for (const entry of this.maps.values()) retainedCells += entry.targets.size;
    return {
      maps: this.maps.size,
      candidateCells: this.tileCandidates,
      policyRejected: this.policyRejected,
      narrowTests: this.tileTests,
      contacts: this.tileCount,
      corrections: this.tileCorrections,
      responseTests: this.tileResponseTests,
      unresolved: this.tileUnresolved,
      neighborProbes: this.neighborProbes,
      retainedCells,
    };
  }
  contactsFor(collider: Collider): readonly Contact[] {
    const contacts: Contact[] = [];
    for (const group of this.pairs.values())
      for (const pair of group.values())
        if (
          pair.kind === "actor" &&
          pair.seen === this.pass &&
          this.valid(pair)
        ) {
          if (pair.a.collider === collider) contacts.push({ ...pair.aContact });
          else if (pair.b.collider === collider)
            contacts.push({ ...pair.bContact });
        }
    return contacts;
  }
  tileContactsFor(collider: Collider): readonly TileContact[] {
    const entry = this.entries.get(collider),
      contacts: TileContact[] = [];
    if (entry)
      for (const pair of this.pairs.get(entry)?.values() ?? [])
        if (pair.kind === "tile" && pair.seen === this.pass && this.valid(pair))
          contacts.push({ ...pair.aContact });
    return contacts;
  }
  private inverseMass(entry: Entry): number {
    const body = entry.actor.get(CollisionBody.type);
    return body?.enabled ? body.inverseMass : 0;
  }
  private eligible(entry: Entry): boolean {
    return (
      !entry.collider.disposed &&
      entry.collider.enabled &&
      !entry.actor.disposed &&
      entry.actor.enabled &&
      entry.actor.scene === this.scene &&
      entry.actor.get(Collider.type) === entry.collider
    );
  }
  private mapEligible(map: Tilemap<string>): boolean {
    return (
      !map.disposed &&
      map.enabled &&
      map.collisionEnabled &&
      map.scene === this.scene
    );
  }
  private valid(pair: Pair): boolean {
    return (
      this.eligible(pair.a) &&
      (pair.kind === "actor"
        ? this.eligible(pair.b)
        : this.mapEligible(pair.b.owner.map))
    );
  }
  private reconcile(): void {
    if (this.revision === this.scene.revision) return;
    this.revision = this.scene.revision;
    for (const [collider, entry] of this.entries)
      if (
        collider.disposed ||
        entry.actor.scene !== this.scene ||
        entry.actor.get(Collider.type) !== collider
      )
        this.entries.delete(collider);
    for (const [map] of this.maps)
      if (map.disposed || map.scene !== this.scene) this.maps.delete(map);
    for (const actor of this.scene.actors) {
      const collider = actor.get(Collider.type);
      if (collider && !this.entries.has(collider))
        this.entries.set(collider, {
          id: ++this.serial,
          collider,
          actor,
          transform: actor.require(Transform.type),
          geometry: createGeometry(),
        });
      const map = actor.get(TilemapLayer.type)?.map;
      if (map && !this.maps.has(map))
        this.maps.set(map, { id: ++this.mapSerial, map, targets: new Map() });
    }
  }
  private group(a: Entry): Map<Entry | TileTarget, Pair> {
    let group = this.pairs.get(a);
    if (!group) {
      group = new Map();
      this.pairs.set(a, group);
    }
    return group;
  }
  private actorPair(a: Entry, b: Entry): ActorPair {
    let sign = 1;
    if (a.id > b.id) {
      const swap = a;
      a = b;
      b = swap;
      sign = -1;
    }
    const group = this.group(a);
    let pair = group.get(b) as ActorPair | undefined;
    if (!pair) {
      pair = {
        kind: "actor",
        a,
        b,
        seen: this.pass,
        aEntered: false,
        bEntered: false,
        aContact: {
          normalX: 0,
          normalY: 0,
          depth: 0,
          response: CollisionResponse.Trigger,
          resolved: false,
          self: a.collider,
          other: b.collider,
          selfActor: a.actor,
          otherActor: b.actor,
        },
        bContact: {
          normalX: 0,
          normalY: 0,
          depth: 0,
          response: CollisionResponse.Trigger,
          resolved: false,
          self: b.collider,
          other: a.collider,
          selfActor: b.actor,
          otherActor: a.actor,
        },
      };
      group.set(b, pair);
      this.contactCount++;
    }
    observeContact(
      pair,
      this.pass,
      this.manifold,
      pairResponse(a.collider, b.collider),
      sign,
    );
    return pair;
  }
  private tilePair(
    a: Entry,
    owner: MapEntry,
    x: number,
    y: number,
    policy: ResolvedTileCollision,
  ): TilePair {
    const index = y * owner.map.width + x;
    let target = owner.targets.get(index);
    if (!target) {
      target = {
        owner,
        index,
        x,
        y,
        collider: tileShape,
        geometry: createGeometry(),
        policy,
        users: 0,
      };
      owner.targets.set(index, target);
    }
    target.policy = policy;
    tileGeometry(owner.map, x, y, target.geometry);
    const group = this.group(a);
    let pair = group.get(target) as TilePair | undefined;
    const response = pairResponse(a.collider, policy);
    if (!pair) {
      pair = {
        kind: "tile",
        a,
        b: target,
        seen: this.pass,
        aEntered: false,
        bEntered: false,
        previous: undefined,
        aContact: {
          normalX: 0,
          normalY: 0,
          depth: 0,
          response,
          resolved: false,
          self: a.collider,
          selfActor: a.actor,
          map: owner.map,
          tileX: x,
          tileY: y,
          tileId: owner.map.get(x, y),
          policy,
        },
      };
      group.set(target, pair);
      target.users++;
      this.tileCount++;
    }
    if (pair.seen !== this.pass && pair.aContact.response !== response) {
      if (pair.aEntered) pair.previous = { ...pair.aContact };
      pair.aEntered = false;
    }
    observeContact(pair, this.pass, this.manifold, response);
    pair.aContact.tileId = owner.map.get(x, y);
    pair.aContact.policy = policy;
    return pair;
  }
  private remove(pair: Pair): void {
    const group = this.pairs.get(pair.a);
    if (group?.delete(pair.b)) {
      if (pair.kind === "actor") this.contactCount--;
      else {
        this.tileCount--;
        if (--pair.b.users === 0) pair.b.owner.targets.delete(pair.b.index);
      }
    }
    if (!group?.size) this.pairs.delete(pair.a);
  }
  private capture(): void {
    this.sorted.length = 0;
    for (const entry of this.entries.values())
      if (this.eligible(entry) && updateGeometry(entry))
        this.sorted.push(entry);
    this.sorted.sort(
      (a, b) => a.geometry.minX - b.geometry.minX || a.id - b.id,
    );
    this.activeMaps.length = 0;
    for (const entry of this.maps.values())
      if (this.mapEligible(entry.map) && entry.map.hasCollision)
        this.activeMaps.push(entry);
  }
  private scanActors(solidOnly: boolean): void {
    for (let i = 0; i < this.sorted.length; i++) {
      const a = this.sorted[i];
      if (!a) continue;
      for (let j = i + 1; j < this.sorted.length; j++) {
        const b = this.sorted[j];
        if (!b || b.geometry.minX > a.geometry.maxX + this.tolerance) break;
        this.candidates++;
        const solid =
          pairResponse(a.collider, b.collider) === CollisionResponse.Solid;
        if (
          (solidOnly && !solid) ||
          a.geometry.maxY + this.tolerance < b.geometry.minY ||
          b.geometry.maxY + this.tolerance < a.geometry.minY ||
          !allowsPair(a.collider, b.collider)
        )
          continue;
        this.tests++;
        if (contactManifold(a, b, this.manifold, this.tolerance)) {
          const pair = this.actorPair(a, b);
          if (solidOnly) this.solving.push(pair);
          else if (
            solid &&
            this.manifold.depth > this.tolerance &&
            (this.inverseMass(a) > 0 || this.inverseMass(b) > 0)
          )
            this.unresolved++;
        }
      }
    }
  }
  private scanTiles(solidOnly: boolean): void {
    for (const a of this.sorted)
      for (const owner of this.activeMaps) {
        const map = owner.map;
        if (!tileRange(map, a.geometry, this.tolerance, this.range)) continue;
        for (let y = this.range.y0; y <= this.range.y1; y++)
          for (let x = this.range.x0; x <= this.range.x1; x++) {
            this.tileCandidates++;
            const policy = map.getCollision(x, y);
            const solid =
              policy &&
              pairResponse(a.collider, policy) === CollisionResponse.Solid;
            if (
              !policy ||
              (solidOnly && !solid) ||
              !allowsPair(a.collider, policy)
            ) {
              this.policyRejected++;
              continue;
            }
            this.tileTests++;
            tileGeometry(map, x, y, this.scratchTile.geometry);
            if (
              !contactManifold(
                a,
                this.scratchTile,
                this.manifold,
                this.tolerance,
              )
            )
              continue;
            const pair = this.tilePair(a, owner, x, y, policy);
            if (solidOnly) this.solving.push(pair);
            else if (
              solid &&
              this.manifold.depth > this.tolerance &&
              this.inverseMass(a) > 0
            ) {
              this.unresolved++;
              this.tileUnresolved++;
            }
          }
      }
  }
  private compare(a: Pair, b: Pair): number {
    if (a.kind !== b.kind) return a.kind === "actor" ? -1 : 1;
    if (a.kind === "actor" && b.kind === "actor")
      return a.a.id - b.a.id || a.b.id - b.b.id;
    if (a.kind === "tile" && b.kind === "tile")
      return (
        a.a.id - b.a.id || a.b.owner.id - b.b.owner.id || a.b.index - b.b.index
      );
    return 0;
  }
  private correct(pair: Pair): boolean {
    updateGeometry(pair.a);
    let hit: boolean;
    if (pair.kind === "actor") {
      updateGeometry(pair.b);
      hit = contactManifold(pair.a, pair.b, this.manifold, this.tolerance);
    } else {
      tileGeometry(pair.b.owner.map, pair.b.x, pair.b.y, pair.b.geometry);
      this.tileResponseTests++;
      this.neighborProbes += 4;
      hit = tileResponseManifold(
        pair.a,
        pair.b,
        exposedFaces(pair.b.owner.map, pair.b.x, pair.b.y, pair.b.policy),
        this.manifold,
        this.tolerance,
      );
    }
    if (!hit || this.manifold.depth <= this.tolerance) return false;
    const moved = correctPositions(
      pair.a.transform,
      pair.kind === "actor" ? pair.b.transform : pair.b.geometry,
      this.manifold,
      this.inverseMass(pair.a),
      pair.kind === "actor" ? this.inverseMass(pair.b) : 0,
    );
    if (moved) {
      this.corrections++;
      pair.aContact.resolved = true;
      if (pair.kind === "actor") pair.bContact.resolved = true;
      else this.tileCorrections++;
    }
    return moved;
  }
  private notify<T>(
    collider: Collider,
    type: EventType<T>,
    contact: T,
    errors: unknown[],
  ): void {
    try {
      collider.notify(type, contact);
    } catch (error) {
      errors.push(error);
    }
  }
  private deliver(errors: unknown[]): void {
    this.delivery.length = 0;
    for (const group of this.pairs.values())
      for (const pair of group.values()) this.delivery.push(pair);
    this.delivery.sort((a, b) => this.compare(a, b));
    for (const pair of this.delivery) {
      if (this.disposed) break;
      if (pair.kind === "tile" && pair.previous) {
        const previous = pair.previous;
        pair.previous = undefined;
        if (!pair.a.collider.disposed)
          this.notify(pair.a.collider, TileContactExit, previous, errors);
        if (this.disposed) break;
      }
      const active = pair.seen === this.pass && this.valid(pair);
      const phase = contactPhase(pair.aEntered, active);
      if (!active) {
        this.remove(pair);
        if (pair.aEntered && !pair.a.collider.disposed) {
          if (pair.kind === "actor")
            this.notify(
              pair.a.collider,
              actorEvents[phase],
              pair.aContact,
              errors,
            );
          else
            this.notify(
              pair.a.collider,
              tileEvents[phase],
              pair.aContact,
              errors,
            );
        }
        if (
          !this.disposed &&
          pair.kind === "actor" &&
          pair.bEntered &&
          !pair.b.collider.disposed
        )
          this.notify(pair.b.collider, ContactExit, pair.bContact, errors);
        continue;
      }
      pair.aEntered = true;
      if (pair.kind === "actor")
        this.notify(pair.a.collider, actorEvents[phase], pair.aContact, errors);
      else
        this.notify(pair.a.collider, tileEvents[phase], pair.aContact, errors);
      if (this.disposed || !this.valid(pair)) continue;
      if (pair.kind === "actor") {
        const bPhase = contactPhase(pair.bEntered, true);
        pair.bEntered = true;
        this.notify(
          pair.b.collider,
          actorEvents[bPhase],
          pair.bContact,
          errors,
        );
      }
    }
  }
  step(): void {
    if (this.disposed)
      throw new EngineError(
        "COLLISION_WORLD_DISPOSED",
        "Collision world has been disposed",
      );
    if (this.stepping)
      throw new EngineError(
        "COLLISION_REENTRANT",
        "Contact delivery cannot recursively step the same world",
      );
    if (this.scene.state !== SceneState.Active)
      throw new EngineError(
        "SCENE_STATE",
        "Contact detection requires an active scene",
      );
    this.stepping = true;
    this.pass++;
    this.candidates =
      this.tests =
      this.tileCandidates =
      this.policyRejected =
      this.tileTests =
      this.tileResponseTests =
      this.neighborProbes =
        0;
    this.corrections =
      this.solverPasses =
      this.unresolved =
      this.tileCorrections =
      this.tileUnresolved =
        0;
    const errors: unknown[] = [];
    try {
      this.reconcile();
      this.capture(); // Validate all Actor geometry before any translation.
      if (
        this.sorted.some(
          (entry) =>
            entry.collider.response === CollisionResponse.Solid &&
            this.inverseMass(entry) > 0,
        )
      ) {
        for (let iteration = 0; iteration < this.iterations; iteration++) {
          this.solving.length = 0;
          this.scanActors(true);
          this.scanTiles(true);
          this.solving.sort((a, b) => this.compare(a, b));
          let changed = false;
          this.solverPasses++;
          for (const pair of this.solving)
            changed = this.correct(pair) || changed;
          if (!changed) break;
          this.capture();
        }
      }
      // Triggers sample final positions; encountered Solid pairs remain observed for this pass.
      this.scanActors(false);
      this.scanTiles(false);
      this.deliver(errors);
      if (errors.length)
        throw new AggregateError(errors, "Contact handlers failed");
    } finally {
      this.stepping = false;
      this.sorted.length =
        this.activeMaps.length =
        this.solving.length =
        this.delivery.length =
          0;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    try {
      this.lifetime.dispose();
    } finally {
      this.entries.clear();
      this.maps.clear();
      this.pairs.clear();
      this.sorted.length =
        this.activeMaps.length =
        this.solving.length =
        this.delivery.length =
          0;
      this.contactCount = this.tileCount = 0;
    }
  }
}
