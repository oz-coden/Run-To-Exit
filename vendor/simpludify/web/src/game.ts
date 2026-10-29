import {
  type ActionBindings,
  ActionController,
  type ActionSet,
  type Actor,
  Aspect,
  Camera,
  createViewTransform,
  Engine,
  EngineError,
  type FixedStepOptions,
  FixedStepRunner,
  type FrameDriver,
  type JsonValue,
  type LogicalResolution,
  type PreparedScene,
  positive,
  type RendererPort,
  type ReplayControllers,
  ReplayPlayer,
  Scene,
  SceneState,
  type ScreenPoint,
  screenPoint,
  screenToWorld,
  type Viewport,
  type ViewTransform,
  type WorldPoint,
  worldToScreen,
} from "@simpludify/core";
import type { CanvasNode } from "./canvas-node";
import { CanvasUI, type CanvasUIOptions } from "./canvas-ui";
import type { CanvasPresentation } from "./canvas-visual";
import { BrowserInput } from "./input";
import { BrowserPointer } from "./pointer";
import { type PointerRouting, ScenePointer } from "./pointer-routing";
import { PixiRenderer } from "./renderer";
import {
  type MountedUI,
  mountUI,
  Theme,
  Themes,
  type ThemeTokens,
  type UINode,
} from "./ui";

