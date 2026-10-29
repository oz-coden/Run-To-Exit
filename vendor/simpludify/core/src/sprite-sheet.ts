import { EngineError } from "./diagnostics";

export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** Image pixels, origin at top left, x right and y down. */
export type SpriteFrame =
  | Readonly<{ kind: "rect" } & SpriteRect>
  | Readonly<{
      kind: "grid";
      index: number;
      frameWidth: number;
      frameHeight: number;
    }>;
export interface SpriteImage {
  readonly kind: "image";
  readonly url: string;
  readonly frame: SpriteFrame;
}
function integer(value: number, minimum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new EngineError(
      "SPRITE_FRAME_INVALID",
      `${field} must be a safe integer >= ${minimum}`,
    );
  return value;
}
/** @internal Copies and validates public frame descriptions. */
export function spriteFrame(value: SpriteFrame): SpriteFrame {
  if (!value || typeof value !== "object")
    throw new EngineError(
      "SPRITE_FRAME_INVALID",
      "Expected a frame description",
    );
  if (value.kind === "rect")
    return Object.freeze({
      kind: "rect",
      x: integer(value.x, 0, "x"),
      y: integer(value.y, 0, "y"),
      width: integer(value.width, 1, "width"),
      height: integer(value.height, 1, "height"),
    });
  if (value.kind === "grid")
    return Object.freeze({
      kind: "grid",
      index: integer(value.index, 0, "index"),
      frameWidth: integer(value.frameWidth, 1, "frameWidth"),
      frameHeight: integer(value.frameHeight, 1, "frameHeight"),
    });
  throw new EngineError("SPRITE_FRAME_INVALID", "Unknown frame kind");
}
/** Resolves a frame against decoded image dimensions; rejects partial grid cells. */
export function spriteFrameBounds(
  frame: SpriteFrame,
  width: number,
  height: number,
): SpriteRect {
  integer(width, 1, "image width");
  integer(height, 1, "image height");
  const f = spriteFrame(frame);
  let rect: SpriteRect;
  if (f.kind === "grid") {
    const columns = width / f.frameWidth,
      rows = height / f.frameHeight;
    if (
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      f.index >= columns * rows
    )
      throw new EngineError(
        "SPRITE_FRAME_BOUNDS",
        "Grid must divide the image exactly and contain the frame",
      );
    rect = {
      x: (f.index % columns) * f.frameWidth,
      y: Math.floor(f.index / columns) * f.frameHeight,
      width: f.frameWidth,
      height: f.frameHeight,
    };
  } else rect = f;
  if (rect.width > width - rect.x || rect.height > height - rect.y)
    throw new EngineError(
      "SPRITE_FRAME_BOUNDS",
      "Frame extends outside the image",
    );
  return rect;
}

/** Immutable metadata only: no load, GPU ownership or manual dispose required. */
export class SpriteSheet<Name extends string = never> {
  private readonly cache = new Map<number, SpriteImage>();
  private constructor(
    readonly url: string,
    private readonly makeFrame: (index: number) => SpriteFrame,
    private readonly names: ReadonlyMap<string, number>,
    readonly count: number | undefined,
  ) {
    if (typeof url !== "string" || !url.trim())
      throw new EngineError(
        "SPRITE_FRAME_INVALID",
        "SpriteSheet requires a nonempty URL",
      );
    Object.freeze(this);
  }
  static grid<
    const Names extends Record<string, number> = Record<never, never>,
  >(
    url: string,
    options: { frameWidth: number; frameHeight: number; names?: Names },
  ): SpriteSheet<Extract<keyof Names, string>> {
    const width = integer(options.frameWidth, 1, "frameWidth"),
      height = integer(options.frameHeight, 1, "frameHeight");
    const names = new Map(Object.entries(options.names ?? {}));
    for (const [name, index] of names) {
      if (!name)
        throw new EngineError(
          "SPRITE_FRAME_INVALID",
          "Frame name cannot be empty",
        );
      integer(index, 0, "named frame index");
    }
    return new SpriteSheet(
      url,
      (index) =>
        Object.freeze({
          kind: "grid",
          index,
          frameWidth: width,
          frameHeight: height,
        }),
      names,
      undefined,
    );
  }
  static rects<const Frames extends Record<string, SpriteRect>>(
    url: string,
    frames: Frames,
  ): SpriteSheet<Extract<keyof Frames, string>>;
  static rects(url: string, frames: readonly SpriteRect[]): SpriteSheet;
  static rects(
    url: string,
    frames: Readonly<Record<string, SpriteRect>> | readonly SpriteRect[],
  ): SpriteSheet<string> {
    const entries = Array.isArray(frames)
      ? Array.from(
          frames,
          (rect: SpriteRect, index) => [String(index), rect] as const,
        )
      : Object.entries(frames);
    if (!entries.length || entries.some(([name]) => !name))
      throw new EngineError(
        "SPRITE_FRAME_INVALID",
        "SpriteSheet requires nonempty frame definitions",
      );
    const rects = entries.map(([, rect]) =>
      spriteFrame({ ...rect, kind: "rect" }),
    );
    const names = new Map(entries.map(([name], index) => [name, index]));
    return new SpriteSheet(
      url,
      (index) => {
        const rect = rects[index];
        if (!rect)
          throw new EngineError("SPRITE_FRAME_BOUNDS", "Unknown frame index");
        return rect;
      },
      names,
      rects.length,
    );
  }
  get(key: number | Name): SpriteImage {
    const index = typeof key === "number" ? key : this.names.get(key);
    if (index === undefined)
      throw new EngineError("SPRITE_FRAME_BOUNDS", "Unknown frame name", {
        frame: key,
      });
    integer(index, 0, "index");
    let image = this.cache.get(index);
    if (!image) {
      image = Object.freeze({
        kind: "image",
        url: this.url,
        frame: this.makeFrame(index),
      });
      this.cache.set(index, image);
    }
    return image;
  }
}
