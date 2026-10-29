import {
  cleanupAll,
  EngineError,
  EventBus,
  Lifetime,
  type LifetimeOwner,
} from "@simpludify/core";
import type { CanvasUI } from "./canvas-ui";

export type UISize = number | `${number}%`;
export type UIAlign = "start" | "center" | "end" | "stretch";
export type UIJustify =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around";
export interface CanvasStyle {
  width?: UISize;
  height?: UISize;
  minWidth?: UISize;
  maxWidth?: UISize;
  minHeight?: UISize;
  maxHeight?: UISize;
  /** Wrap text at the allocated content width. Default true. */
  textWrap?: boolean;
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  grow?: number;
  shrink?: number;
  align?: UIAlign;
  alignSelf?: UIAlign;
  justify?: UIJustify;
  wrap?: boolean;
  clip?: boolean;
  /** auto blocks world input, children permits empty-space pass-through, none excludes subtree. */
  pointerEvents?: "auto" | "children" | "none";
  background?: number;
  color?: number;
  fontSize?: number;
  fontFamily?: string;
  radius?: number;
}
export interface UIBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export const defaultCanvasStyle = Object.freeze({
  direction: "column",
  gap: 0,
  padding: 0,
  grow: 0,
  shrink: 1,
  align: "stretch",
  justify: "start",
  wrap: false,
  textWrap: true,
  clip: false,
  pointerEvents: "children",
  color: 0xeff7f6,
  fontSize: 18,
  fontFamily: "system-ui, sans-serif",
  radius: 6,
} as const);
type OptionalStyle =
  | "width"
  | "height"
  | "minWidth"
  | "maxWidth"
  | "minHeight"
  | "maxHeight"
  | "background"
  | "alignSelf";
export type ResolvedCanvasStyle = Readonly<
  Required<Omit<CanvasStyle, OptionalStyle>> & Pick<CanvasStyle, OptionalStyle>
