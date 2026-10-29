import type { Manifold } from "./collision-geometry";
import type { Transform } from "./components";
import { EngineError } from "./diagnostics";
/** Translate along the minimum separation axis, preserving tangential movement intent. */
export function correctPositions(
  a: Pick<Transform, "x" | "y">,
  b: Pick<Transform, "x" | "y">,
  contact: Manifold,
  ia: number,
  ib: number,
): boolean {
  const scale = Math.max(ia, ib);
  if (scale === 0 || contact.depth === 0) return false;
  const total = ia / scale + ib / scale,
    wa = ia / scale / total,
    wb = ib / scale / total;
  const dx = contact.normalX * contact.depth,
    dy = contact.normalY * contact.depth;
  const ax = a.x - dx * wa,
    ay = a.y - dy * wa,
    bx = b.x + dx * wb,
    by = b.y + dy * wb;
  if (
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by)
  )
    throw new EngineError("INVALID_VALUE", "Position correction overflowed");
  a.x = ax;
  a.y = ay;
  b.x = bx;
  b.y = by;
  return true;
}
