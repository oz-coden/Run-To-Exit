import {
  type Actor,
  cleanupAll,
  EngineError,
  imageSize,
  type PreparedScene,
  Renderable,
  type RendererPort,
  type Scene,
  Shape,
  TilemapLayer,
  Transform,
  type VisualSource,
} from "@simpludify/core";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { CanvasUI } from "./canvas-ui";

import { type CanvasPresentation, CanvasVisual } from "./canvas-visual";
import {
  pruneUITextKeys,
  releaseUIGraphics,
  releaseUIText,
} from "./pixi-ui-cleanup";
import type { PointerRouting } from "./pointer-routing";
import {
  type ImageLease,
  type ImageResource,
  SharedImages,
} from "./shared-images";
import { TilemapVisual } from "./tilemap-visual";

interface Visual {
  actor: Actor;
  component: Renderable;
  transform: Transform;
  revision: number;
  generation: number;
  requestUrl?: string;
  controller?: AbortController;
  order: number;
  depth: number;
  scaleX: number;
  scaleY: number;
  display?: Sprite | Graphics;
  displayedSource?: VisualSource;
  geometryShape?: Shape;
  geometryWidth: number;
  geometryHeight: number;
  geometryColor: number;
  image?: ImageLease;
  requestedSource?: VisualSource;
  error?: unknown;
  disposed: boolean;
  dispose(): void;
}
export class PixiRenderer implements RendererPort {
  private readonly app = new Application();
  private readonly pendingUITextKeys = new Set<string>();
  private readonly canvasPresentations = new Set<CanvasVisual>();
  get canvasDiagnostics() {
    let nodes = 0,
      buttons = 0,
      syncs = 0,
      textMetrics = 0;
    for (const p of this.canvasPresentations) {
      const d = p.diagnostics;
      nodes += d.nodes;
      buttons += d.buttons;
      syncs += d.syncs;
      textMetrics += d.textMetrics;
    }
    return {
      presentations: this.canvasPresentations.size,
      nodes,
      buttons,
      syncs,
      textMetrics,
    };
  }
  prepareCanvasUI(ui: CanvasUI, routing: PointerRouting): CanvasPresentation {
    if (!this.ready || this.dead)
      throw new EngineError("RENDERER_NOT_READY", "Renderer is not available");
    const visual = new CanvasVisual(ui, this.host, routing, {
      graphics: (graphics, context) =>
        releaseUIGraphics(this.app.renderer, graphics, context),
      text: (text, key) => releaseUIText(this.app.renderer, text, key),
      changedText: (key) => this.pendingUITextKeys.add(key),
    });
    this.canvasPresentations.add(visual);
    let disposed = false;
    const off = ui.onDispose(() => {
      this.canvasPresentations.delete(visual);
    });
    return {
      update: (width, height) => {
        if (disposed || ui.disposed) return;
        if (!visual.display.parent) this.app.stage.addChild(visual.display);
        visual.update(width, height);
      },
      focus: (node) => visual.focus(node),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        off();
        this.canvasPresentations.delete(visual);
        visual.dispose();
      },
    };
  }
  private readonly scenes = new Set<PreparedScene>();
  private readonly images = new SharedImages((url, signal) =>
    this.image(url, signal),
  );
  private readonly tilemaps = new Set<TilemapVisual>();
  get tilemapDiagnostics() {
    let sprites = 0,
      visibleTiles = 0,
      visitedCells = 0,
      updatedTiles = 0,
      createdSprites = 0,
      destroyedSprites = 0,
      validatedFrames = 0;
    for (const t of this.tilemaps) {
      sprites += t.sprites.size;
      if (t.display.visible) visibleTiles += t.sprites.size;
      visitedCells += t.stats.visitedCells;
      updatedTiles += t.stats.updatedTiles;
      createdSprites += t.stats.createdSprites;
      destroyedSprites += t.stats.destroyedSprites;
      validatedFrames += t.stats.validatedFrames;
    }
    return {
      maps: this.tilemaps.size,
      sprites,
      visibleTiles,
      visitedCells,
      updatedTiles,
      createdSprites,
      destroyedSprites,
      validatedFrames,
    };
  }
  private ready = false;
  private dead = false;
  private visualCount = 0;
  private textureCount = 0;
  get diagnostics() {
    return {
      presentations: this.scenes.size,
      visuals: this.visualCount,
      textures: this.textureCount,
      ...this.images.diagnostics,
    };
  }
  constructor(
    private readonly host: HTMLElement,
    private readonly background = "#101922",
    private readonly onError: (error: unknown) => void = () => {},
  ) {}
  async init(): Promise<void> {
    await this.app.init({
      width: 800,
      height: 450,
      background: this.background,
      antialias: true,
      autoStart: false,
      sharedTicker: false,
      preference: "webgl",
      resolution: 1,
      autoDensity: true,
    });
    this.ready = true;
    if (this.dead) {
      this.destroyApp();
      throw new EngineError(
        "GAME_DISPOSED",
        "Renderer disposed during initialization",
      );
    }
    this.app.stage.sortableChildren = true;
    this.app.canvas.setAttribute("aria-label", "Game world");
    this.host.prepend(this.app.canvas);
  }
  private async image(
    url: string,
    signal: AbortSignal,
  ): Promise<ImageResource> {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const clear = () => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        clear();
        image.src = "";
        reject(
          new EngineError("GAME_DISPOSED", "Image loading cancelled", {
            path: url,
          }),
        );
      };
      image.onload = () => {
        clear();
        resolve();
      };
      image.onerror = () => {
        clear();
        reject(
          new EngineError("ASSET_LOAD_FAILED", "Could not load sprite", {
            path: url,
          }),
        );
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      image.crossOrigin = "anonymous";
      image.src = url;
    });
    if (signal.aborted)
      throw new EngineError("GAME_DISPOSED", "Image loading cancelled", {
        path: url,
      });
    const texture = Texture.from(image, true);
    if (!(texture.width > 0 && texture.height > 0)) {
      texture.destroy(true);
      throw new EngineError(
        "ASSET_LOAD_FAILED",
        "Image has no drawable dimensions",
        { path: url },
      );
    }
    this.textureCount++;
    let released = false;
    return {
      texture,
      release: () => {
        if (released) return;
        released = true;
        this.textureCount--;
        texture.destroy(true);
      },
    };
  }

  private acquireImage(url: string, signal: AbortSignal): Promise<ImageLease> {
    // Image.src resolves against document.baseURI too. Retain query, fragment and
    // credentials; anonymous CORS is fixed for every request in this renderer.
    try {
      return this.images.acquire(new URL(url, document.baseURI).href, signal);
    } catch {
      return Promise.reject(
        new EngineError("ASSET_LOAD_FAILED", "Invalid image URL", {
          path: url,
        }),
      );
    }
  }

  async prepare(scene: Scene): Promise<PreparedScene> {
    if (!this.ready || this.dead)
      throw new EngineError("RENDERER_NOT_READY", "Renderer is not available");
    const root = new Container(),
      world = new Container(),
      mask = new Graphics();
    world.sortableChildren = true;
    root.addChild(world, mask);
    root.mask = mask;
    const visuals = new Map<Actor, Visual>();
    const tilemaps = new Map<Actor, TilemapVisual>();
    const drawOrder: {
      display: Sprite | Graphics | Container;
      order: number;
      zIndex: number;
    }[] = [];
    let depthDirty = true;
    let revision = -1,
      disposed = false,
      clipX = NaN,
      clipY = NaN,
      clipWidth = NaN,
      clipHeight = NaN,
      removeSceneCleanup: (() => void) | undefined;
    const valid = (entry: Visual) =>
      !disposed &&
      !scene.disposed &&
      !entry.actor.disposed &&
      entry.actor.scene === scene &&
      entry.actor.get(Renderable.type) === entry.component &&
      !entry.component.disposed;
    // Waiters follow the current requests of this presentation. No polling timer,
    // replay hook or Core subscription is needed when no readiness call is pending.
    let wake: Promise<void> | undefined;
    let wakeResolve: (() => void) | undefined;
    const changed = () => {
      const resolve = wakeResolve;
      wake = undefined;
      wakeResolve = undefined;
      resolve?.();
    };
    const cancel = (entry: Visual) => {
      entry.generation++;
      const controller = entry.controller;
      delete entry.controller;
      if (controller) {
        controller.abort();
      }
    };
    const appearance = (entry: Visual) => {
      const { component, display, displayedSource: source } = entry;
      if (!display || !source) return;
      if (source.kind === "image" && display instanceof Sprite && entry.image) {
        const texture = display.texture;
        const size = imageSize(
          texture.width,
          texture.height,
          component.width,
          component.height,
          source.fit,
        );
        entry.scaleX = size.width / texture.width;
        entry.scaleY = size.height / texture.height;
        display.tint = component.color;
      } else if (source.kind === "shape" && display instanceof Graphics) {
        const width = component.width,
          height = component.height;
        if (
          entry.geometryShape === source.shape &&
          entry.geometryWidth === width &&
          entry.geometryHeight === height &&
          entry.geometryColor === component.color
        )
          return;
        entry.geometryShape = source.shape;
        entry.geometryWidth = width;
        entry.geometryHeight = height;
        entry.geometryColor = component.color;
        display.clear();
        if (source.shape === Shape.Circle)
          display
            .circle(0, 0, Math.min(width, height) / 2)
            .fill(component.color);
        else if (source.shape === Shape.Triangle)
          display
            .poly(
              [0, -height / 2, width / 2, height / 2, -width / 2, height / 2],
              true,
            )
            .fill(component.color);
        else
          display
            .roundRect(
              -width / 2,
              -height / 2,
              width,
              height,
              source.shape === Shape.Character
                ? Math.min(width, height) / 4
                : 2,
            )
            .fill(component.color);
        if (source.shape === Shape.Character)
          display
            .circle(-width / 7, -height / 10, Math.min(width, height) / 18)
            .fill(0x102c28)
            .circle(width / 7, -height / 10, Math.min(width, height) / 18)
            .fill(0x102c28);
        entry.scaleX = entry.scaleY = 1;
      }
    };
    const replace = (
      entry: Visual,
      display: Sprite | Graphics,
      source: VisualSource,
    ) => {
      if (entry.display !== display) {
        entry.display?.destroy();
        entry.display = display;
        delete entry.geometryShape;
        world.addChild(display);
        depthDirty = true;
      }
      entry.displayedSource = source;
    };
    const fail = (entry: Visual, error: unknown) => {
      entry.error = error;
      try {
        this.onError(error);
      } catch {
        /* Keep diagnostics separate from cleanup. */
      }
    };
    const commitImage = (
      entry: Visual,
      resource: ImageLease,
      source: VisualSource,
    ) => {
      if (source.kind !== "image") return;
      // Resolve and validate before mutating the retained Sprite or releasing its lease.
      const texture = resource.textureFor(source.frame);
      const previous = entry.image;
      const sprite =
        entry.display instanceof Sprite ? entry.display : new Sprite(texture);
      sprite.texture = texture;
      sprite.anchor.set(0.5);
      entry.image = resource;
      replace(entry, sprite, source);
      appearance(entry);
      if (previous !== resource) previous?.release();
    };
    const update = (entry: Visual) => {
      const component = entry.component;
      if (entry.revision === component.revision) return;
      entry.revision = component.revision;
      const source = component.source;
      const sourceChanged = entry.requestedSource !== source;
      entry.requestedSource = source;
      if (source.kind === "shape") {
        cancel(entry);
        delete entry.requestUrl;
        delete entry.error;
        const previous = entry.image;
        delete entry.image;
        replace(
          entry,
          entry.display instanceof Graphics ? entry.display : new Graphics(),
          source,
        );
        previous?.release();
        changed();
      } else if (
        entry.requestUrl !== source.url ||
        (sourceChanged &&
          !entry.controller &&
          (!entry.image ||
            entry.displayedSource?.kind !== "image" ||
            entry.displayedSource.url !== source.url))
      ) {
        cancel(entry);
        entry.requestUrl = source.url;
        delete entry.error;
        // Returning to the still-displayed image needs no new load.
        if (
          entry.image &&
          entry.displayedSource?.kind === "image" &&
          entry.displayedSource.url === source.url
        ) {
          try {
            commitImage(entry, entry.image, source);
          } catch (error) {
            fail(entry, error);
          }
        } else {
          const controller = new AbortController(),
            generation = entry.generation;
          entry.controller = controller;
          const current = () =>
            !entry.disposed &&
            valid(entry) &&
            entry.generation === generation &&
            component.source.kind === "image" &&
            component.source.url === source.url;
          void this.acquireImage(source.url, controller.signal)
            .then((resource) => {
              if (!current()) {
                resource.release();
                return;
              }
              try {
                commitImage(entry, resource, component.source);
              } catch (error) {
                resource.release();
                throw error;
              }
            })
            .catch((error) => {
              if (current()) {
                fail(entry, error);
              }
            })
            .finally(() => {
              if (entry.controller === controller) delete entry.controller;
              changed();
            });
        }
        changed();
      } else if (
        entry.image &&
        entry.displayedSource?.kind === "image" &&
        entry.displayedSource.url === source.url
      ) {
        if (sourceChanged) delete entry.error;
        try {
          commitImage(entry, entry.image, source);
        } catch (error) {
          fail(entry, error);
        }
      }
      // Layout/color changes also apply to the retained display while a new image loads.
      appearance(entry);
    };
    const create = (actor: Actor, component: Renderable): Visual => {
      this.visualCount++;
      let removeActorCleanup = () => {},
        removeComponentCleanup = () => {};
      const entry: Visual = {
        revision: -1,
        generation: 0,
        disposed: false,
        geometryWidth: NaN,
        geometryHeight: NaN,
        geometryColor: NaN,
        order: 0,
        depth: NaN,
        scaleX: 1,
        scaleY: 1,
        actor,
        component,
        transform: actor.require(Transform.type),
        dispose: () => {
          if (entry.disposed) return;
          entry.disposed = true;
          this.visualCount--;
          depthDirty = true;
          drawOrder.length = 0;
          cancel(entry);
          changed();
          const display = entry.display,
            image = entry.image;
          delete entry.display;
          delete entry.image;
          cleanupAll(
            [
              removeActorCleanup,
              removeComponentCleanup,
              () => display?.destroy(),
              () => image?.release(),
            ],
            "Visual cleanup failed",
          );
        },
      };
      removeActorCleanup = actor.onDispose(entry.dispose);
      removeComponentCleanup = component.onDispose(entry.dispose);
      update(entry);
      return entry;
    };
    const reconcile = () => {
      if (disposed || scene.disposed) return;
      if (revision === scene.revision) return;
      revision = scene.revision;
      depthDirty = true;
      for (const [actor, entry] of visuals)
        if (!valid(entry)) {
          entry.dispose();
          visuals.delete(actor);
        }
      for (const [actor, entry] of tilemaps)
        if (
          actor.disposed ||
          actor.scene !== scene ||
          !actor.get(TilemapLayer.type) ||
          entry.disposed
        ) {
          entry.dispose();
          this.tilemaps.delete(entry);
          tilemaps.delete(actor);
        }
      let order = 0;
      for (const actor of scene.actors) {
        const layer = actor.get(TilemapLayer.type);
        if (layer) {
          let tile = tilemaps.get(actor);
          if (!tile) {
            tile = new TilemapVisual(
              layer.map,
              scene,
              (url, signal) => this.acquireImage(url, signal),
              changed,
              this.onError,
              () => {
                if (tile) this.tilemaps.delete(tile);
                depthDirty = true;
              },
            );
            world.addChild(tile.display);
            tilemaps.set(actor, tile);
            this.tilemaps.add(tile);
          }
          tile.order = order;
        }
        const component = actor.get(Renderable.type);
        if (component) {
          let entry = visuals.get(actor);
          if (!entry) {
            entry = create(actor, component);
            visuals.set(actor, entry);
          }
          entry.order = order;
        }
        order++;
      }
    };
    const sync = () => {
      reconcile();
      for (const entry of visuals.values()) update(entry);
      for (const entry of tilemaps.values()) entry.sync();
    };
    const prepared: PreparedScene = {
      ready: async () => {
        for (;;) {
          if (disposed || this.dead || scene.disposed)
            throw new EngineError(
              "GAME_DISPOSED",
              "Scene presentation has been disposed",
            );
          sync();
          let pending = false;
          for (const entry of visuals.values()) {
            if (entry.error) throw entry.error;
            if (entry.controller) pending = true;
          }
          for (const entry of tilemaps.values()) {
            if (entry.error) throw entry.error;
            if (entry.controller) pending = true;
          }
          if (!pending) return;
          wake ??= new Promise<void>((resolve) => {
            wakeResolve = resolve;
          });
          await wake;
        }
      },
      render: (view) => {
        if (disposed || this.dead || scene.disposed) return;
        reconcile();
        if (!root.parent) this.app.stage.addChild(root);
        const c = view.clip;
        if (
          c.x !== clipX ||
          c.y !== clipY ||
          c.width !== clipWidth ||
          c.height !== clipHeight
        ) {
          clipX = c.x;
          clipY = c.y;
          clipWidth = c.width;
          clipHeight = c.height;
          mask.clear().rect(c.x, c.y, c.width, c.height).fill(0xffffff);
        }
        world.scale.set(view.scale);
        world.position.set(view.x, view.y);
        for (const entry of visuals.values()) {
          update(entry);
          if (entry.display) {
            const t = entry.transform;
            entry.display.visible =
              entry.actor.enabled &&
              entry.component.enabled &&
              entry.component.visible;
            entry.display.alpha = entry.component.opacity;
            if (entry.depth !== entry.component.zIndex) {
              entry.depth = entry.component.zIndex;
              depthDirty = true;
            }
            entry.display.position.set(t.x, t.y);
            entry.display.rotation = t.rotation;
            entry.display.scale.set(
              entry.scaleX * t.scaleX,
              entry.scaleY * t.scaleY,
            );
          }
        }
        for (const entry of tilemaps.values()) {
          entry.render(view);
          if (entry.depth !== entry.map.zIndex) {
            entry.depth = entry.map.zIndex;
            depthDirty = true;
          }
        }
        if (depthDirty) {
          drawOrder.length = 0;
          for (const entry of visuals.values())
            if (entry.display)
              drawOrder.push({
                display: entry.display,
                order: entry.order,
                zIndex: entry.component.zIndex,
              });
          for (const entry of tilemaps.values())
            drawOrder.push({
              display: entry.display,
              order: entry.order,
              zIndex: entry.map.zIndex,
            });
          drawOrder.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
          for (let i = 0; i < drawOrder.length; i++) {
            const entry = drawOrder[i];
            if (entry?.display) entry.display.zIndex = i;
          }
          depthDirty = false;
        }
        this.app.render();
        if (this.pendingUITextKeys.size)
          pruneUITextKeys(this.app.renderer, this.pendingUITextKeys);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        changed();
        this.scenes.delete(prepared);
        const entries = [...visuals.values()];
        visuals.clear();
        drawOrder.length = 0;
        cleanupAll(
          [
            () => removeSceneCleanup?.(),
            ...entries.map((entry) => entry.dispose),
            () => {
              for (const entry of tilemaps.values()) {
                entry.dispose();
                this.tilemaps.delete(entry);
              }
              tilemaps.clear();
            },
            () => root.destroy({ children: true, context: true }),
          ],
          "Presentation cleanup failed",
        );
      },
    };
    removeSceneCleanup = scene.onDispose(prepared.dispose);
    this.scenes.add(prepared);
    try {
      await prepared.ready?.();
      return prepared;
    } catch (error) {
      prepared.dispose();
      throw error;
    }
  }
  resize(width: number, height: number, devicePixelRatio: number): void {
    if (!this.ready || this.dead) return;
    if (this.app.renderer.resolution !== devicePixelRatio)
      for (const visual of this.canvasPresentations)
        visual.beforeResolutionChange();
    this.app.renderer.resolution = devicePixelRatio;
    this.app.renderer.resize(width, height);
  }
  private destroyApp(): void {
    if (this.ready) {
      this.ready = false;
      this.app.destroy({ removeView: true }, { children: true, context: true });
    }
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const scenes = [...this.scenes];
    this.scenes.clear();
    cleanupAll(
      [
        ...scenes.map((scene) => scene.dispose),
        ...[...this.canvasPresentations].map((p) => () => {
          this.canvasPresentations.delete(p);
          p.dispose();
        }),
        () => this.pendingUITextKeys.clear(),
        () => this.images.dispose(),
        () => this.destroyApp(),
      ],
      "Renderer cleanup failed",
    );
  }
}
