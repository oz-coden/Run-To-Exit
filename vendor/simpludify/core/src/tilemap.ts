import { Actor, type ActorOptions } from "./actor";
import { samePolicy } from "./collision-policy";
import { Component, type ComponentType, defineComponent } from "./component";
import { type WorldPoint, worldPoint } from "./coordinates";
import { EngineError, positive } from "./diagnostics";
import { Grid } from "./grid";
import type { Scene } from "./scene";
import type { SpriteSheet } from "./sprite-sheet";
import {
  type ResolvedTileCollision,
  type TileCollisionChange,
  TileCollisionData,
  type TileCollisionOptions,
  type TileCollisionPolicy,
} from "./tilemap-collision";

export type {
  ResolvedTileCollision,
  TileCollisionOptions,
  TileCollisionPolicy,
} from "./tilemap-collision";

export type TileId<Name extends string = never> = number | Name | null;
export interface TilePoint {
  readonly space: "tile";
  readonly x: number;
  readonly y: number;
}
export interface TilemapOptions<Name extends string> extends ActorOptions {
  sheet: SpriteSheet<Name>;
  tiles:
    | Grid<TileId<NoInfer<Name>>>
    | readonly (readonly TileId<NoInfer<Name>>[])[];
  tileWidth: number;
  tileHeight: number;
  x?: number;
  y?: number;
  zIndex?: number;
  visible?: boolean;
  collision?: TileCollisionOptions<NoInfer<Name>>;
}
function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new EngineError(
      "INVALID_VALUE",
      "Tilemap position/depth must be finite",
    );
  return value;
}
/** One Scene-owned placement, not one Actor per cell. Input grids/rows are copied. */
export class Tilemap<Name extends string = never> {
  private readonly owner: Actor;
  readonly sheet: SpriteSheet<Name>;
  readonly tileWidth: number;
  readonly tileHeight: number;
  private cells: Grid<TileId<Name>>;
  private readonly counts = new Map<number | Name, number>();
  private readonly listeners = new Set<(index: number | null) => void>();
  private version = 0;
  private collisionData: TileCollisionData<Name> | undefined;
  private collisionVersion = 0;
  private collidable = true;
  private readonly collisionListeners = new Set<
    (change: TileCollisionChange<string>) => void
  >();
  private left = 0;
  private top = 0;
  private depth = 0;
  private shown = true;
  constructor(options: TilemapOptions<Name>) {
    this.owner = new Actor(options);
    this.sheet = options.sheet;
    this.tileWidth = positive(options.tileWidth, "tileWidth");
    this.tileHeight = positive(options.tileHeight, "tileHeight");
    const input = options.tiles;
    if (input instanceof Grid) {
      this.cells = Grid.generate(input.width, input.height, (x, y) =>
        this.validateTile(input.get(x, y)),
      );
    } else {
      if (
        !Array.isArray(input) ||
        !input.length ||
        !Array.isArray(input[0]) ||
        !input[0].length ||
        input.some(
          (row) => !Array.isArray(row) || row.length !== input[0]?.length,
        )
      )
        throw new EngineError(
          "GRID_SIZE",
          "Tilemap rows must form a nonempty rectangle",
        );
      this.cells = Grid.generate(input[0].length, input.length, (x, y) =>
        this.validateTile(input[y]?.[x] as TileId<Name>),
      );
    }
    this.cells.forEach((tile) => {
      this.count(tile, 1);
    });
    positive(this.width * this.tileWidth, "map world width");
    positive(this.height * this.tileHeight, "map world height");
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.zIndex = options.zIndex ?? 0;
    this.visible = options.visible ?? true;
    if (options.collision !== undefined)
      this.collisionData = new TileCollisionData(options.collision, (tile) => {
        this.sheet.get(tile);
      });
    this.owner.add(new TilemapLayer(this));
  }
  /** Uses existing Actor ownership without adding a second Scene collection. */
  place(scene: Scene): this {
    scene.add(this.owner);
    return this;
  }
  get scene(): Scene | undefined {
    return this.owner.scene;
  }
  get disposed(): boolean {
    return this.owner.disposed;
  }
  get enabled(): boolean {
    return this.owner.enabled;
  }
  set enabled(value: boolean) {
    this.owner.enabled = value;
  }
  dispose(): void {
    this.owner.dispose();
  }
  onDispose(callback: () => void): () => void {
    return this.owner.onDispose(callback);
  }
  private alive(): void {
    if (this.disposed)
      throw new EngineError("ACTOR_DISPOSED", "Tilemap has been disposed");
  }
  private validateTile(tile: TileId<Name>): TileId<Name> {
    if (tile !== null) this.sheet.get(tile);
    return tile;
  }
  private count(tile: TileId<Name>, change: number): void {
    if (tile === null) return;
    const n = (this.counts.get(tile) ?? 0) + change;
    if (n) this.counts.set(tile, n);
    else this.counts.delete(tile);
  }
  get width(): number {
    return this.cells.width;
  }
  get height(): number {
    return this.cells.height;
  }
  get revision(): number {
    return this.version;
  }
  get x(): number {
    return this.left;
  }
  set x(value: number) {
    this.alive();
    finite(value);
    finite(value + this.width * this.tileWidth);
    this.left = value;
  }
  get y(): number {
    return this.top;
  }
  set y(value: number) {
    this.alive();
    finite(value);
    finite(value + this.height * this.tileHeight);
    this.top = value;
  }
  get zIndex(): number {
    return this.depth;
  }
  set zIndex(value: number) {
    this.alive();
    this.depth = finite(value);
  }
  get visible(): boolean {
    return this.shown;
  }
  set visible(value: boolean) {
    this.alive();
    if (typeof value !== "boolean")
      throw new EngineError("INVALID_VALUE", "visible must be boolean");
    this.shown = value;
  }
  inBounds(x: number, y: number): boolean {
    return this.cells.inBounds(x, y);
  }
  get(x: number, y: number): TileId<Name> {
    return this.cells.get(x, y);
  }
  set(x: number, y: number, tile: TileId<Name>): void {
    this.alive();
    const previous = this.cells.get(x, y);
    this.validateTile(tile);
    if (previous === tile) return;
    const previousPolicy = this.getCollision(x, y);
    this.cells.set(x, y, tile);
    this.count(previous, -1);
    this.count(tile, 1);
    this.version++;
    if (!samePolicy(previousPolicy, this.getCollision(x, y)))
      this.collisionChanged({ kind: "cell", index: y * this.width + x });
    for (const notify of this.listeners) notify(y * this.width + x);
  }
  fill(tile: TileId<Name>): void {
    this.alive();
    this.validateTile(tile);
    let changed = false,
      collisionChanged = false;
    this.cells.forEach((old, x, y) => {
      if (old !== tile) changed = true;
      if (
        this.collisionData &&
        !samePolicy(
          this.collisionData.get(y * this.width + x, old),
          this.collisionData.get(y * this.width + x, tile),
        )
      )
        collisionChanged = true;
    });
    if (!changed) return;
    this.cells.fill(tile);
    this.counts.clear();
    this.count(tile, this.width * this.height);
    this.version++;
    if (collisionChanged) this.collisionChanged({ kind: "all" });
    for (const notify of this.listeners) notify(null);
  }
  get collisionRevision(): number {
    return this.collisionVersion;
  }
  get collisionEnabled(): boolean {
    return this.collidable;
  }
  set collisionEnabled(value: boolean) {
    this.alive();
    if (typeof value !== "boolean")
      throw new EngineError(
        "INVALID_VALUE",
        "collisionEnabled must be boolean",
      );
    if (this.collidable !== value) {
      this.collidable = value;
      this.collisionChanged({ kind: "all" });
    }
  }
  getCollision(x: number, y: number): ResolvedTileCollision | null {
    const tile = this.cells.get(x, y);
    return this.collisionData?.get(y * this.width + x, tile) ?? null;
  }
  setCollision(x: number, y: number, policy: TileCollisionPolicy | null): void {
    this.alive();
    this.cells.get(x, y);
    this.collisionData ??= new TileCollisionData();
    if (this.collisionData.set(y * this.width + x, policy))
      this.collisionChanged({ kind: "cell", index: y * this.width + x });
  }
  resetCollision(x: number, y: number): void {
    this.alive();
    this.cells.get(x, y);
    if (this.collisionData?.reset(y * this.width + x))
      this.collisionChanged({ kind: "cell", index: y * this.width + x });
  }
  setTileCollision(
    tile: number | NoInfer<Name>,
    policy: TileCollisionPolicy | null,
  ): void {
    this.alive();
    this.sheet.get(tile);
    this.collisionData ??= new TileCollisionData();
    if (this.collisionData.setDefault(tile, policy))
      this.collisionChanged({ kind: "tile", tile });
  }
  /** @internal Constant-time gate; never scans rules/overrides/cells. */
  get hasCollision(): boolean {
    return this.collisionData?.configured ?? false;
  }
  private collisionChanged(change: TileCollisionChange<string>): void {
    this.collisionVersion++;
    for (const notify of this.collisionListeners) notify(change);
  }
  /** @internal Optional observers use the placement lifetime, not rendering readiness. */
  onCollisionChanged(
    notify: (change: TileCollisionChange<string>) => void,
  ): () => void {
    this.alive();
    this.collisionListeners.add(notify);
    const unregister = this.onDispose(() =>
      this.collisionListeners.delete(notify),
    );
    return () => {
      unregister();
      this.collisionListeners.delete(notify);
    };
  }
  /** Independent data snapshot, reusable after this placement/Scene is disposed. */
  copyTiles(): Grid<TileId<Name>> {
    return Grid.generate(this.width, this.height, (x, y) => this.get(x, y));
  }
  tileToWorld(
    x: number,
    y: number,
    options: { center?: boolean } = {},
  ): WorldPoint {
    this.cells.get(x, y);
    const offset = options.center ? 0.5 : 0;
    return worldPoint(
      this.x + (x + offset) * this.tileWidth,
      this.y + (y + offset) * this.tileHeight,
    );
  }
  /** Half-open bounds: left/top included, right/bottom excluded; outside returns undefined. */
  worldToTile(x: number, y: number): TilePoint | undefined {
    finite(x);
    finite(y);
    const tx = Math.floor((x - this.x) / this.tileWidth),
      ty = Math.floor((y - this.y) / this.tileHeight);
    return this.inBounds(tx, ty) ? { space: "tile", x: tx, y: ty } : undefined;
  }
  /** @internal Unique currently used IDs; no writable Grid/cache is exposed. */
  tileIds(): IterableIterator<number | Name> {
    return this.counts.keys();
  }
  /** @internal Presentation subscriptions are removed with their presentation or Actor. */
  onTilesChanged(notify: (index: number | null) => void): () => void {
    this.alive();
    this.listeners.add(notify);
    const unregister = this.onDispose(() => this.listeners.delete(notify));
    return () => {
      unregister();
      this.listeners.delete(notify);
    };
  }
}

/** @internal One passive placement Component, not one Component per tile. */
export class TilemapLayer extends Component {
  static readonly type: ComponentType<TilemapLayer> =
    defineComponent<TilemapLayer>("TilemapLayer");
  readonly type = TilemapLayer.type;
  constructor(readonly map: Tilemap<string>) {
    super();
  }
}
