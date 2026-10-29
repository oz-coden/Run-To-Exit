import { EngineError } from "@simpludify/core";
import type { CanvasNode, UIBounds, UISize } from "./canvas-node";
export interface UISizeValue {
  width: number;
  height: number;
}
export type MeasureText = (
  node: CanvasNode,
  contentWidth?: number,
) => UISizeValue;
const finite = (v: number) => {
  if (!Number.isFinite(v) || v < 0)
    throw new EngineError("INVALID_UI", "UI layout overflow");
  return v;
};
const size = (v: UISize | undefined, parent: number): number | undefined =>
  v === undefined
    ? undefined
    : finite(
        typeof v === "number" ? v : (Number(v.slice(0, -1)) / 100) * parent,
      );
// A conflicting minimum wins, including percentage constraints after parent resolution.
const unbounded = Object.freeze({ min: 0, max: Infinity });
const limits = (node: CanvasNode, axis: "Width" | "Height", parent: number) => {
  const s = node.style;
  const minimum = axis === "Width" ? s.minWidth : s.minHeight;
  const maximum = axis === "Width" ? s.maxWidth : s.maxHeight;
  if (minimum === undefined && maximum === undefined) return unbounded;
  const min = size(minimum, parent) ?? 0;
  return { min, max: Math.max(min, size(maximum, parent) ?? Infinity) };
};
const clamp = (value: number, range: { min: number; max: number }) =>
  finite(Math.max(range.min, Math.min(range.max, value)));
