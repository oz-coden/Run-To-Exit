import type { ActionReader } from "./actions";
import {
  Component,
  ComponentPhase,
  type ComponentType,
  defineComponent,
  type UpdateContext,
} from "./component";
import { EngineError, positive } from "./diagnostics";
import { type SpriteFrame, spriteFrame } from "./sprite-sheet";

function finite(value: number, field: string): number {
  if (!Number.isFinite(value))
    throw new EngineError("INVALID_VALUE", `${field} must be finite`, {
      field,
    });
  return value;
}
export class Transform extends Component {
  static readonly type: ComponentType<Transform> =
    defineComponent<Transform>("Transform");
  readonly type: ComponentType<Transform> = Transform.type;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  constructor(
    options: {
      x?: number;
      y?: number;
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
    } = {},
  ) {
    super();
    this.x = finite(options.x ?? 0, "x");
    this.y = finite(options.y ?? 0, "y");
    this.rotation = finite(options.rotation ?? 0, "rotation");
    this.scaleX = finite(options.scaleX ?? 1, "scaleX");
    this.scaleY = finite(options.scaleY ?? 1, "scaleY");
  }
}
export const Shape = {
  Box: "box",
  Character: "character",
  Circle: "circle",
  Triangle: "triangle",
} as const;
export const SpriteFit = { Contain: "contain", Stretch: "stretch" } as const;
export type SpriteFit = (typeof SpriteFit)[keyof typeof SpriteFit];
export function imageSize(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: SpriteFit = SpriteFit.Contain,
) {
  positive(sourceWidth, "sourceWidth");
  positive(sourceHeight, "sourceHeight");
  positive(width, "width");
  positive(height, "height");
  if (fit === SpriteFit.Stretch) return { width, height };
  if (fit !== SpriteFit.Contain)
    throw new EngineError("INVALID_VALUE", "Unknown sprite fit");
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}
export type Shape = (typeof Shape)[keyof typeof Shape];
/** Immutable, backend-independent description. Image fit defaults to Contain. */
export type VisualSource =
  | Readonly<{ kind: "shape"; shape: Shape }>
  | Readonly<{
      kind: "image";
      url: string;
      fit?: SpriteFit;
      frame?: SpriteFrame;
    }>;

