import {
  cleanupAll,
  EngineError,
  Lifetime,
  type LifetimeOwner,
  positive,
  type Scene,
} from "@simpludify/core";
import {
  containsUI,
  intersectUI,
  layoutCanvas,
  type MeasureText,
} from "./canvas-layout";
import type { CanvasNode, UIBounds } from "./canvas-node";
export interface CanvasUIOptions {
  /** Host CSS pixels per UI unit, independent of Camera and DPR. Default 1. */ scale?: number;
}
/** A single Scene-owned screen UI tree, prepared detached and mounted at Scene commit. */
export class CanvasUI implements LifetimeOwner {
  private readonly lifetime = new Lifetime();
  private factor: number;
  private dirty = true;
  private width = -1;
  private height = -1;
  private readonly listeners = new Set<() => void>();
  private removeScene: (() => void) | undefined;
  private visits = 0;
  private layouts = 0;
  private intrinsicVisits = 0;
  private constrainVisits = 0;
  private hits = 0;
  private hitVisits = 0;
  private nodes = 0;
  private errors: (error: unknown) => void = () => {};
  constructor(
    readonly scene: Scene,
    readonly root: CanvasNode,
    options: CanvasUIOptions = {},
  ) {
    this.factor = positive(options.scale ?? 1, "ui.scale");
    if (scene.disposed || root.disposed || root.parent || root.owner)
      throw new EngineError(
        "UI_OWNERSHIP",
        "UI root must be alive and unowned",
      );
    root.owner = this;
    try {
      this.removeScene = scene.onDispose(() => this.dispose());
    } catch (error) {
      root.owner = undefined;
      throw error;
    }
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  get scale(): number {
    return this.factor;
  }
  set scale(value: number) {
    if (this.disposed)
      throw new EngineError("OWNER_DISPOSED", "UI has been disposed");
    const next = positive(value, "ui.scale");
    if (next !== this.factor) {
      this.factor = next;
      this.invalidate(true);
    }
  }
  get diagnostics() {
    return {
      layouts: this.layouts,
      layoutVisits: this.visits,
      intrinsicVisits: this.intrinsicVisits,
      constrainVisits: this.constrainVisits,
      nodes: this.nodes,
      hitTests: this.hits,
      hitVisits: this.hitVisits,
      subscriptions: this.listeners.size,
    };
  }
  onDispose(callback: () => void): () => void {
    return this.lifetime.onDispose(callback);
  }
  /** @internal */ setErrorHandler(handler: (error: unknown) => void): void {
    this.errors = handler;
  }
  /** @internal */ report(error: unknown): void {
    try {
      this.errors(error);
    } catch {
      /* Observers cannot block release. */
    }
  }
  /** @internal */ subscribe(listener: () => void): () => void {
    if (this.disposed)
      throw new EngineError("OWNER_DISPOSED", "UI has been disposed");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** @internal */ invalidate(layout = false): void {
    if (layout) this.dirty = true;
    cleanupAll([...this.listeners], "UI invalidation failed");
  }
  /** @internal Rendering supplies exact text metrics; unchanged frames do no layout. */
  layout(width: number, height: number, measure: MeasureText): boolean {
    if (this.disposed) return false;
    if (!this.dirty && this.width === width && this.height === height)
      return false;
    const visits = layoutCanvas(
      this.root,
      width / this.factor,
      height / this.factor,
      measure,
    );
    this.width = width;
    this.height = height;
    this.dirty = false;
    this.layouts++;
    this.visits += visits.nodes;
    this.intrinsicVisits += visits.intrinsicVisits;
    this.constrainVisits += visits.constrainVisits;
    this.nodes = visits.nodes;
    return true;
  }
  /** @internal Same clipped paint order as Pixi and keyboard mirror. */
  walk(visit: (node: CanvasNode, clip: UIBounds) => void): void {
    if (this.disposed) return;
    const walk = (node: CanvasNode, clip: UIBounds) => {
      if (node.disposed || !node.visible) return;
      const c = node.style.clip ? intersectUI(clip, node.bounds) : clip;
      visit(node, c);
      for (const child of node.children) walk(child, c);
    };
    walk(this.root, {
      x: 0,
      y: 0,
      width: Math.max(0, this.width / this.factor),
      height: Math.max(0, this.height / this.factor),
    });
  }
  hitTest(x: number, y: number): CanvasNode | undefined {
    this.hits++;
    let result: CanvasNode | undefined;
    const walk = (node: CanvasNode, clip: UIBounds) => {
      this.hitVisits++;
      if (
        node.disposed ||
        !node.visible ||
        !node.enabled ||
        node.busy ||
        node.style.pointerEvents === "none" ||
        !containsUI(clip, x, y)
      )
        return;
      const c = node.style.clip ? intersectUI(clip, node.bounds) : clip;
      if (!containsUI(c, x, y)) return;
      if (node.style.pointerEvents === "auto" && containsUI(node.bounds, x, y))
        result = node;
      for (const child of node.children) walk(child, c);
    };
    if (!this.disposed)
      walk(this.root, {
        x: 0,
        y: 0,
        width: Math.max(0, this.width / this.factor),
        height: Math.max(0, this.height / this.factor),
      });
    return result;
  }
  dispose(): void {
    if (this.disposed) return;
    cleanupAll(
      [
        () => this.lifetime.dispose(),
        () => this.root.dispose(),
        () => this.removeScene?.(),
        () => {
          this.listeners.clear();
          this.removeScene = undefined;
          this.nodes = 0;
          this.errors = () => {};
        },
      ],
      "Canvas UI cleanup failed",
    );
  }
}