>;
function checkedStyle(value: CanvasStyle): ResolvedCanvasStyle {
  const result = { ...defaultCanvasStyle, ...value };
  const fields = new Set([
    ...Object.keys(defaultCanvasStyle),
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "background",
    "alignSelf",
  ]);
  for (const [key, v] of Object.entries(result)) {
    if (!fields.has(key) || v === undefined)
      throw new EngineError(
        "INVALID_UI",
        `Unknown or undefined UI style: ${key}`,
      );
    if (
      [
        "width",
        "height",
        "minWidth",
        "maxWidth",
        "minHeight",
        "maxHeight",
      ].includes(key)
    ) {
      if (
        typeof v === "string" &&
        /^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(v) &&
        Number.isFinite(Number(v.slice(0, -1)))
      )
        continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
        throw new EngineError(
          "INVALID_UI",
          `${key} must be nonnegative or a percentage`,
        );
    } else if (
      [
        "gap",
        "padding",
        "grow",
        "shrink",
        "radius",
        "fontSize",
        "background",
        "color",
      ].includes(key)
    ) {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        (key === "fontSize" && v === 0) ||
        (["color", "background"].includes(key) &&
          (!Number.isInteger(v) || v > 0xffffff))
      )
        throw new EngineError("INVALID_UI", `Invalid UI ${key}`);
    } else if (["wrap", "clip", "textWrap"].includes(key)) {
      if (typeof v !== "boolean")
        throw new EngineError("INVALID_UI", `Invalid UI ${key}`);
    } else {
      const choices: Record<string, readonly string[]> = {
        direction: ["row", "column"],
        align: ["start", "center", "end", "stretch"],
        alignSelf: ["start", "center", "end", "stretch"],
        justify: ["start", "center", "end", "space-between", "space-around"],
        pointerEvents: ["auto", "children", "none"],
      };
      if (
        typeof v !== "string" ||
        (choices[key] ? !choices[key].includes(v) : !v.length)
      )
        throw new EngineError("INVALID_UI", `Invalid UI ${key}`);
    }
  }
  return Object.freeze(result);
}
export type CanvasNodeKind = "panel" | "label" | "button" | "hold-button";
/** Web-only UI model. Single-parent ownership; removing a child disposes that subtree. */
export class CanvasNode implements LifetimeOwner {
  private readonly lifetime = new Lifetime();
  readonly events = new EventBus();
  readonly signal: AbortSignal;
  private readonly abort = new AbortController();
  private list: readonly CanvasNode[] = Object.freeze([]);
  private parentNode: CanvasNode | undefined;
  /** @internal Only a root can be claimed by a Scene UI. */ owner:
    | CanvasUI
    | undefined;
  private config: ResolvedCanvasStyle;
  private value: string;
  private shown = true;
  private active = true;
  private working = false;
  /** @internal */ hovered = false;
  /** @internal */ focused = false;
  /** @internal */ held = false;
  /** @internal */ paintRevision = 0;
  /** @internal */ boundsValue: UIBounds = Object.freeze({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  private click: ((signal: AbortSignal) => void | Promise<void>) | undefined;
  private hold: ((held: boolean) => void) | undefined;
  /** @internal Prefer CanvasPanel/Label/Button/HoldButton. */
  constructor(
    readonly kind: CanvasNodeKind,
    options: {
      text?: string;
      style?: CanvasStyle;
      click?: (signal: AbortSignal) => void | Promise<void>;
      hold?: (held: boolean) => void;
    } = {},
  ) {
    this.value = options.text ?? "";
    if (typeof this.value !== "string")
      throw new EngineError("INVALID_UI", "UI text must be a string");
    this.config = checkedStyle(options.style ?? {});
    this.click = options.click;
    this.hold = options.hold;
    this.signal = this.abort.signal;
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  get parent(): CanvasNode | undefined {
    return this.parentNode;
  }
  get children(): readonly CanvasNode[] {
    return this.list;
  }
  get style(): ResolvedCanvasStyle {
    return this.config;
  }
  get text(): string {
    return this.value;
  }
  get bounds(): UIBounds {
    return this.boundsValue;
  }
  get visible(): boolean {
    return this.shown;
  }
  set visible(value: boolean) {
    this.setFlag("visible", value);
  }
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    this.setFlag("enabled", value);
  }
  get busy(): boolean {
    return this.working;
  }
  get ui(): CanvasUI | undefined {
    return this.owner ?? this.parentNode?.ui;
  }
  get interactive(): boolean {
    return this.kind === "button" || this.kind === "hold-button";
  }
  get available(): boolean {
    for (
      let node: CanvasNode | undefined = this;
      node;
      node = node.parentNode
    ) {
      if (
        node.disposed ||
        !node.shown ||
        !node.active ||
        node.working ||
        node.config.pointerEvents === "none" ||
        node.owner?.disposed
      )
        return false;
    }
    return true;
  }
  onDispose(callback: () => void): () => void {
    return this.lifetime.onDispose(callback);
  }
  private assertAlive(): void {
    if (this.disposed)
      throw new EngineError("OWNER_DISPOSED", "UI node has been disposed");
  }
  private setFlag(key: "visible" | "enabled", value: boolean): void {
    this.assertAlive();
    if (typeof value !== "boolean")
      throw new EngineError("INVALID_UI", `${key} must be boolean`);
    if (this[key] === value) return;
    if (key === "visible") this.shown = value;
    else this.active = value;
    this.changed(key === "visible");
  }
  setStyle(value: CanvasStyle): void {
    this.assertAlive();
    const next = checkedStyle({ ...this.config, ...value });
    if (
      Object.keys(next).every(
        (k) =>
          next[k as keyof CanvasStyle] === this.config[k as keyof CanvasStyle],
      )
    )
      return;
    const geometry: readonly (keyof CanvasStyle)[] = [
      "width",
      "height",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
      "textWrap",
      "direction",
      "gap",
      "padding",
      "grow",
      "shrink",
      "align",
      "alignSelf",
      "justify",
      "wrap",
      "fontSize",
      "fontFamily",
    ];
    const layout = geometry.some((key) => next[key] !== this.config[key]);
    this.config = next;
    this.changed(layout);
  }
  setText(text: string): void {
    this.assertAlive();
    if (typeof text !== "string")
      throw new EngineError("INVALID_UI", "UI text must be a string");
    if (text === this.value) return;
    this.value = text;
    this.changed(true);
  }
  /** Appending claims and eventually disposes children; nodes cannot belong to two trees. */
  add(...nodes: CanvasNode[]): this {
    this.assertAlive();
    if (this.kind !== "panel")
      throw new EngineError("INVALID_UI", "Only panels contain children");
    const unique = new Set(nodes);
    if (unique.size !== nodes.length)
      throw new EngineError("UI_OWNERSHIP", "Duplicate UI child");
    for (const node of nodes) {
      if (node.disposed || node.parentNode || node.owner)
        throw new EngineError(
          "UI_OWNERSHIP",
          "UI child already owned or disposed",
        );
      for (let p: CanvasNode | undefined = this; p; p = p.parentNode)
        if (p === node) throw new EngineError("UI_OWNERSHIP", "UI tree cycle");
    }
    for (const node of nodes) node.parentNode = this;
    this.list = Object.freeze([...this.list, ...nodes]);
    this.changed(true);
    return this;
  }
  remove(node: CanvasNode): boolean {
    this.assertAlive();
    if (node.parentNode !== this) return false;
    node.dispose();
    return true;
  }
  /** @internal */ changed(layout = false): void {
    this.paintRevision++;
    this.ui?.invalidate(layout);
  }
  /** @internal */ setHeld(value: boolean): void {
    if (value === this.held) return;
    this.held = value;
    this.changed();
    const result: unknown = this.hold?.(value);
    if (
      result &&
      (typeof result === "object" || typeof result === "function") &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).catch(() => {});
      throw new EngineError(
        "UI_ASYNC_HOLD",
        "Hold handlers must be synchronous; own asynchronous work separately",
      );
    }
  }
  /** @internal Async callbacks are cancellable and disable this button until settled. */
  activate(): void {
    if (!this.available || this.kind !== "button" || !this.click) return;
    const result = this.click(this.signal);
    if (result && typeof result.then === "function") {
      this.working = true;
      this.changed();
      void result
        .catch((error) => {
          if (!this.signal.aborted) this.ui?.report(error);
        })
        .finally(() => {
          this.working = false;
          if (!this.disposed) this.changed();
        });
    }
  }
  dispose(): void {
    if (this.disposed) return;
    const ui = this.ui;
    const children = this.list;
    this.list = Object.freeze([]);
    if (this.parentNode) {
      this.parentNode.list = Object.freeze(
        this.parentNode.list.filter((n) => n !== this),
      );
      this.parentNode = undefined;
    }
    cleanupAll(
      [
        () => this.lifetime.dispose(),
        () => this.abort.abort(),
        () => ui?.invalidate(true),
        () => this.setHeld(false),
        ...children.map((n) => () => n.dispose()),
        () => this.events.dispose(),
        () => {
          this.owner = undefined;
          this.click = undefined;
          this.hold = undefined;
        },
      ],
      "Canvas node cleanup failed",
    );
  }
}
export function CanvasPanel(
  children: readonly CanvasNode[] = [],
  style: CanvasStyle = {},
): CanvasNode {
  return new CanvasNode("panel", { style }).add(...children);
}
export function CanvasRow(
  children: readonly CanvasNode[],
  style: CanvasStyle = {},
): CanvasNode {
  return CanvasPanel(children, { ...style, direction: "row" });
}
export function CanvasColumn(
  children: readonly CanvasNode[],
  style: CanvasStyle = {},
): CanvasNode {
  return CanvasPanel(children, { ...style, direction: "column" });
}
export function CanvasLabel(text: string, style: CanvasStyle = {}): CanvasNode {
  return new CanvasNode("label", { text, style });
}
export function CanvasButton(
  text: string,
  click: (signal: AbortSignal) => void | Promise<void>,
  style: CanvasStyle = {},
): CanvasNode {
  return new CanvasNode("button", {
    text,
    click,
    style: {
      padding: 12,
      background: 0x23594e,
      pointerEvents: "auto",
      ...style,
    },
  });
}
export function CanvasHoldButton(
  text: string,
  hold: (held: boolean) => void,
  style: CanvasStyle = {},
): CanvasNode {
  return new CanvasNode("hold-button", {
    text,
    hold,
    style: {
      padding: 12,
      background: 0x23594e,
      pointerEvents: "auto",
      ...style,
    },
  });
}
