import type { Actor } from "./actor";
import { type Collider, CollisionShape } from "./collider";
import type { Transform } from "./components";
import { EngineError } from "./diagnostics";

function finite(value: number, name: string): void {
  if (!Number.isFinite(value))
    throw new EngineError("INVALID_VALUE", `${name} must be finite`);
}
export interface GeometryEntry {
  readonly actor: Actor;
  readonly collider: Collider;
  readonly transform: Transform;
  readonly geometry: Geometry;
}
/** Narrow phase needs shape data only, not Actor ownership or a Transform. */
export interface ManifoldEntry {
  readonly collider: Pick<Collider, "shape">;
  readonly geometry: Geometry;
}
export interface Manifold {
  normalX: number;
  normalY: number;
  depth: number;
}
export function createGeometry(): Geometry {
  return {
    x: 0,
    y: 0,
    hx: 0,
    hy: 0,
    radius: 0,
    cos: 1,
    sin: 0,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  };
}
export interface Geometry {
  x: number;
  y: number;
  hx: number;
  hy: number;
  radius: number;
  cos: number;
  sin: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export function updateGeometry(entry: GeometryEntry): boolean {
  const t = entry.transform,
    c = entry.collider,
    g = entry.geometry;
  finite(t.x, "transform.x");
  finite(t.y, "transform.y");
  finite(t.rotation, "transform.rotation");
  finite(t.scaleX, "transform.scaleX");
  finite(t.scaleY, "transform.scaleY");
  const sx = Math.abs(t.scaleX),
    sy = Math.abs(t.scaleY);
  if (sx === 0 || sy === 0) return false;
  if (
    c.shape === CollisionShape.Circle &&
    Math.abs(sx - sy) > 1e-9 * Math.max(sx, sy)
  )
    throw new EngineError(
      "COLLIDER_SCALE_UNSUPPORTED",
      "Circle colliders require uniform absolute scale",
      { actorId: entry.actor.id },
    );
  g.cos = Math.cos(t.rotation);
  g.sin = Math.sin(t.rotation);
  g.x = t.x + g.cos * c.offsetX * t.scaleX - g.sin * c.offsetY * t.scaleY;
  g.y = t.y + g.sin * c.offsetX * t.scaleX + g.cos * c.offsetY * t.scaleY;
  g.hx = (c.width * sx) / 2;
  g.hy = (c.height * sy) / 2;
  g.radius = c.radius * sx;
  const ex =
    c.shape === CollisionShape.Circle
      ? g.radius
      : Math.abs(g.cos) * g.hx + Math.abs(g.sin) * g.hy;
  const ey =
    c.shape === CollisionShape.Circle
      ? g.radius
      : Math.abs(g.sin) * g.hx + Math.abs(g.cos) * g.hy;
  g.minX = g.x - ex;
  g.maxX = g.x + ex;
  g.minY = g.y - ey;
  g.maxY = g.y + ey;
  if (
    !Number.isFinite(g.x) ||
    !Number.isFinite(g.y) ||
    !Number.isFinite(g.hx) ||
    !Number.isFinite(g.hy) ||
    !Number.isFinite(g.radius) ||
    !Number.isFinite(g.minX) ||
    !Number.isFinite(g.maxX) ||
    !Number.isFinite(g.minY) ||
    !Number.isFinite(g.maxY)
  )
    throw new EngineError(
      "INVALID_VALUE",
      "Collider world geometry must be finite",
    );
  return true;
}

function boxCircle(
  box: Geometry,
  circle: Geometry,
  out: Manifold,
  tolerance: number,
): boolean {
  const dx = circle.x - box.x,
    dy = circle.y - box.y;
  const x = dx * box.cos + dy * box.sin,
    y = -dx * box.sin + dy * box.cos;
  const cx = Math.max(-box.hx, Math.min(box.hx, x)),
    cy = Math.max(-box.hy, Math.min(box.hy, y));
  const ox = x - cx,
    oy = y - cy,
    distance = Math.hypot(ox, oy);
  let nx: number, ny: number;
  if (distance > 0) {
    if (distance > circle.radius + tolerance) return false;
    nx = ox / distance;
    ny = oy / distance;
    out.depth = Math.max(0, circle.radius - distance);
  } else if (box.hx - Math.abs(x) <= box.hy - Math.abs(y)) {
    nx = x >= 0 ? 1 : -1;
    ny = 0;
    out.depth = circle.radius + box.hx - Math.abs(x);
  } else {
    nx = 0;
    ny = y >= 0 ? 1 : -1;
    out.depth = circle.radius + box.hy - Math.abs(y);
  }
  out.normalX = nx * box.cos - ny * box.sin;
  out.normalY = nx * box.sin + ny * box.cos;
  return true;
}
function axis(
  a: Geometry,
  b: Geometry,
  x: number,
  y: number,
  out: Manifold,
  tolerance: number,
): boolean {
  const distance = (b.x - a.x) * x + (b.y - a.y) * y;
  const ar =
    a.hx * Math.abs(a.cos * x + a.sin * y) +
    a.hy * Math.abs(-a.sin * x + a.cos * y);
  const br =
    b.hx * Math.abs(b.cos * x + b.sin * y) +
    b.hy * Math.abs(-b.sin * x + b.cos * y);
  const depth = ar + br - Math.abs(distance);
  if (depth < -tolerance) return false;
  if (depth < out.depth) {
    out.depth = Math.max(0, depth);
    const sign = distance >= 0 ? 1 : -1;
    out.normalX = x * sign;
    out.normalY = y * sign;
  }
  return true;
}
/** Exact existing circle/OBB tests, extended to return a minimum translation normal. */
export function contactManifold(
  a: ManifoldEntry,
  b: ManifoldEntry,
  out: Manifold,
  tolerance = 0,
): boolean {
  const ag = a.geometry,
    bg = b.geometry;
  if (a.collider.shape === CollisionShape.Circle) {
    if (b.collider.shape === CollisionShape.Circle) {
      const dx = bg.x - ag.x,
        dy = bg.y - ag.y,
        distance = Math.hypot(dx, dy),
        r = ag.radius + bg.radius;
      if (distance > r + tolerance) return false;
      out.normalX = distance ? dx / distance : 1;
      out.normalY = distance ? dy / distance : 0;
      out.depth = Math.max(0, r - distance);
      return true;
    }
    const hit = boxCircle(bg, ag, out, tolerance);
    out.normalX = -out.normalX;
    out.normalY = -out.normalY;
    return hit;
  }
  if (b.collider.shape === CollisionShape.Circle)
    return boxCircle(ag, bg, out, tolerance);
  out.depth = Infinity;
  return (
    axis(ag, bg, ag.cos, ag.sin, out, tolerance) &&
    axis(ag, bg, -ag.sin, ag.cos, out, tolerance) &&
    axis(ag, bg, bg.cos, bg.sin, out, tolerance) &&
    axis(ag, bg, -bg.sin, bg.cos, out, tolerance)
  );
}
