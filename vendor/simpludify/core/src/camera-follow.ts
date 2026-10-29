import type { Camera, LogicalResolution, Point } from "./coordinates";
import { EngineError, positive } from "./diagnostics";

function clampCenter(
  value: number,
  origin: number,
  size: number,
  half: number,
): number {
  return size <= 2 * half
    ? origin + size / 2
    : Math.max(origin + half, Math.min(origin + size - half, value));
}
export interface WorldBounds extends Point, LogicalResolution {}
export interface CameraFollowOptions {
  resolution?: LogicalResolution;
  bounds?: WorldBounds;
  /** Exponential response per simulation second. Zero snaps immediately. */
  responsiveness?: number;
}
/** World-space tracking, called after movement/response; independent of host pixels and DOM. */
export class CameraFollow {
  private readonly width: number;
  private readonly height: number;
  private readonly bounds: WorldBounds | undefined;
  private readonly responsiveness: number;
  constructor(
    readonly camera: Camera,
    options: CameraFollowOptions = {},
  ) {
    this.width = positive(options.resolution?.width ?? 800, "resolution.width");
    this.height = positive(
      options.resolution?.height ?? 450,
      "resolution.height",
    );
    this.responsiveness = options.responsiveness ?? 0;
    if (!Number.isFinite(this.responsiveness) || this.responsiveness < 0)
      throw new EngineError(
        "INVALID_VALUE",
        "Camera responsiveness must be finite and nonnegative",
      );
    if (options.bounds) {
      const b = options.bounds;
      positive(b.width, "bounds.width");
      positive(b.height, "bounds.height");
      if (
        !Number.isFinite(b.x) ||
        !Number.isFinite(b.y) ||
        !Number.isFinite(b.x + b.width) ||
        !Number.isFinite(b.y + b.height)
      )
        throw new EngineError("INVALID_VALUE", "Camera bounds must be finite");
      this.bounds = { ...b };
    }
  }
  update(target: Point, seconds: number): void {
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(seconds) ||
      seconds < 0
    )
      throw new EngineError(
        "INVALID_VALUE",
        "Camera target/time must be finite; time must be nonnegative",
      );
    const b = this.bounds,
      hx = this.width / this.camera.zoom / 2,
      hy = this.height / this.camera.zoom / 2;
    const x = b ? clampCenter(target.x, b.x, b.width, hx) : target.x,
      y = b ? clampCenter(target.y, b.y, b.height, hy) : target.y;
    const alpha =
      this.responsiveness === 0
        ? 1
        : -Math.expm1(-this.responsiveness * seconds);
    let cx = this.camera.x + this.width / 2,
      cy = this.camera.y + this.height / 2;
    cx += (x - cx) * alpha;
    cy += (y - cy) * alpha;
    if (b) {
      cx = clampCenter(cx, b.x, b.width, hx);
      cy = clampCenter(cy, b.y, b.height, hy);
    }
    const left = cx - this.width / 2,
      top = cy - this.height / 2;
    if (!Number.isFinite(left) || !Number.isFinite(top))
      throw new EngineError("INVALID_VALUE", "Camera tracking overflowed");
    this.camera.x = left;
    this.camera.y = top;
  }
}
