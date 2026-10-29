import {
  cleanupAll,
  defineEvent,
  EventBus,
  Lifetime,
  type LifetimeOwner,
  type Scene,
  type ScreenPoint,
  type WorldPoint,
} from "@simpludify/core";
import type { CanvasNode } from "./canvas-node";
import type { CanvasUI } from "./canvas-ui";
/** Snapshot coordinates at DOM delivery. Screen is host CSS units; world includes the current Camera. */
export interface PointerInfo {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly screen: ScreenPoint;
  readonly world: WorldPoint;
  /** Inside the original UI target's current clipped hit area, or the world viewport clip. */
  readonly inside: boolean;
}
export const PointerDown = defineEvent<PointerInfo>("PointerDown");
export const PointerMove = defineEvent<PointerInfo>("PointerMove");
export const PointerUp = defineEvent<PointerInfo>("PointerUp");
export const PointerCancel = defineEvent<PointerInfo>("PointerCancel");
export const PointerEnter = defineEvent<PointerInfo>("PointerEnter");
export const PointerLeave = defineEvent<PointerInfo>("PointerLeave");
export const PointerClick = defineEvent<PointerInfo>("PointerClick");
/** Scene-scoped world input. UI gestures are never delivered here. */
export class ScenePointer implements LifetimeOwner {
  private readonly lifetime = new Lifetime();
  readonly events = new EventBus();
  private readonly removeScene: () => void;
  constructor(readonly scene: Scene) {
    this.removeScene = scene.onDispose(() => this.dispose());
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  onDispose(callback: () => void): () => void {
    return this.lifetime.onDispose(callback);
  }
  dispose(): void {
    if (this.disposed) return;
    cleanupAll(
      [
        () => this.lifetime.dispose(),
        () => this.events.dispose(),
        this.removeScene,
      ],
      "Scene pointer cleanup failed",
    );
  }
}
interface Gesture {
  channel: ScenePointer;
  node?: CanvasNode;
  ui?: CanvasUI;
  last: PointerInfo;
  primary: boolean;
  off?: () => void;
}
/** @internal Device-independent routing state; DOM is only an adapter. */
export class PointerRouting {
  private readonly suppressed = new Set<number>();
  private readonly gestures = new Map<number, Gesture>();
  private readonly hovering = new Map<
    number,
    { node: CanvasNode; info: PointerInfo }
  >();
  private readonly holds = new Map<CanvasNode, Set<number | string>>();
  private readonly keys = new Map<CanvasNode, Set<string>>();
  private channel: ScenePointer | undefined;
  private ui: CanvasUI | undefined;
  private subscriptions: Array<() => void> = [];
  private deliveries = 0;
  constructor(private readonly released: (id: number) => void = () => {}) {}
  get diagnostics() {
    return {
      captures: this.gestures.size,
      suppressedPointers: this.suppressed.size,
      hoverPointers: this.hovering.size,
      heldNodes: this.holds.size,
      keyboardNodes: this.keys.size,
      deliveries: this.deliveries,
    };
  }
  setScene(channel: ScenePointer, ui?: CanvasUI): void {
    this.reset();
    this.channel = channel;
    this.ui = ui;
    this.subscriptions.push(channel.onDispose(() => this.reset()));
    if (ui) {
      this.subscriptions.push(ui.onDispose(() => this.reset()));
      this.subscriptions.push(ui.subscribe(() => this.prune()));
    }
  }
  private hold(node: CanvasNode, key: number | string, down: boolean): void {
    const set = this.holds.get(node) ?? new Set<number | string>();
    if (down) set.add(key);
    else set.delete(key);
    if (set.size) this.holds.set(node, set);
    else this.holds.delete(node);
    if (node.kind === "hold-button") node.setHeld(set.size > 0);
    else if (node.held !== set.size > 0) {
      node.held = set.size > 0;
      node.changed();
    }
  }
  private emit(
    gesture: Gesture,
    type: typeof PointerDown,
    info: PointerInfo,
  ): void {
    if (gesture.channel.disposed || gesture.node?.disposed) return;
    this.deliveries++;
    (gesture.node?.events ?? gesture.channel.events).emit(type, info);
  }
  private inside(g: Gesture, data: PointerInfo): PointerInfo {
    return Object.freeze({
      ...data,
      inside: g.node
        ? g.ui?.hitTest(
            data.screen.x / g.ui.scale,
            data.screen.y / g.ui.scale,
          ) === g.node
        : data.inside,
    });
  }
  down(data: PointerInfo): CanvasNode | undefined {
    if (!this.channel || this.channel.disposed) return;
    if (this.gestures.has(data.pointerId)) this.cancel(data.pointerId);
    this.suppressed.delete(data.pointerId);
    const node = this.ui?.hitTest(
      data.screen.x / this.ui.scale,
      data.screen.y / this.ui.scale,
    );
    if (!node && !data.inside) return;
    const g: Gesture = {
      channel: this.channel,
      last: data,
      primary: data.button === 0,
      ...(node ? { node, ui: this.ui as CanvasUI } : {}),
    };
    this.gestures.set(data.pointerId, g);
    if (node) g.off = node.onDispose(() => this.cancel(data.pointerId));
    cleanupAll(
      [
        () => {
          if (node?.interactive && g.primary)
            this.hold(node, data.pointerId, true);
        },
        () => {
          if (!node || node.available)
            this.emit(g, PointerDown, this.inside(g, data));
        },
      ],
      "Pointer down handlers failed",
    );
    return node;
  }
  hasHover(id: number): boolean {
    return this.hovering.has(id);
  }
  has(id: number): boolean {
    return this.gestures.has(id);
  }
  owns(id: number): boolean {
    return this.gestures.has(id) || this.suppressed.has(id);
  }
  move(data: PointerInfo): void {
    if (this.suppressed.has(data.pointerId)) return;
    const g = this.gestures.get(data.pointerId);
    if (g) {
      g.last = data;
      this.emit(g, PointerMove, this.inside(g, data));
      return;
    }
    if (!this.channel || this.channel.disposed) return;
    const node = this.ui?.hitTest(
      data.screen.x / this.ui.scale,
      data.screen.y / this.ui.scale,
    );
    this.hover(data.pointerId, node, data);
    if (node?.available) {
      this.deliveries++;
      node.events.emit(PointerMove, Object.freeze({ ...data, inside: true }));
    } else if (!node && data.inside) {
      this.deliveries++;
      this.channel.events.emit(PointerMove, data);
    }
  }
  leave(data: PointerInfo): void {
    if (!this.gestures.has(data.pointerId))
      this.hover(data.pointerId, undefined, data);
  }
  private hover(
    id: number,
    node: CanvasNode | undefined,
    info: PointerInfo,
  ): void {
    const previous = this.hovering.get(id);
    if (previous?.node === node) {
      if (node) this.hovering.set(id, { node, info });
      return;
    }
    this.hovering.delete(id);
    if (node) this.hovering.set(id, { node, info });
    cleanupAll(
      [
        () => {
          if (previous) {
            previous.node.hovered = [...this.hovering.values()].some(
              (h) => h.node === previous.node,
            );
            previous.node.changed();
            if (!previous.node.disposed)
              previous.node.events.emit(
                PointerLeave,
                Object.freeze({ ...info, inside: false }),
              );
          }
        },
        () => {
          if (node?.available) {
            node.hovered = true;
            node.changed();
            node.events.emit(
              PointerEnter,
              Object.freeze({ ...info, inside: true }),
            );
          }
        },
      ],
      "Pointer hover handlers failed",
    );
  }
  up(data: PointerInfo): void {
    if (this.suppressed.delete(data.pointerId)) return;
    const g = this.gestures.get(data.pointerId);
    if (!g) return;
    this.gestures.delete(data.pointerId);
    const info = this.inside(g, data);
    cleanupAll(
      [
        () => g.off?.(),
        () => this.released(data.pointerId),
        () => {
          if (g.node?.interactive) this.hold(g.node, data.pointerId, false);
        },
        () => {
          if (!g.node || g.node.available) this.emit(g, PointerUp, info);
        },
        () => {
          if (g.primary && info.inside && (!g.node || g.node.available))
            this.emit(g, PointerClick, info);
        },
        () => {
          if (g.primary && info.inside && g.node?.available) g.node.activate();
        },
      ],
      "Pointer up handlers failed",
    );
  }
  cancel(id: number, retainOwnership = true): void {
    if (!retainOwnership) this.suppressed.delete(id);
    const g = this.gestures.get(id);
    if (!g) return;
    this.gestures.delete(id);
    if (retainOwnership) this.suppressed.add(id);
    cleanupAll(
      [
        () => g.off?.(),
        () => this.released(id),
        () => {
          if (g.node?.interactive) this.hold(g.node, id, false);
        },
        () =>
          this.emit(
            g,
            PointerCancel,
            Object.freeze({ ...g.last, inside: false }),
          ),
      ],
      "Pointer cancel handlers failed",
    );
  }
  hasKey(node: CanvasNode, code: string): boolean {
    return this.keys.get(node)?.has(code) ?? false;
  }
  key(node: CanvasNode, code: string, down: boolean): void {
    if (code !== "Space" && code !== "Enter") return;
    if (down && !node.available) return;
    const set = this.keys.get(node) ?? new Set<string>();
    if (down) {
      set.add(code);
      this.keys.set(node, set);
    } else {
      set.delete(code);
      if (!set.size) this.keys.delete(node);
    }
    this.hold(node, `key:${code}`, down);
  }
  releaseKeys(node: CanvasNode): void {
    const keys = [...(this.keys.get(node) ?? [])];
    this.keys.delete(node);
    cleanupAll(
      keys.map((code) => () => this.hold(node, `key:${code}`, false)),
      "Keyboard hold cleanup failed",
    );
  }
  private prune(): void {
    cleanupAll(
      [
        ...[...this.gestures]
          .filter(([, g]) => g.node && !g.node.available)
          .map(
            ([id]) =>
              () =>
                this.cancel(id),
          ),
        ...[...this.hovering]
          .filter(([, h]) => !h.node.available)
          .map(
            ([id, h]) =>
              () =>
                this.hover(id, undefined, h.info),
          ),
        ...[...this.keys.keys()]
          .filter((n) => !n.available)
          .map((n) => () => this.releaseKeys(n)),
      ],
      "Invalid pointer cleanup failed",
    );
  }
  release(): void {
    cleanupAll(
      [
        ...[...this.gestures.keys()].map((id) => () => this.cancel(id)),
        ...[...this.hovering].map(
          ([id, h]) =>
            () =>
              this.hover(id, undefined, h.info),
        ),
        ...[...this.keys.keys()].map((n) => () => this.releaseKeys(n)),
      ],
      "Pointer release failed",
    );
  }
  dispose(): void {
    try {
      this.reset();
    } finally {
      this.suppressed.clear();
    }
  }
  reset(): void {
    const off = this.subscriptions.splice(0);
    this.channel = undefined;
    this.ui = undefined;
    cleanupAll(
      [...off, () => this.release()],
      "Pointer routing cleanup failed",
    );
  }
}
