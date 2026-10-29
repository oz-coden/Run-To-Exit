import {
  Component,
  ComponentPhase,
  type ComponentType,
  defineComponent,
  type UpdateContext,
} from "./component";
import { Renderable, type VisualSource } from "./components";
import { EngineError } from "./diagnostics";
import type { SpriteImage, SpriteSheet } from "./sprite-sheet";

/** Uniform frame timing in simulation seconds; default 8fps and loop=true. */
export type SpriteClip<FrameName extends string = never> = Readonly<
  {
    frames: readonly (number | FrameName)[];
    loop?: boolean;
  } & (
    | { fps?: number; frameSeconds?: never }
    | { fps?: never; frameSeconds: number }
  )
>;
export const SpriteAnimationState = {
  Playing: "playing",
  Paused: "paused",
  Stopped: "stopped",
  Completed: "completed",
} as const;
export type SpriteAnimationState =
  (typeof SpriteAnimationState)[keyof typeof SpriteAnimationState];
export interface SpriteAnimationOptions<
  Name extends string,
  FrameName extends string,
> {
  sheet: SpriteSheet<FrameName>;
  clips: Readonly<Record<Name, SpriteClip<NoInfer<FrameName>>>>;
  initial?: NoInfer<Name>;
  onComplete?: (name: NoInfer<Name>) => void;
}
interface CompiledClip {
  readonly images: readonly SpriteImage[];
  readonly frameSeconds: number;
  readonly duration: number;
  readonly loop: boolean;
}
/** One independent playback cursor per Actor. Requires an existing Renderable. */
export class SpriteAnimation<
  Name extends string = string,
  FrameName extends string = never,
