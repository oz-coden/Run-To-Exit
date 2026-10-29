import { EngineError, positive } from "./diagnostics";
export const Aspect = {
  Fit: "fit",
  Fill: "fill",
  Adaptive: "adaptive",
} as const;
export type Aspect = (typeof Aspect)[keyof typeof Aspect];
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface WorldPoint extends Point {
  readonly space: "world";
}
export interface ScreenPoint extends Point {
  readonly space: "screen";
}
export interface PhysicalPoint extends Point {
  readonly space: "physical";
}
export interface LogicalResolution {
  readonly width: number;
  readonly height: number;
}
export interface Viewport extends LogicalResolution {
  readonly x: number;
  readonly y: number;
}
function finite(value: number, field: string): number {
  if (!Number.isFinite(value))
    throw new EngineError("INVALID_VALUE", `${field} must be finite`, {
      field,
    });
  return value;
}
export function worldPoint(x: number, y: number): WorldPoint {
  return { space: "world", x: finite(x, "x"), y: finite(y, "y") };
}
export function screenPoint(x: number, y: number): ScreenPoint {
  return { space: "screen", x: finite(x, "x"), y: finite(y, "y") };
}
/** Position is the nominal visible world's top-left; zoom is centered on that extent. */
export class Camera {
  private left: number;
  private top: number;
  private magnification: number;
  constructor(options: { x?: number; y?: number; zoom?: number } = {}) {
    this.left = finite(options.x ?? 0, "camera.x");
    this.top = finite(options.y ?? 0, "camera.y");
    this.magnification = positive(options.zoom ?? 1, "camera.zoom");
  }
  get x(): number {
    return this.left;
  }
  set x(value: number) {
    this.left = finite(value, "camera.x");
  }
  get y(): number {
    return this.top;
  }
  set y(value: number) {
    this.top = finite(value, "camera.y");
  }
  get zoom(): number {
    return this.magnification;
  }
  set zoom(value: number) {
    this.magnification = positive(value, "camera.zoom");
  }
}
export interface ViewTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly viewport: Viewport;
  readonly clip: Viewport;
}
export function createViewTransform(options: {
  viewport: Viewport;
  resolution?: LogicalResolution;
  camera?: Readonly<Pick<Camera, "x" | "y" | "zoom">>;
  aspect?: Aspect;
}): ViewTransform {
  const { viewport } = options,
    aspect = options.aspect ?? Aspect.Fit,
    resolution = options.resolution ?? { width: 800, height: 450 };
  positive(viewport.width, "viewport.width");
  positive(viewport.height, "viewport.height");
  finite(viewport.x, "viewport.x");
  finite(viewport.y, "viewport.y");
  positive(resolution.width, "resolution.width");
  positive(resolution.height, "resolution.height");
  if (!Object.values(Aspect).includes(aspect))
    throw new EngineError("INVALID_ASPECT", "Unknown aspect policy");
  const logicalWidth =
      aspect === Aspect.Adaptive ? viewport.width : resolution.width,
    logicalHeight =
      aspect === Aspect.Adaptive ? viewport.height : resolution.height;
  const base =
    aspect === Aspect.Adaptive
      ? 1
      : (aspect === Aspect.Fit ? Math.min : Math.max)(
          viewport.width / logicalWidth,
          viewport.height / logicalHeight,
        );
  const camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
  finite(camera.x, "camera.x");
  finite(camera.y, "camera.y");
  const scale = base * positive(camera.zoom, "camera.zoom");
  const clip =
    aspect === Aspect.Fit
      ? {
          x: viewport.x + (viewport.width - logicalWidth * base) / 2,
          y: viewport.y + (viewport.height - logicalHeight * base) / 2,
          width: logicalWidth * base,
          height: logicalHeight * base,
        }
      : { ...viewport };
  return {
    scale,
    x: viewport.x + viewport.width / 2 - (camera.x + logicalWidth / 2) * scale,
    y:
      viewport.y + viewport.height / 2 - (camera.y + logicalHeight / 2) * scale,
    logicalWidth,
    logicalHeight,
    viewport: { ...viewport },
    clip,
  };
}
export function worldToScreen(
  view: ViewTransform,
  point: WorldPoint,
): ScreenPoint {
  return screenPoint(
    point.x * view.scale + view.x,
    point.y * view.scale + view.y,
  );
}
export function screenToWorld(
  view: ViewTransform,
  point: ScreenPoint,
): WorldPoint {
  return worldPoint(
    (point.x - view.x) / view.scale,
    (point.y - view.y) / view.scale,
  );
}
export function screenToPhysical(
  point: ScreenPoint,
  devicePixelRatio: number,
): PhysicalPoint {
  const ratio = positive(devicePixelRatio, "devicePixelRatio");
  return { space: "physical", x: point.x * ratio, y: point.y * ratio };
}
export function containsScreenPoint(
  view: ViewTransform,
  point: ScreenPoint,
): boolean {
  const c = view.clip;
  return (
    point.x >= c.x &&
    point.y >= c.y &&
    point.x < c.x + c.width &&
    point.y < c.y + c.height
  );
}
