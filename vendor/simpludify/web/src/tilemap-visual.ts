import {
  cleanupAll,
  type Scene,
  type Tilemap,
  type ViewTransform,
} from "@simpludify/core";
import { Container, Sprite, type Texture } from "pixi.js";
import type { ImageLease } from "./shared-images";

/** Renderer-owned sparse visible set; sheet pixels are owned by SharedImages. */
export class TilemapVisual {
  readonly display = new Container();
  readonly sprites = new Map<number, Sprite>();
  order = 0;
  depth = NaN;
  controller: AbortController | undefined = new AbortController();
  error: unknown;
  disposed = false;
  readonly stats = {
    visitedCells: 0,
    updatedTiles: 0,
    createdSprites: 0,
    destroyedSprites: 0,
    validatedFrames: 0,
  };
  private lease: ImageLease | undefined;
  private readonly textures = new Map<number | string, Texture>();
  private readonly dirty = new Set<number>();
  private revision = -1;
  private range = { left: -1, top: -1, right: -1, bottom: -1 };
  private invalid = true;
  private readonly off: () => void;
  private readonly offDispose: () => void;
  constructor(
    readonly map: Tilemap<string>,
    scene: Scene,
    acquire: (url: string, signal: AbortSignal) => Promise<ImageLease>,
    private readonly changed: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly released: () => void,
  ) {
    this.off = map.onTilesChanged((index) => {
      if (index === null) {
        this.invalid = true;
        this.dirty.clear();
      } else {
        const x = index % map.width,
          y = Math.floor(index / map.width),
          r = this.range;
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom)
          this.dirty.add(index);
      }
    });
    this.offDispose = map.onDispose(() => this.dispose());
    const controller = this.controller;
    if (!controller) throw Error("Missing tilemap request controller");
    void acquire(map.sheet.url, controller.signal)
      .then((lease) => {
        if (this.disposed || map.disposed || map.scene !== scene) {
          lease.release();
          return;
        }
        this.lease = lease;
        this.sync();
      })
      .catch((error: unknown) => {
        if (!this.disposed) this.fail(error);
      })
      .finally(() => {
        this.controller = undefined;
        changed();
      });
  }
  private fail(error: unknown): void {
    this.error = error;
    try {
      this.onError(error);
    } catch {
      /* Diagnostics must not invalidate cleanup. */
    }
  }
  sync(): void {
    if (!this.lease || this.disposed || this.revision === this.map.revision)
      return;
    this.revision = this.map.revision;
    this.error = undefined;
    try {
      for (const id of this.map.tileIds()) {
        if (!this.textures.has(id)) {
          this.stats.validatedFrames++;
          this.textures.set(
            id,
            this.lease.textureFor(this.map.sheet.get(id).frame),
          );
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }
  private remove(index: number): void {
    const sprite = this.sprites.get(index);
    if (sprite) {
      this.sprites.delete(index);
      sprite.destroy();
      this.stats.destroyedSprites++;
    }
  }
  private cell(x: number, y: number): void {
    this.stats.visitedCells++;
    const index = y * this.map.width + x,
      id = this.map.get(x, y);
    if (id === null) {
      this.remove(index);
      return;
    }
    const texture = this.textures.get(id);
    if (!texture) return;
    let sprite = this.sprites.get(index);
    if (!sprite) {
      sprite = new Sprite(texture);
      sprite.position.set(x * this.map.tileWidth, y * this.map.tileHeight);
      this.sprites.set(index, sprite);
      this.display.addChild(sprite);
      this.stats.createdSprites++;
    }
    sprite.texture = texture;
    sprite.width = this.map.tileWidth;
    sprite.height = this.map.tileHeight;
    this.stats.updatedTiles++;
  }
  render(view: ViewTransform): void {
    if (this.disposed) return;
    this.sync();
    const m = this.map;
    this.display.position.set(m.x, m.y);
    this.display.visible = m.visible && m.enabled;
    if (!this.display.visible) {
      this.invalid = true;
      return;
    }
    if (!this.lease || this.error) return;
    const c = view.clip;
    const left = Math.max(
      0,
      Math.min(
        m.width,
        Math.floor(((c.x - view.x) / view.scale - m.x) / m.tileWidth),
      ),
    );
    const top = Math.max(
      0,
      Math.min(
        m.height,
        Math.floor(((c.y - view.y) / view.scale - m.y) / m.tileHeight),
      ),
    );
    const right = Math.max(
      left,
      Math.min(
        m.width,
        Math.ceil(((c.x + c.width - view.x) / view.scale - m.x) / m.tileWidth),
      ),
    );
    const bottom = Math.max(
      top,
      Math.min(
        m.height,
        Math.ceil(
          ((c.y + c.height - view.y) / view.scale - m.y) / m.tileHeight,
        ),
      ),
    );
    const old = this.range;
    if (
      this.invalid ||
      left !== old.left ||
      top !== old.top ||
      right !== old.right ||
      bottom !== old.bottom
    ) {
      this.range = { left, top, right, bottom };
      this.invalid = false;
      for (const index of this.sprites.keys()) {
        const x = index % m.width,
          y = Math.floor(index / m.width);
        if (x < left || x >= right || y < top || y >= bottom)
          this.remove(index);
      }
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) this.cell(x, y);
    } else
      for (const index of this.dirty)
        this.cell(index % m.width, Math.floor(index / m.width));
    this.dirty.clear();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.controller = undefined;

    this.stats.destroyedSprites += this.sprites.size;
    this.sprites.clear();
    this.textures.clear();
    this.dirty.clear();
    const lease = this.lease;
    this.lease = undefined;
    cleanupAll(
      [
        this.off,
        this.offDispose,
        () => this.display.removeFromParent(),
        () => this.display.destroy({ children: true }),
        () => lease?.release(),
        this.released,
        this.changed,
      ],
      "Tilemap presentation cleanup failed",
    );
  }
}
