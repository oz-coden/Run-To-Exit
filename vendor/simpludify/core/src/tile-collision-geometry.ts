import { CollisionShape } from "./collider";
import {
  contactManifold,
  type Geometry,
  type Manifold,
  type ManifoldEntry,
} from "./collision-geometry";
import { samePolicy } from "./collision-policy";
import type { Tilemap } from "./tilemap";
import type { ResolvedTileCollision } from "./tilemap-collision";

export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Closed, tolerance-expanded contact bounds; intentionally not worldToTile's point contract. */
export function tileRange(
  map: Tilemap<string>,
  g: Geometry,
  tolerance: number,
  out: TileRange,
): boolean {
  out.x0 = Math.max(
    0,
    Math.ceil((g.minX - map.x - tolerance) / map.tileWidth) - 1,
  );
  out.y0 = Math.max(
    0,
    Math.ceil((g.minY - map.y - tolerance) / map.tileHeight) - 1,
  );
  out.x1 = Math.min(
    map.width - 1,
    Math.floor((g.maxX - map.x + tolerance) / map.tileWidth),
  );
  out.y1 = Math.min(
    map.height - 1,
    Math.floor((g.maxY - map.y + tolerance) / map.tileHeight),
  );
  return out.x0 <= out.x1 && out.y0 <= out.y1;
}
export function tileGeometry(
  map: Tilemap<string>,
  x: number,
  y: number,
  g: Geometry,
): void {
  g.minX = map.x + x * map.tileWidth;
  g.maxX = map.x + (x + 1) * map.tileWidth;
  g.minY = map.y + y * map.tileHeight;
  g.maxY = map.y + (y + 1) * map.tileHeight;
  g.x = g.minX + map.tileWidth / 2;
  g.y = g.minY + map.tileHeight / 2;
  g.hx = map.tileWidth / 2;
  g.hy = map.tileHeight / 2;
  g.radius = 0;
  g.cos = 1;
  g.sin = 0;
}
export const TileFace = {
  Left: 1,
  Right: 2,
  Top: 4,
  Bottom: 8,
  All: 15,
} as const;
/** Only equal full policies share topology. No merge/index/cache or renderer dependency. */
export function exposedFaces(
  map: Tilemap<string>,
  x: number,
  y: number,
  policy: ResolvedTileCollision,
): number {
  const equal = (nx: number, ny: number) =>
    map.inBounds(nx, ny) && samePolicy(policy, map.getCollision(nx, ny));
  return (
    (equal(x - 1, y) ? 0 : TileFace.Left) |
    (equal(x + 1, y) ? 0 : TileFace.Right) |
    (equal(x, y - 1) ? 0 : TileFace.Top) |
    (equal(x, y + 1) ? 0 : TileFace.Bottom)
  );
}
/** Does a finite boundary segment intersect the OBB? Slabs in Actor-local coordinates. */
function segmentBox(
  g: Geometry,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tolerance: number,
): boolean {
  const ax = (x0 - g.x) * g.cos + (y0 - g.y) * g.sin;
  const ay = -(x0 - g.x) * g.sin + (y0 - g.y) * g.cos;
  const bx = (x1 - g.x) * g.cos + (y1 - g.y) * g.sin;
  const by = -(x1 - g.x) * g.sin + (y1 - g.y) * g.cos;
  let low = 0,
    high = 1;
  for (const [p, d, half] of [
    [ax, bx - ax, g.hx],
    [ay, by - ay, g.hy],
  ]) {
    if (p === undefined || d === undefined || half === undefined) return false;
    if (Math.abs(d) < 1e-15) {
      if (Math.abs(p) > half + tolerance) return false;
    } else {
      const a = (-half - tolerance - p) / d,
        b = (half + tolerance - p) / d;
      low = Math.max(low, Math.min(a, b));
      high = Math.min(high, Math.max(a, b));
      if (low > high) return false;
    }
  }
  return true;
}
/**
 * Keep the exact circle/OBB manifold at exposed faces and convex corners.
 * A manifold using an internal face/vertex is replaced only by a real exposed
 * face intersection. Its axis is geometric, not a rounded arbitrary normal.
 */
export function tileResponseManifold(
  a: ManifoldEntry,
  b: ManifoldEntry,
  faces: number,
  out: Manifold,
  tolerance: number,
): boolean {
  if (!contactManifold(a, b, out, tolerance)) return false;
  if (faces === TileFace.All) return true;
  const nx = out.normalX,
    ny = out.normalY;
  const xFace =
    Math.abs(nx) <= 1e-10 ? 0 : nx > 0 ? TileFace.Left : TileFace.Right;
  const yFace =
    Math.abs(ny) <= 1e-10 ? 0 : ny > 0 ? TileFace.Top : TileFace.Bottom;
  if ((!xFace || faces & xFace) && (!yFace || faces & yFace)) return true;
  const g = a.geometry,
    tile = b.geometry;
  const inside =
    g.x >= tile.minX &&
    g.x <= tile.maxX &&
    g.y >= tile.minY &&
    g.y <= tile.maxY;
  let best = Infinity,
    bestX = 0,
    bestY = 0;
  const face = (
    flag: number,
    depth: number,
    x: number,
    y: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => {
    if (!(faces & flag) || depth < -tolerance || depth >= best) return;
    const intersects =
      a.collider.shape === CollisionShape.Circle
        ? x !== 0
          ? g.y >= y0 - tolerance && g.y <= y1 + tolerance
          : g.x >= x0 - tolerance && g.x <= x1 + tolerance
        : segmentBox(g, x0, y0, x1, y1, tolerance);
    if (!inside && !intersects) return;
    best = Math.max(0, depth);
    bestX = x;
    bestY = y;
  };
  face(
    TileFace.Left,
    g.maxX - tile.minX,
    1,
    0,
    tile.minX,
    tile.minY,
    tile.minX,
    tile.maxY,
  );
  face(
    TileFace.Right,
    tile.maxX - g.minX,
    -1,
    0,
    tile.maxX,
    tile.minY,
    tile.maxX,
    tile.maxY,
  );
  face(
    TileFace.Top,
    g.maxY - tile.minY,
    0,
    1,
    tile.minX,
    tile.minY,
    tile.maxX,
    tile.minY,
  );
  face(
    TileFace.Bottom,
    tile.maxY - g.minY,
    0,
    -1,
    tile.minX,
    tile.maxY,
    tile.maxX,
    tile.maxY,
  );
  if (!Number.isFinite(best)) return false;
  out.normalX = bestX;
  out.normalY = bestY;
  out.depth = best;
  return true;
}