function visualSource(value: VisualSource): VisualSource {
  if (!value || typeof value !== "object")
    throw new EngineError(
      "INVALID_VALUE",
      "source must be a visual description",
    );
  if (value.kind === "shape") {
    if (
      !Object.values(Shape).includes(value.shape) ||
      "url" in value ||
      "fit" in value ||
      "frame" in value
    )
      throw new EngineError("INVALID_VALUE", "Invalid shape source");
    return Object.freeze({ kind: "shape", shape: value.shape });
  }
  if (value.kind === "image") {
    if (typeof value.url !== "string" || !value.url.trim() || "shape" in value)
      throw new EngineError(
        "INVALID_VALUE",
        "Image source requires a nonempty URL",
      );
    const fit = value.fit === undefined ? SpriteFit.Contain : value.fit;
    if (!Object.values(SpriteFit).includes(fit))
      throw new EngineError("INVALID_VALUE", "Unknown sprite fit");
    return Object.freeze({
      kind: "image",
      url: value.url,
      fit,
      ...(value.frame === undefined ? {} : { frame: spriteFrame(value.frame) }),
    });
  }
  throw new EngineError("INVALID_VALUE", "Unknown visual source kind");
}
function equalFrame(
  a: SpriteFrame | undefined,
  b: SpriteFrame | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === "rect"
    ? b.kind === "rect" &&
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height
    : b.kind === "grid" &&
        a.index === b.index &&
        a.frameWidth === b.frameWidth &&
        a.frameHeight === b.frameHeight;
}
function equalSource(a: VisualSource, b: VisualSource): boolean {
  return a.kind === "shape"
    ? b.kind === "shape" && a.shape === b.shape
    : b.kind === "image" &&
        a.url === b.url &&
        a.fit === b.fit &&
        equalFrame(a.frame, b.frame);
}
const defaultVisualSource: VisualSource = Object.freeze({
  kind: "shape",
  shape: Shape.Box,
});
export interface RenderableOptions {
  width?: number;
  height?: number;
  color?: number;
  source?: VisualSource;
  opacity?: number;
  visible?: boolean;
  zIndex?: number;
}
export class Renderable extends Component {
  static readonly type: ComponentType<Renderable> = defineComponent<Renderable>(
    "Renderable",
    [Transform.type],
  );
  readonly type: ComponentType<Renderable> = Renderable.type;
  private version = 0;
  private horizontal = 32;
  private vertical = 32;
  private rgb = 0x73e3c0;
  private visual: VisualSource = defaultVisualSource;
  private shown = true;
  private alpha = 1;
  private depth = 0;
  /** Changes only when a validated display value changes; independent of Scene revision. */
  get revision(): number {
    return this.version;
  }
  get width(): number {
    return this.horizontal;
  }
  set width(value: number) {
    positive(value, "width");
    if (this.horizontal !== value) {
      this.horizontal = value;
      this.version++;
    }
  }
  get height(): number {
    return this.vertical;
  }
  set height(value: number) {
    positive(value, "height");
    if (this.vertical !== value) {
      this.vertical = value;
      this.version++;
    }
  }
  get color(): number {
    return this.rgb;
  }
  set color(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff)
      throw new EngineError(
        "INVALID_VALUE",
        "color must be a 24-bit RGB integer",
      );
    if (this.rgb !== value) {
      this.rgb = value;
      this.version++;
    }
  }
  get source(): VisualSource {
    return this.visual;
  }
  set source(value: VisualSource) {
    if (value === this.visual) return;
    const next = visualSource(value);
    if (!equalSource(this.visual, next)) {
      this.visual = next;
      this.version++;
    }
  }
  get visible(): boolean {
    return this.shown;
  }
  set visible(value: boolean) {
    if (typeof value !== "boolean")
      throw new EngineError("INVALID_VALUE", "visible must be boolean");
    if (this.shown !== value) {
      this.shown = value;
      this.version++;
    }
  }
  get opacity(): number {
    return this.alpha;
  }
  set opacity(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new EngineError("INVALID_VALUE", "opacity must be between 0 and 1");
    if (this.alpha !== value) {
      this.alpha = value;
      this.version++;
    }
  }
  get zIndex(): number {
    return this.depth;
  }
  set zIndex(value: number) {
    finite(value, "zIndex");
    if (this.depth !== value) {
      this.depth = value;
      this.version++;
    }
  }
  constructor(options: RenderableOptions = {}) {
    super();
    if (options.source !== undefined) this.source = options.source;
    this.width = options.width === undefined ? 32 : options.width;
    this.height = options.height === undefined ? 32 : options.height;
    // Source chooses the initial default only. Later source changes retain color.
    this.color =
      options.color === undefined
        ? this.source.kind === "image"
          ? 0xffffff
          : 0x73e3c0
        : options.color;
    this.opacity = options.opacity === undefined ? 1 : options.opacity;
    this.zIndex = options.zIndex === undefined ? 0 : options.zIndex;
    this.visible = options.visible === undefined ? true : options.visible;
    this.version = 0;
  }
}
/** Integrates an input-independent direction × speed after command-producing Components. */
export class Motion extends Component {
  static readonly type: ComponentType<Motion> = defineComponent<Motion>(
    "Motion",
    [Transform.type],
  );
  readonly type: ComponentType<Motion> = Motion.type;
  readonly phase: ComponentPhase = ComponentPhase.Integrate;
  private readonly vector = { x: 0, y: 0 };
  get direction(): { x: number; y: number } {
    return this.vector;
  }
  private rate = 180;
  private transform: Transform | undefined;
  get speed(): number {
    return this.rate;
  }
  set speed(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new EngineError(
        "INVALID_VALUE",
        "Motion.speed must be finite and nonnegative",
      );
    this.rate = value;
  }
  constructor(options: { speed?: number; x?: number; y?: number } = {}) {
    super();
    this.speed = options.speed ?? 180;
    this.vector.x = finite(options.x ?? 0, "Motion.direction.x");
    this.vector.y = finite(options.y ?? 0, "Motion.direction.y");
  }
  protected onAttach(): void {
    this.transform = this.actor.require(Transform.type);
  }
  update(context: UpdateContext): void {
    if (!this.transform) return;
    const dx = finite(this.vector.x, "Motion.direction.x"),
      dy = finite(this.vector.y, "Motion.direction.y");
    const x = finite(
        this.transform.x + dx * this.rate * context.delta,
        "Motion result x",
      ),
      y = finite(
        this.transform.y + dy * this.rate * context.delta,
        "Motion result y",
      );
    this.transform.x = x;
    this.transform.y = y;
  }
  protected onDestroy(): void {
    this.transform = undefined;
  }
}
/** Optional Action-to-Motion adapter. Custom Update Components can replace it entirely. */
export class ActionMovement extends Component {
  static readonly type: ComponentType<ActionMovement> =
    defineComponent<ActionMovement>("ActionMovement", [Motion.type]);
  readonly type = ActionMovement.type;
  readonly phase: ComponentPhase = ComponentPhase.Update;
  private motion: Motion | undefined;
  private factor = 1;
  get scale(): number {
    return this.factor;
  }
  set scale(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new EngineError(
        "INVALID_VALUE",
        "ActionMovement.scale must be finite and nonnegative",
      );
    this.factor = value;
  }
  constructor(
    readonly input: ActionReader<"axis2d">,
    options: { scale?: number } = {},
  ) {
    super();
    this.scale = options.scale ?? 1;
  }
  protected onAttach(): void {
    this.motion = this.actor.require(Motion.type);
  }
  protected onDisable(): void {
    if (this.motion) {
      this.motion.direction.x = 0;
      this.motion.direction.y = 0;
    }
  }
  update(context: UpdateContext): void {
    if (this.input.scene !== context.scene)
      throw new EngineError(
        "INPUT_SCENE",
        "Movement Action belongs to another Scene",
      );
    if (this.input.disposed) {
      this.onDisable();
      return;
    }
    const value = this.input.value();
    if (this.motion) {
      this.motion.direction.x = value.x * this.factor;
      this.motion.direction.y = value.y * this.factor;
    }
  }
  protected onDestroy(): void {
    this.onDisable();
    this.motion = undefined;
  }
}
