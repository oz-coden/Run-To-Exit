import { cleanupAll, EngineError } from "@simpludify/core";
import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import { intersectUI } from "./canvas-layout";
import type { CanvasNode, UIBounds } from "./canvas-node";
import { wrapCanvasText } from "./canvas-text";
import type { CanvasUI } from "./canvas-ui";
import type { PointerRouting } from "./pointer-routing";

export interface CanvasPresentation {
  update(width: number, height: number): void;
  focus(node: CanvasNode): void;
  dispose(): void;
}
interface Entry {
  display: Container;
  background: Graphics;
  text?: Text;
  mask: Graphics;
  button?: HTMLButtonElement;
  abort: AbortController;
  signature?: string;
  textStyleKey?: string;
}
/** Pixi rendering and a small native focus mirror share the same resolved boxes. */
export class CanvasVisual implements CanvasPresentation {
  readonly display = new Container();
  private readonly element = document.createElement("div");
  private readonly entries = new Map<CanvasNode, Entry>();
  private readonly metrics = new Map<
    CanvasNode,
    {
      key: string;
      values: Map<number, { text: string; width: number; height: number }>;
    }
  >();
  private dirty = true;
  private dead = false;
  private active = false;
  private readonly subscriptions: Array<() => void> = [];
  private syncs = 0;
  constructor(
    private readonly ui: CanvasUI,
    private readonly host: HTMLElement,
    private readonly routing: PointerRouting,
    private readonly resources: {
      graphics(graphics: Graphics, context: number | undefined): void;
      text(text: Text, key: string | undefined): void;
      changedText(key: string): void;
    },
  ) {
    this.display.eventMode = "none";
    this.display.zIndex = 1;
    this.element.className = "s-canvas-accessibility";
    this.element.setAttribute("aria-label", "Game controls");
    this.subscriptions.push(
      ui.subscribe(() => {
        this.dirty = true;
      }),
      ui.onDispose(() => this.dispose()),
    );
  }
  get diagnostics() {
    return {
      nodes: this.entries.size,
      buttons: [...this.entries.values()].filter((e) => e.button).length,
      syncs: this.syncs,
      textMetrics: this.metrics.size,
    };
  }
  private measure = (node: CanvasNode, contentWidth = Infinity) => {
    const { fontSize, fontFamily, textWrap } = node.style;
    const key = JSON.stringify([node.text, fontSize, fontFamily, textWrap]);
    let cache = this.metrics.get(node);
    if (cache?.key !== key) {
      cache = { key, values: new Map() };
      this.metrics.set(node, cache);
    }
    const width = textWrap ? contentWidth : Infinity;
    const previous = cache.values.get(width);
    if (previous) return previous;
    const style = new TextStyle({ fontSize, fontFamily, wordWrap: false });
    const text = Number.isFinite(width)
      ? wrapCanvasText(
          node.text,
          width,
          (value) => CanvasTextMetrics.measureText(value || " ", style).width,
        )
      : node.text.replace(/\r\n?/g, "\n");
    const measured = CanvasTextMetrics.measureText(text || " ", style);
    const result = {
      text,
      width: text ? measured.width : 0,
      height: measured.height,
    };
    if (cache.values.size >= 8)
      cache.values.delete(cache.values.keys().next().value as number);
    cache.values.set(width, result);
    return result;
  };
  beforeResolutionChange(): void {
    for (const entry of this.entries.values())
      if (entry.text && !entry.text.destroyed)
        this.resources.changedText(entry.text.styleKey);
  }
  focus(node: CanvasNode): void {
    if (node.available)
      this.entries.get(node)?.button?.focus({ preventScroll: true });
  }
  private button(node: CanvasNode): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    const signal = this.entries.get(node)?.abort.signal;
    if (!signal)
      throw new EngineError("INVALID_UI", "Missing Canvas button entry");
    const options = { signal },
      keys = new Set<string>();
    const run = (task: () => void) => {
      try {
        task();
      } catch (error) {
        this.ui.report(error);
      }
    };
    button.addEventListener(
      "focus",
      () =>
        run(() => {
          node.focused = true;
          node.changed();
        }),
      options,
    );
    button.addEventListener(
      "blur",
      () =>
        run(() => {
          keys.clear();
          node.focused = false;
          node.changed();
          this.routing.releaseKeys(node);
        }),
      options,
    );
    button.addEventListener(
      "keydown",
      (event) => {
        if (event.code !== "Enter" && event.code !== "Space") return;
        event.preventDefault();
        if (!event.repeat)
          run(() => {
            keys.add(event.code);
            this.routing.key(node, event.code, true);
          });
      },
      options,
    );
    button.addEventListener(
      "keyup",
      (event) => {
        if (event.code !== "Enter" && event.code !== "Space") return;
        event.preventDefault();
        const wasDown =
          keys.delete(event.code) && this.routing.hasKey(node, event.code);
        run(() => {
          this.routing.key(node, event.code, false);
          if (wasDown && node.kind === "button" && node.available)
            node.activate();
        });
      },
      options,
    );
    // AT/automation can activate the semantic control without a physical key.
    button.addEventListener(
      "click",
      () =>
        run(() => {
          if (node.kind === "button" && node.available) node.activate();
        }),
      options,
    );
    return button;
  }
  private updateButton(entry: Entry, node: CanvasNode, clip: UIBounds): void {
    if (!entry.button) return;
    const button = entry.button,
      b = node.bounds,
      s = this.ui.scale,
      c = intersectUI(b, clip);
    if (button.textContent !== node.text) button.textContent = node.text;
    button.disabled =
      !node.available ||
      c.width <= 0 ||
      c.height <= 0 ||
      node.style.pointerEvents !== "auto";
    if (node.kind === "hold-button")
      button.setAttribute("aria-pressed", String(node.held));
    button.setAttribute("aria-busy", String(node.busy));
    button.style.cssText = `left:${c.x * s}px;top:${c.y * s}px;width:${c.width * s}px;height:${c.height * s}px;`;
    if (button.disabled && document.activeElement === button) button.blur();
  }
  update(width: number, height: number): void {
    if (this.dead || this.ui.disposed) return;
    const layout = this.ui.layout(width, height, this.measure);
    if (!this.active) {
      this.host.append(this.element);
      this.active = true;
    }
    if (!this.dirty && !layout) return;
    this.dirty = false;
    this.syncs++;
    this.display.scale.set(this.ui.scale);
    const visited = new Set<CanvasNode>(),
      buttons: HTMLButtonElement[] = [];
    let order = 0;
    this.ui.walk((node, parentClip) => {
      const measuredText =
        node.kind === "panel"
          ? undefined
          : this.measure(
              node,
              Math.max(0, node.bounds.width - node.style.padding * 2),
            );
      const clip =
        measuredText &&
        (measuredText.width > node.bounds.width - node.style.padding * 2 ||
          measuredText.height > node.bounds.height - node.style.padding * 2)
          ? intersectUI(parentClip, node.bounds)
          : parentClip;
      visited.add(node);
      let entry = this.entries.get(node);
      if (!entry) {
        const display = new Container(),
          background = new Graphics(),
          mask = new Graphics();
        display.addChild(background);
        this.display.addChild(display, mask);
        mask.renderable = false;
        entry = { display, background, mask, abort: new AbortController() };
        this.entries.set(node, entry);
        if (node.interactive) {
          entry.button = this.button(node);
          this.element.append(entry.button);
        }
        if (node.kind !== "panel") {
          entry.text = new Text({ text: node.text });
          display.addChild(entry.text);
        }
      }
      this.display.setChildIndex(entry.display, order++);
      this.display.setChildIndex(entry.mask, order++);
      if (entry.button) buttons.push(entry.button);
      const b = node.bounds,
        s = node.style;
      let enabled = !node.busy;
      for (let p: CanvasNode | undefined = node; p; p = p.parent)
        enabled &&= p.enabled;
      const signature = JSON.stringify([
        node.paintRevision,
        b.x,
        b.y,
        b.width,
        b.height,
        clip.x,
        clip.y,
        clip.width,
        clip.height,
        node.available,
        enabled,
        this.ui.scale,
      ]);
      if (entry.signature === signature) return;
      entry.signature = signature;
      entry.display.position.set(b.x, b.y);
      const clipped =
        clip.x !== 0 ||
        clip.y !== 0 ||
        clip.width !== width / this.ui.scale ||
        clip.height !== height / this.ui.scale;
      entry.display.mask = clipped ? entry.mask : null;
      // StencilMaskPipe collects renderables; includeInBuild is managed by Pixi.
      entry.mask.renderable = clipped;
      if (clipped)
        entry.mask
          .clear()
          .rect(clip.x, clip.y, clip.width, clip.height)
          .fill(0xffffff);
      entry.background.visible = s.background !== undefined || node.interactive;
      entry.background.clear();
      if (s.background !== undefined || node.interactive) {
        entry.background
          .roundRect(
            0,
            0,
            b.width,
            b.height,
            Math.min(s.radius, b.width / 2, b.height / 2),
          )
          .fill(s.background ?? 0x23594e);
        if (node.held)
          entry.background
            .roundRect(0, 0, b.width, b.height, s.radius)
            .fill({ color: 0xffffff, alpha: 0.18 });
        else if (node.hovered)
          entry.background
            .roundRect(0, 0, b.width, b.height, s.radius)
            .fill({ color: 0xffffff, alpha: 0.08 });
        if (node.focused)
          entry.background
            .roundRect(
              2,
              2,
              Math.max(0, b.width - 4),
              Math.max(0, b.height - 4),
              s.radius,
            )
            .stroke({ color: 0xffd36b, width: 3 });
      }
      entry.display.alpha = enabled ? 1 : 0.45;
      if (entry.text) {
        const m = measuredText ?? this.measure(node);
        if (entry.text.text !== m.text) {
          this.resources.changedText(entry.text.styleKey);
          entry.text.text = m.text;
        }
        const textStyleKey = JSON.stringify([
          s.fontFamily,
          s.fontSize,
          s.color,
        ]);
        if (entry.textStyleKey !== textStyleKey) {
          this.resources.changedText(entry.text.styleKey);
          entry.textStyleKey = textStyleKey;
          entry.text.style = {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fill: s.color,
          };
        }
        entry.text.position.set(
          node.interactive
            ? Math.max(s.padding, (b.width - m.width) / 2)
            : s.padding,
          node.interactive
            ? Math.max(s.padding, (b.height - m.height) / 2)
            : s.padding,
        );
      }
      this.updateButton(entry, node, clip);
    });
    for (const [node, entry] of this.entries)
      if (!visited.has(node)) {
        this.entries.delete(node);
        this.metrics.delete(node);
        this.releaseEntry(entry);
      }
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (!button) continue;
      const current = this.element.children.item(i);
      if (current !== button) this.element.insertBefore(button, current);
    }
  }
  private releaseEntry(entry: Entry): void {
    const backgroundContext = entry.background.context?.uid,
      maskContext = entry.mask.context?.uid;
    const textKey =
      entry.text && !entry.text.destroyed ? entry.text.styleKey : undefined;
    cleanupAll(
      [
        () => entry.abort.abort(),
        () => entry.button?.remove(),
        // These Graphics contexts and Text styles are private to this presentation.
        // An options object with only children:true does not destroy owned GraphicsContext in Pixi8.
        () => entry.background.destroy({ context: true }),
        () => entry.text?.destroy({ style: true }),
        () => entry.display.destroy({ children: true }),
        () => entry.mask.destroy({ context: true }),
        () => this.resources.graphics(entry.background, backgroundContext),
        () => this.resources.graphics(entry.mask, maskContext),
        () => {
          if (entry.text) this.resources.text(entry.text, textKey);
        },
      ],
      "Canvas visual entry cleanup failed",
    );
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.metrics.clear();
    cleanupAll(
      [
        ...this.subscriptions.splice(0),
        ...entries.map((e) => () => this.releaseEntry(e)),
        () => this.display.destroy({ children: true }),
        () => this.element.remove(),
      ],
      "Canvas visual cleanup failed",
    );
  }
}