export interface SceneContext {
  readonly scene: Scene;
  readonly signal: AbortSignal;
  add<T extends Actor>(actor: T): T;
  ui(...nodes: UINode[]): void;
  canvasUI(root: CanvasNode, options?: CanvasUIOptions): CanvasUI;
  readonly pointer: ScenePointer;
  actions<A extends ActionSet>(
    actions: A,
    bindings?: ActionBindings<A>,
  ): ActionController<A>;
  onUpdate(callback: (seconds: number) => void): () => void;
  onActivate(callback: () => void): () => void;
  onDeactivate(callback: () => void): () => void;
  onDispose(callback: () => void): () => void;
}
export type SceneSetup = (context: SceneContext) => void | Promise<void>;
export interface GameOptions {
  parent?: HTMLElement;
  resolution?: LogicalResolution;
  aspect?: Aspect;
  camera?: Camera;
  viewport?: Viewport;
  pixelRatio?: number;
  theme?: Theme;
  tokens?: Partial<ThemeTokens>;
  seed?: number;
  maxDelta?: number;
  fixedStep?: FixedStepOptions;
  renderer?: (host: HTMLElement) => RendererPort;
  frames?: FrameDriver;
  onError?: (error: unknown) => void;
}
export class Game<SceneId extends string = string> {
  readonly engine: Engine;
  readonly element: HTMLDivElement;
  readonly camera: Camera;
  private readonly renderer: RendererPort;
  private readonly keyboard: BrowserInput;
  private readonly pointers: BrowserPointer;
  private readonly pointerChannels = new WeakMap<Scene, ScenePointer>();
  private canvas: CanvasUI | undefined;
  private canvasPresentation: CanvasPresentation | undefined;
  private defaultCanvas: CanvasUI | undefined;
  get pointer(): ScenePointer {
    this.assertAlive();
    return this.channelFor(this.engine.scene);
  }
  get pointerDiagnostics() {
    return this.pointers.routing.diagnostics;
  }
  private channelFor(scene: Scene): ScenePointer {
    let channel = this.pointerChannels.get(scene);
    if (!channel) {
      channel = new ScenePointer(scene);
      this.pointerChannels.set(scene, channel);
    }
    return channel;
  }
  private readonly observer: ResizeObserver;
  private readonly frames: FrameDriver;
  private readonly options: GameOptions;
  private readonly resolution: LogicalResolution;
  private readonly aspect: Aspect;
  private readonly maxDelta: number;
  private readonly fixed: FixedStepRunner | undefined;
  private playback: ReplayPlayer | undefined;
  private playbackScene: Scene | undefined;
  private removeReplayOwner: (() => void) | undefined;
  private requestedViewport: Viewport | undefined;
  private projection: ViewTransform;
  private projectionDirty = true;
  private cameraX = NaN;
  private cameraY = NaN;
  private cameraZoom = NaN;
  private width = 800;
  private height = 450;
  private ratio = 1;
  private readonly scenes = new Map<SceneId, SceneSetup>();
  private readonly pendingScenes = new Map<SceneId, Promise<void>>();
  private readonly defaultUI: UINode[] = [];
  private ui: MountedUI | undefined;
  private prepared: PreparedScene | undefined;
  private startPromise: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private frame: number | undefined;
  private previousTime: number | undefined;
  private dead = false;
  private ready = false;
  private rendererReady = false;
  private rendererSized = false;
  private staging: Scene | undefined;
  private readonly shutdown = new AbortController();
  private readonly errorBox: HTMLParagraphElement;
  constructor(options: GameOptions = {}) {
    this.options = options;
    this.engine = new Engine(
      options.seed === undefined ? {} : { seed: options.seed },
    );
    this.fixed = options.fixedStep
      ? new FixedStepRunner(this.engine, options.fixedStep)
      : undefined;
    this.camera = options.camera ?? new Camera();
    this.maxDelta = positive(options.maxDelta ?? 0.05, "maxDelta");
    this.resolution = {
      width: positive(options.resolution?.width ?? 800, "resolution.width"),
      height: positive(options.resolution?.height ?? 450, "resolution.height"),
    };
    this.aspect = options.aspect ?? Aspect.Fit;
    this.requestedViewport = options.viewport
      ? { ...options.viewport }
      : undefined;
    this.projection = createViewTransform({
      viewport: this.requestedViewport ?? {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
      },
      resolution: this.resolution,
      aspect: this.aspect,
      camera: this.camera,
    });
    if (options.pixelRatio !== undefined)
      positive(options.pixelRatio, "pixelRatio");
    const theme = Themes[options.theme ?? Theme.Dark];
    if (!theme) throw new EngineError("INVALID_THEME", "Unknown theme");
    const tokens = { ...theme, ...options.tokens };
    this.element = document.createElement("div");
    this.element.className = "simpludify";
    this.element.tabIndex = 0;
    this.element.setAttribute(
      "aria-label",
      "Game. Focus this area to use movement keys.",
    );
    for (const [name, value] of Object.entries(tokens))
      this.element.style.setProperty(`--s-${name}`, value);
    this.errorBox = document.createElement("p");
    this.errorBox.className = "s-error";
    this.errorBox.setAttribute("role", "alert");
    this.errorBox.hidden = true;
    this.element.append(this.errorBox);
    (options.parent ?? document.body).append(this.element);
    try {
      this.renderer =
        options.renderer?.(this.element) ??
        new PixiRenderer(this.element, tokens.background, (error) =>
          this.report(error),
        );
    } catch (error) {
      this.element.remove();
      this.engine.dispose();
      throw error;
    }
    this.frames = options.frames ?? {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
    this.keyboard = new BrowserInput(this.element, this.engine.input);
    this.pointers = new BrowserPointer(
      this.element,
      (event) => {
        const rect = this.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
          throw new EngineError(
            "VIEWPORT_UNAVAILABLE",
            "Game has no visible bounds",
          );
        const screen = screenPoint(
          ((event.clientX - rect.left) * this.width) / rect.width,
          ((event.clientY - rect.top) * this.height) / rect.height,
        );
        return { screen, world: this.screenToWorld(screen), view: this.view };
      },
      this.report,
      () => this.canvasPresentation?.update(this.width, this.height),
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        this.previousTime = undefined;
        this.fixed?.reset();
        this.engine.input.clear();
      },
      { signal: this.shutdown.signal },
    );
    this.observer = new ResizeObserver(() => {
      try {
        this.resize();
      } catch (error) {
        this.report(error);
        this.dispose();
      }
    });
    this.observer.observe(this.element);
  }
  private assertAlive(): void {
    if (this.dead)
      throw new EngineError("GAME_DISPOSED", "Game has been disposed");
  }
  get paused(): boolean {
    return this.engine.paused;
  }
  pause(): void {
    this.assertAlive();
    this.pointers.release();
    this.engine.pause();
    this.previousTime = undefined;
    this.fixed?.reset();
  }
  resume(): void {
    this.assertAlive();
    this.pointers.release();
    this.engine.resume();
    this.previousTime = undefined;
    this.fixed?.reset();
  }
  /** Configure inside the initial Scene factory after game setup, before the first Engine step. */
  playReplay(
    data: unknown,
    options: {
      scene: Scene;
      controllers: ReplayControllers;
      expectedMetadata?: Readonly<Record<string, JsonValue>>;
    },
  ): ReplayPlayer {
    this.assertAlive();
    if (options.scene !== this.engine.scene && options.scene !== this.staging)
      throw new EngineError(
        "REPLAY_STATE",
        "Replay Scene must be current or staged by this Game",
      );
    if (this.playback)
      throw new EngineError("REPLAY_STATE", "Game already has a Replay player");
    const player = new ReplayPlayer(this.engine, data, options);
    this.playback = player;
    this.playbackScene = options.scene;
    try {
      this.removeReplayOwner = options.scene.onDispose(() => this.stopReplay());
    } catch (error) {
      this.stopReplay();
      throw error;
    }
    return player;
  }
  stopReplay(): void {
    const player = this.playback,
      off = this.removeReplayOwner;
    this.playback = undefined;
    this.playbackScene = undefined;
    this.removeReplayOwner = undefined;
    off?.();
    player?.dispose();
    this.previousTime = undefined;
    this.fixed?.reset();
  }
  add<T extends Actor>(actor: T): T {
    this.assertAlive();
    return this.engine.scene.add(actor);
  }
  /** Scene-owned Actions for the current Scene. In a staged factory use context.actions. */
  actions<A extends ActionSet>(
    actions: A,
    bindings?: ActionBindings<A>,
  ): ActionController<A> {
    this.assertAlive();
    return new ActionController(actions, {
      scene: this.engine.scene,
      input: this.engine.input,
      ...(bindings === undefined ? {} : { bindings }),
    });
  }
  remove(actor: Actor | string): boolean {
    this.assertAlive();
    return this.engine.scene.remove(actor);
  }
  canvasUI(root: CanvasNode, options: CanvasUIOptions = {}): CanvasUI {
    this.assertAlive();
    if (this.startPromise || this.defaultCanvas)
      throw new EngineError(
        "UI_ALREADY_STARTED",
        "Define one default Canvas UI before run",
      );
    this.defaultCanvas = new CanvasUI(this.engine.scene, root, options);
    return this.defaultCanvas;
  }
  uiOverlay(...nodes: UINode[]): void {
    this.assertAlive();
    if (this.startPromise)
      throw new EngineError(
        "UI_ALREADY_STARTED",
        "Define default UI before run",
      );
    this.defaultUI.push(...nodes);
  }
  scene(id: SceneId, setup: SceneSetup): this {
    this.assertAlive();
    if (this.scenes.has(id))
      throw new EngineError(
        "DUPLICATE_SCENE",
        "Scene id is already registered",
        { sceneId: id },
      );
    this.scenes.set(id, setup);
    return this;
  }
  private wait<T>(promise: Promise<T>): Promise<T> {
    if (this.dead)
      return Promise.reject(
        new EngineError("GAME_DISPOSED", "Game has been disposed"),
      );
    const signal = this.shutdown.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new EngineError("GAME_DISPOSED", "Game has been disposed"));
      };
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
  run(initialScene?: SceneId): Promise<void> {
    if (this.dead)
      return Promise.reject(
        new EngineError("GAME_DISPOSED", "Game has been disposed"),
      );
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        await this.wait(this.renderer.init());
        this.assertAlive();
        this.rendererReady = true;
        if (initialScene !== undefined) await this.navigate(initialScene);
        else
          await this.present(
            this.engine.scene,
            this.defaultUI,
            this.defaultCanvas,
          );
        this.assertAlive();
        this.defaultCanvas = undefined;
        this.defaultUI.length = 0;
        this.ready = true;
        this.resize();
        this.render();
        this.assertAlive();
        this.frame = this.frames.request(this.tick);
      } catch (error) {
        this.dispose();
        throw error;
      }
    })();
    return this.startPromise;
  }
  goTo(id: SceneId): Promise<void> {
    if (this.dead)
      return Promise.reject(
        new EngineError("GAME_DISPOSED", "Game has been disposed"),
      );
    if (!this.ready)
      return Promise.reject(
        new EngineError("GAME_NOT_READY", "Await run before navigating"),
      );
    return this.navigate(id);
  }
  private navigate(id: SceneId): Promise<void> {
    const setup = this.scenes.get(id);
    if (!setup)
      return Promise.reject(
        new EngineError("SCENE_NOT_FOUND", "Unknown scene", { sceneId: id }),
      );
    const existing = this.pendingScenes.get(id);
    if (existing) return existing;
    const task = this.queue
      .then(async () => {
        this.assertAlive();
        const scene = new Scene(id),
          nodes: UINode[] = [],
          controller = new AbortController();
        let canvas: CanvasUI | undefined;
        const pointer = this.channelFor(scene);
        this.staging = scene;
        scene.onDispose(() => controller.abort());
        try {
          await this.wait(
            Promise.resolve(
              setup({
                scene,
                signal: controller.signal,
                add: (actor) => scene.add(actor),
                ui: (...items) => nodes.push(...items),
                pointer,
                canvasUI: (root, options) => {
                  if (canvas)
                    throw new EngineError(
                      "UI_OWNERSHIP",
                      "A Scene has one Canvas UI root",
                    );
                  canvas = new CanvasUI(scene, root, options);
                  return canvas;
                },
                actions: (actions, bindings) =>
                  new ActionController(actions, {
                    scene,
                    input: this.engine.input,
                    ...(bindings === undefined ? {} : { bindings }),
                  }),
                onUpdate: (callback) => scene.onUpdate(callback),
                onActivate: (callback) => scene.onActivate(callback),
                onDeactivate: (callback) => scene.onDeactivate(callback),
                onDispose: (callback) => scene.onDispose(callback),
              }),
            ),
          );
          this.assertAlive();
          await this.present(scene, nodes, canvas);
        } catch (error) {
          try {
            scene.dispose();
          } catch (cleanupError) {
            this.report(cleanupError);
          }
          throw error;
        } finally {
          if (this.staging === scene) this.staging = undefined;
        }
      })
      .finally(() => {
        if (this.pendingScenes.get(id) === task) this.pendingScenes.delete(id);
      });
    this.pendingScenes.set(id, task);
    this.queue = task.catch(() => {});
    return task;
  }
  private async present(
    scene: Scene,
    nodes: readonly UINode[],
    canvas?: CanvasUI,
  ): Promise<void> {
    let prepared: PreparedScene | undefined,
      ui: MountedUI | undefined,
      committed = false;
    let canvasPresentation: CanvasPresentation | undefined;
    try {
      const preparing = this.renderer.prepare(scene);
      void preparing.then(
        (value) => {
          if (this.dead || scene.disposed) {
            try {
              value.dispose();
            } catch (error) {
              this.report(error);
            }
          }
        },
        () => {},
      );
      prepared = await this.wait(preparing);
      this.assertAlive();
      ui = mountUI(nodes, this.report);
      scene.onDispose(ui.dispose);
      if (canvas) {
        canvas.setErrorHandler(this.report);
        const renderer = this.renderer as RendererPort & {
          prepareCanvasUI?: (
            ui: CanvasUI,
            routing: PointerRouting,
          ) => CanvasPresentation;
        };
        if (!renderer.prepareCanvasUI)
          throw new EngineError(
            "RENDERER_CAPABILITY",
            "Renderer does not support Canvas UI",
          );
        canvasPresentation = renderer.prepareCanvasUI(
          canvas,
          this.pointers.routing,
        );
        scene.onDispose(() => canvasPresentation?.dispose());
      }
      scene.markReady();
      this.errorBox.hidden = true;
      try {
        if (this.playback && this.playbackScene !== scene) this.stopReplay();
        this.engine.activate(scene);
      } catch (error) {
        if (this.engine.scene !== scene || scene.state !== SceneState.Active)
          throw error;
        this.report(error);
      }
      this.assertAlive();
      const oldPrepared = this.prepared,
        oldUI = this.ui,
        oldCanvas = this.canvasPresentation;
      this.prepared = prepared;
      this.ui = ui;
      this.canvas = canvas;
      this.canvasPresentation = canvasPresentation;
      this.pointers.routing.setScene(this.channelFor(scene), canvas);
      committed = true;
      this.element.append(ui.element);
      for (const cleanup of [
        () => oldPrepared?.dispose(),
        () => oldUI?.dispose(),
        () => oldCanvas?.dispose(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          this.report(error);
        }
      }
      this.assertAlive();
      this.previousTime = undefined;
      this.fixed?.reset();
      this.updateProjection();
      this.render();
      this.assertAlive();
    } catch (error) {
      if (!committed)
        for (const cleanup of [
          () => prepared?.dispose(),
          () => ui?.dispose(),
          () => canvasPresentation?.dispose(),
        ]) {
          try {
            cleanup();
          } catch (cleanupError) {
            this.report(cleanupError);
          }
        }
      if (committed) this.dispose();
      throw error;
    }
  }
  get viewport(): Viewport {
    this.updateProjection();
    return this.projection.viewport;
  }
  get view(): ViewTransform {
    this.updateProjection();
    return this.projection;
  }
  setViewport(viewport?: Viewport): void {
    this.assertAlive();
    const next = viewport ? { ...viewport } : undefined;
    createViewTransform({
      viewport: next ?? { x: 0, y: 0, width: this.width, height: this.height },
      resolution: this.resolution,
      aspect: this.aspect,
      camera: this.camera,
    });
    this.requestedViewport = next;
    this.projectionDirty = true;
    this.updateProjection();
    if (this.ready) this.render();
  }
  worldToScreen(point: WorldPoint): ScreenPoint {
    return worldToScreen(this.view, point);
  }
  screenToWorld(point: ScreenPoint): WorldPoint {
    return screenToWorld(this.view, point);
  }
  pointerToWorld(pointer: {
    readonly clientX: number;
    readonly clientY: number;
  }): WorldPoint {
    const rect = this.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0)
      throw new EngineError(
        "VIEWPORT_UNAVAILABLE",
        "Game has no visible bounds",
      );
    return this.screenToWorld(
      screenPoint(
        ((pointer.clientX - rect.left) * this.width) / rect.width,
        ((pointer.clientY - rect.top) * this.height) / rect.height,
      ),
    );
  }
  async whenReady(): Promise<void> {
    if (!this.startPromise)
      throw new EngineError(
        "GAME_NOT_READY",
        "Call run before waiting for resources",
      );
    await this.startPromise;
    this.assertAlive();
    const prepared = this.prepared;
    this.render();
    await this.wait(prepared?.ready?.() ?? Promise.resolve());
    this.assertAlive();
    if (prepared !== this.prepared)
      throw new EngineError(
        "GAME_DISPOSED",
        "Scene presentation changed while waiting for resources",
      );
    this.render();
  }
  private updateProjection(): void {
    const v = this.requestedViewport,
      c = this.camera;
    if (
      !this.projectionDirty &&
      this.cameraX === c.x &&
      this.cameraY === c.y &&
      this.cameraZoom === c.zoom
    )
      return;
    this.projectionDirty = false;
    this.cameraX = c.x;
    this.cameraY = c.y;
    this.cameraZoom = c.zoom;
    this.projection = createViewTransform({
      viewport: v ?? { x: 0, y: 0, width: this.width, height: this.height },
      resolution: this.resolution,
      aspect: this.aspect,
      camera: c,
    });
  }
  private resize(): void {
    if (this.dead || !this.rendererReady) return;
    const width = this.element.clientWidth,
      height = this.element.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio =
      this.options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
    if (
      this.rendererSized &&
      this.width === width &&
      this.height === height &&
      this.ratio === ratio
    )
      return;
    this.rendererSized = true;
    if (this.width !== width || this.height !== height)
      this.projectionDirty = true;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.renderer.resize(width, height, this.ratio);
    this.updateProjection();
    if (this.ready) this.render();
  }
  private render(): void {
    this.updateProjection();
    this.canvasPresentation?.update(this.width, this.height);
    this.prepared?.render(this.projection);
  }
  private readonly tick = (time: number): void => {
    if (this.dead) return;
    try {
      if (document.hidden) {
        this.previousTime = undefined;
        this.fixed?.reset();
        this.engine.input.clear();
      } else {
        const elapsed =
          this.previousTime === undefined
            ? 0
            : Math.max(0, (time - this.previousTime) / 1000);
        this.previousTime = time;
        if (this.playback)
          this.playback.advance(elapsed, this.options.fixedStep?.maxSteps ?? 8);
        else if (this.fixed) this.fixed.advance(elapsed);
        else this.engine.step(Math.min(this.maxDelta, elapsed));
        if (
          this.ratio !==
          (this.options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2))
        )
          this.resize();
        this.render();
      }
      if (!this.dead) this.frame = this.frames.request(this.tick);
    } catch (error) {
      this.report(error);
      this.dispose();
    }
  };
  private readonly report = (error: unknown): void => {
    this.errorBox.textContent =
      error instanceof Error ? error.message : String(error);
    this.errorBox.hidden = false;
    try {
      if (this.options.onError) this.options.onError(error);
      else console.error(error);
    } catch {
      /* Observers must not prevent cleanup. */
    }
  };
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.shutdown.abort();
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    for (const cleanup of [
      () => this.stopReplay(),
      () => this.staging?.dispose(),
      () => this.pointers.dispose(),
      () => this.keyboard.dispose(),
      () => this.canvasPresentation?.dispose(),
      () => this.canvas?.dispose(),
      () => this.observer.disconnect(),
      () => this.ui?.dispose(),
      () => this.prepared?.dispose(),
      () => this.renderer.dispose(),
      () => this.engine.dispose(),
      () => this.element.remove(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        this.report(error);
      }
    }
    this.ui = undefined;
    this.prepared = undefined;
    this.staging = undefined;
    this.canvas = undefined;
    this.canvasPresentation = undefined;
    this.defaultCanvas = undefined;
    this.defaultUI.length = 0;
    this.scenes.clear();
    this.pendingScenes.clear();
  }
}