interface Item {
  min: number;
  max: number;
  node: CanvasNode;
  main: number;
  cross: number;
  explicitCross: boolean;
}
interface Line {
  items: Item[];
  main: number;
  cross: number;
}
/** Bounded Flex with iterative constraint freezing and width-aware leaf measurement. */
export function layoutCanvas(
  root: CanvasNode,
  width: number,
  height: number,
  measure: MeasureText,
): { nodes: number; intrinsicVisits: number; constrainVisits: number } {
  finite(width);
  finite(height);
  let visited = 0,
    intrinsicVisits = 0,
    constrainVisits = 0;
  const naturalCache = new Map<CanvasNode, UISizeValue>();
  const natural = (node: CanvasNode, depth: number): UISizeValue => {
    intrinsicVisits++;
    if (depth > 64)
      throw new EngineError(
        "INVALID_UI",
        "UI trees support at most 64 nested levels",
      );
    const previous = naturalCache.get(node);
    if (previous) return previous;
    const s = node.style,
      pad = s.padding * 2;
    let w = 0,
      h = 0;
    if (node.kind !== "panel") {
      if (typeof s.width !== "number" || typeof s.height !== "number")
        ({ width: w, height: h } = measure(node));
    } else {
      const children = node.children.filter((n) => n.visible && !n.disposed),
        row = s.direction === "row";
      for (const c of children) {
        const n = natural(c, depth + 1),
          cw = n.width,
          ch = n.height;
        w = row ? w + cw : Math.max(w, cw);
        h = row ? Math.max(h, ch) : h + ch;
      }
      if (row) w += Math.max(0, children.length - 1) * s.gap;
      else h += Math.max(0, children.length - 1) * s.gap;
    }
    const result = {
      width: finite(typeof s.width === "number" ? s.width : w + pad),
      height: finite(typeof s.height === "number" ? s.height : h + pad),
    };
    for (const axis of ["Width", "Height"] as const) {
      const key = axis === "Width" ? "width" : "height";
      const min = s[`min${axis}`],
        max = s[`max${axis}`];
      if (min === undefined && max === undefined) continue;
      result[key] = clamp(result[key], {
        min: typeof min === "number" ? min : 0,
        max: Math.max(
          typeof min === "number" ? min : 0,
          typeof max === "number" ? max : Infinity,
        ),
      });
    }
    naturalCache.set(node, result);
    return result;
  };
  const constrainedCache = new Map<CanvasNode, Map<string, UISizeValue>>();
  // Auto cross size of a wrapped container depends on its constrained main size.
  const constrained = (
    node: CanvasNode,
    aw: number,
    ah: number,
    stretchWidth: boolean,
    stretchHeight: boolean,
    depth: number,
    forcedWidth?: number,
    forcedHeight?: number,
  ): UISizeValue => {
    constrainVisits++;
    if (depth > 64)
      throw new EngineError(
        "INVALID_UI",
        "UI trees support at most 64 nested levels",
      );
    const s = node.style,
      n = natural(node, depth),
      row = s.direction === "row";
    let w = forcedWidth ?? size(s.width, aw) ?? (stretchWidth ? aw : n.width),
      h = forcedHeight ?? size(s.height, ah) ?? (stretchHeight ? ah : n.height);
    if (
      node.kind !== "panel" &&
      s.textWrap &&
      s.width === undefined &&
      forcedWidth === undefined
    )
      w = Math.min(w, aw);
    w = clamp(w, limits(node, "Width", aw));
    h = clamp(h, limits(node, "Height", ah));
    if (node.kind !== "panel") {
      if (
        s.height === undefined &&
        !stretchHeight &&
        forcedHeight === undefined
      )
        h = clamp(
          measure(node, Math.max(0, w - s.padding * 2)).height + s.padding * 2,
          limits(node, "Height", ah),
        );
      return { width: w, height: h };
    }
    const key = `${aw},${ah},${stretchWidth},${stretchHeight},${forcedWidth},${forcedHeight}`;
    let cache = constrainedCache.get(node);
    const cached = cache?.get(key);
    if (cached) return cached;
    if (!cache) {
      cache = new Map();
      constrainedCache.set(node, cache);
    }
    const saved = (value: UISizeValue) => {
      cache?.set(key, value);
      return value;
    };
    const lines = linesFor(
      node,
      Math.max(0, w - s.padding * 2),
      Math.max(0, h - s.padding * 2),
      depth,
    );
    const totalCross =
      lines.reduce((sum, line) => sum + line.cross, 0) +
      s.gap * Math.max(0, lines.length - 1);
    const totalMain = Math.max(
      0,
      ...lines.map(
        (line) =>
          line.items.reduce((sum, i) => sum + i.main, 0) +
          s.gap * Math.max(0, line.items.length - 1),
      ),
    );
    if (
      row &&
      s.height === undefined &&
      !stretchHeight &&
      forcedHeight === undefined
    )
      h = totalCross + s.padding * 2;
    if (
      !row &&
      s.width === undefined &&
      !stretchWidth &&
      forcedWidth === undefined
    )
      w = totalCross + s.padding * 2;
    if (
      !row &&
      !s.wrap &&
      s.height === undefined &&
      !stretchHeight &&
      forcedHeight === undefined
    )
      h = totalMain + s.padding * 2;
    return saved({
      width: clamp(w, limits(node, "Width", aw)),
      height: clamp(h, limits(node, "Height", ah)),
    });
  };
  const linesFor = (
    node: CanvasNode,
    cw: number,
    ch: number,
    depth: number,
  ): Line[] => {
    const s = node.style,
      row = s.direction === "row",
      main = row ? cw : ch;
    const lines: Line[] = [{ items: [], main: 0, cross: 0 }];
    for (const child of node.children) {
      if (!child.visible || child.disposed) continue;
      const align = child.style.alignSelf ?? s.align;
      const n = constrained(
          child,
          cw,
          ch,
          !row && align === "stretch" && child.style.width === undefined,
          row &&
            !s.wrap &&
            align === "stretch" &&
            child.style.height === undefined,
          depth + 1,
        ),
        a = n.width,
        b = n.height;
      const range = limits(child, row ? "Width" : "Height", main);
      const item: Item = {
        ...range,
        node: child,
        main: row ? a : b,
        cross: row ? b : a,
        explicitCross:
          (row ? child.style.height : child.style.width) !== undefined,
      };
      let line = lines[lines.length - 1] as Line;
      if (s.wrap && line.items.length && line.main + s.gap + item.main > main) {
        line = { items: [], main: 0, cross: 0 };
        lines.push(line);
      }
      if (line.items.length) line.main += s.gap;
      line.items.push(item);
      line.main += item.main;
      line.cross = Math.max(line.cross, item.cross);
    }

    for (const line of lines) {
      // Freeze min/max-limited items and redistribute remaining free space.
      const growing = main >= line.main;
      let remaining = line.items.filter((i) =>
        growing
          ? i.node.style.grow > 0 && i.main < i.max
          : i.node.style.shrink > 0 && i.main > i.min,
      );
      const bases =
        !growing && remaining.length
          ? new Map(line.items.map((i) => [i, i.main]))
          : undefined;
      while (remaining.length) {
        const free =
          main -
          line.items.reduce((sum, i) => sum + i.main, 0) -
          s.gap * Math.max(0, line.items.length - 1);
        if (Math.abs(free) < 1e-9 || (growing ? free < 0 : free > 0)) break;
        const weightOf = (i: Item) =>
          growing
            ? i.node.style.grow
            : i.node.style.shrink * (bases?.get(i) ?? 0);
        const weight = remaining.reduce((sum, i) => sum + weightOf(i), 0);
        if (weight === 0) break;
        let changed = 0;
        for (const i of remaining) {
          const previous = i.main;
          i.main = clamp(previous + (free * weightOf(i)) / weight, i);
          changed += Math.abs(i.main - previous);
        }
        remaining = remaining.filter((i) =>
          growing ? i.main < i.max - 1e-9 : i.main > i.min + 1e-9,
        );
        if (changed < 1e-9) break;
      }
      // Wrapped descendants remeasure their auto cross extent after flex main allocation.
      for (const i of line.items)
        if (!i.explicitCross) {
          const measured = constrained(
            i.node,
            cw,
            ch,
            false,
            false,
            depth + 1,
            row ? i.main : undefined,
            row ? undefined : i.main,
          );
          i.cross = row ? measured.height : measured.width;
        }
      line.cross = line.items.reduce((v, i) => Math.max(v, i.cross), 0);
    }
    return lines;
  };
  const arrange = (
    node: CanvasNode,
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
  ) => {
    if (depth > 64)
      throw new EngineError(
        "INVALID_UI",
        "UI trees support at most 64 nested levels",
      );
    visited++;
    const s = node.style;
    node.boundsValue = Object.freeze({
      x: finite(x),
      y: finite(y),
      width: finite(w),
      height: finite(h),
    });
    if (node.kind !== "panel") return;
    const row = s.direction === "row",
      cw = Math.max(0, w - 2 * s.padding),
      ch = Math.max(0, h - 2 * s.padding),
      main = row ? cw : ch,
      cross = row ? ch : cw;
    const lines = linesFor(node, cw, ch, depth);
    if (!s.wrap) (lines[0] as Line).cross = cross;
    let lineOffset = 0;
    for (const line of lines) {
      const left = Math.max(
        0,
        main -
          line.items.reduce((sum, i) => sum + i.main, 0) -
          s.gap * Math.max(0, line.items.length - 1),
      );
      let gap = s.gap,
        offset = 0;
      if (s.justify === "end") offset = left;
      if (s.justify === "center") offset = left / 2;
      if (s.justify === "space-between" && line.items.length > 1)
        gap += left / (line.items.length - 1);
      if (s.justify === "space-around" && line.items.length) {
        gap += left / line.items.length;
        offset = left / line.items.length / 2;
      }
      for (const i of line.items) {
        const align = i.node.style.alignSelf ?? s.align;
        if (!i.explicitCross && align === "stretch")
          i.cross = clamp(
            line.cross,
            limits(i.node, row ? "Height" : "Width", cross),
          );
        let c =
          align === "end"
            ? line.cross - i.cross
            : align === "center"
              ? (line.cross - i.cross) / 2
              : 0;
        c = Math.max(0, c);
        arrange(
          i.node,
          x + s.padding + (row ? offset : lineOffset + c),
          y + s.padding + (row ? lineOffset + c : offset),
          row ? i.main : i.cross,
          row ? i.cross : i.main,
          depth + 1,
        );
        offset += i.main + gap;
      }
      lineOffset += line.cross + s.gap;
    }
  };
  natural(root, 0);
  arrange(
    root,
    0,
    0,
    clamp(size(root.style.width, width) ?? width, limits(root, "Width", width)),
    clamp(
      size(root.style.height, height) ?? height,
      limits(root, "Height", height),
    ),
    0,
  );
  return { nodes: visited, intrinsicVisits, constrainVisits };
}
export function containsUI(box: UIBounds, x: number, y: number): boolean {
  return (
    x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height
  );
}
export function intersectUI(a: UIBounds, b: UIBounds): UIBounds {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