> extends Component {
  static readonly type: ComponentType<SpriteAnimation> =
    defineComponent<SpriteAnimation>("SpriteAnimation", [Renderable.type]);
  readonly type = SpriteAnimation.type;
  readonly phase = ComponentPhase.LateUpdate;
  private readonly clips = new Map<Name, CompiledClip>();
  private readonly complete: ((name: Name) => void) | undefined;
  private selected: Name;
  private clip: CompiledClip;
  private status: SpriteAnimationState = SpriteAnimationState.Playing;
  private cursor = 0;
  private time = 0;
  private view: Renderable | undefined;
  private written: VisualSource | undefined;
  private image: SpriteImage | undefined;
  constructor(options: SpriteAnimationOptions<Name, FrameName>) {
    super();
    for (const [name, definition] of Object.entries(options.clips) as [
      Name,
      SpriteClip<FrameName>,
    ][]) {
      if (
        !name ||
        !definition ||
        !Array.isArray(definition.frames) ||
        !definition.frames.length
      )
        throw new EngineError(
          "SPRITE_CLIP_INVALID",
          "Clips need a name and at least one frame",
        );
      if (definition.fps !== undefined && definition.frameSeconds !== undefined)
        throw new EngineError(
          "SPRITE_CLIP_INVALID",
          "Specify fps or frameSeconds, not both",
        );
      const seconds = definition.frameSeconds ?? 1 / (definition.fps ?? 8);
      const duration = seconds * definition.frames.length;
      if (
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (definition.fps !== undefined &&
          (!Number.isFinite(definition.fps) || definition.fps <= 0)) ||
        (definition.loop !== undefined && typeof definition.loop !== "boolean")
      )
        throw new EngineError(
          "SPRITE_CLIP_INVALID",
          "Timing must be finite and positive; loop must be boolean",
        );
      this.clips.set(
        name,
        Object.freeze({
          images: Object.freeze(
            Array.from(definition.frames, (key) => options.sheet.get(key)),
          ),
          frameSeconds: seconds,
          duration,
          loop: definition.loop ?? true,
        }),
      );
    }
    const initial = options.initial ?? this.clips.keys().next().value;
    const clip = initial === undefined ? undefined : this.clips.get(initial);
    if (initial === undefined || !clip)
      throw new EngineError(
        "SPRITE_CLIP_INVALID",
        "Expected a valid initial clip",
      );
    if (
      options.onComplete !== undefined &&
      typeof options.onComplete !== "function"
    )
      throw new EngineError(
        "SPRITE_CLIP_INVALID",
        "onComplete must be a function",
      );
    this.selected = initial;
    this.clip = clip;
    this.complete = options.onComplete;
  }
  get current(): Name {
    return this.selected;
  }
  get state(): SpriteAnimationState {
    return this.status;
  }
  /** Zero-based position within the selected clip, not a sheet index. */
  get frameIndex(): number {
    return this.cursor;
  }
  /** Elapsed simulation seconds within the selected clip; wraps when looping. */
  get elapsed(): number {
    return this.time;
  }
  private assertAlive(): void {
    if (this.disposed)
      throw new EngineError(
        "COMPONENT_DISPOSED",
        "SpriteAnimation has been disposed",
      );
  }
  private show(): void {
    const source = this.clip.images[this.cursor];
    if (
      this.view &&
      source &&
      (source !== this.image || this.view.source !== this.written)
    ) {
      this.view.source = source;
      this.written = this.view.source;
      this.image = source;
    }
  }
  protected onAttach(): void {
    this.view = this.actor.require(Renderable.type);
    this.show();
  }
  /** Same playing/paused clip is a no-op. restart=true or stopped/completed restarts. */
  play(name: Name, options: { restart?: boolean } = {}): void {
    this.assertAlive();
    const clip = this.clips.get(name);
    if (!clip)
      throw new EngineError("SPRITE_CLIP_INVALID", "Unknown animation clip", {
        clip: name,
      });
    if (options.restart !== undefined && typeof options.restart !== "boolean")
      throw new EngineError("SPRITE_CLIP_INVALID", "restart must be boolean");
    if (
      name === this.selected &&
      !options.restart &&
      (this.status === SpriteAnimationState.Playing ||
        this.status === SpriteAnimationState.Paused)
    )
      return;
    this.selected = name;
    this.clip = clip;
    this.time = 0;
    this.cursor = 0;
    this.status = SpriteAnimationState.Playing;
    this.show();
  }
  pause(): void {
    this.assertAlive();
    if (this.status === SpriteAnimationState.Playing)
      this.status = SpriteAnimationState.Paused;
  }
  resume(): void {
    this.assertAlive();
    if (this.status === SpriteAnimationState.Paused)
      this.status = SpriteAnimationState.Playing;
  }
  /** Reset to the first frame; does not emit completion. */
  stop(): void {
    this.assertAlive();
    this.status = SpriteAnimationState.Stopped;
    this.time = 0;
    this.cursor = 0;
    this.show();
  }
  update({ delta }: UpdateContext): void {
    if (this.disposed || this.status !== SpriteAnimationState.Playing) return;
    if (!Number.isFinite(delta) || delta < 0)
      throw new EngineError(
        "INVALID_VALUE",
        "Animation delta must be finite and nonnegative",
      );
    const clip = this.clip;
    // Reduce before addition: bounded work and no overflow even for very large delta.
    const remaining = clip.duration - this.time;
    const finished =
      !clip.loop &&
      (delta >= remaining ||
        remaining - delta <= clip.duration * Number.EPSILON * 4);
    if (clip.loop) {
      const remainder = delta % clip.duration;
      this.time =
        this.time >= clip.duration - remainder
          ? this.time - (clip.duration - remainder)
          : this.time + remainder;
      if (clip.duration - this.time <= clip.duration * Number.EPSILON * 4)
        this.time = 0;
    } else this.time = finished ? clip.duration : this.time + delta;
    const position = this.time / clip.frameSeconds;
    this.cursor = finished
      ? clip.images.length - 1
      : Math.min(
          clip.images.length - 1,
          Math.floor(position + Math.max(1, position) * Number.EPSILON * 4),
        );
    if (finished) this.status = SpriteAnimationState.Completed;
    this.show();
    if (finished) this.complete?.(this.selected);
  }
  protected onDestroy(): void {
    this.status = SpriteAnimationState.Stopped;
    this.view = undefined;
    this.written = undefined;
    this.image = undefined;
  }
}
