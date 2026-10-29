import type { ActionFrame } from "./action-frame";
import { EngineError } from "./diagnostics";
import { OwnedInputSource } from "./input-source";
import { type KeyCode, parseKeyCode } from "./key-code";
import { cleanupAll, type LifetimeOwner } from "./lifetime";
/** @internal Engine boundary participant, implemented by ActionController. */
export interface ActionInputPort {
  readonly active: boolean;
  readonly sourceCount: number;
  accepts(code: KeyCode): boolean;
  keyChanged(): void;
  capture(frame?: ActionFrame): void;
  dispatch(): void;
  reset(): void;
  dispose(): void;
}
/** A keyboard device contribution, not a game-facing state reader.
 * Use ActionSource for touch, automation and game logic. */
export class KeyboardSource extends OwnedInputSource {
  /** @internal */ constructor(private readonly input: InputSystem) {
    super();
  }
  set(code: KeyCode, pressed: boolean): void {
    parseKeyCode(code);
    if (typeof pressed !== "boolean")
      throw new EngineError("INVALID_VALUE", "Keyboard state must be boolean");
    if (this.writable(!pressed)) this.input.writeKey(this, code, pressed);
  }
  protected release(remove: boolean): void {
    this.input.releaseKeyboard(this, remove);
  }
}
/** Engine-owned routing and update boundary. No raw game-state/alternate movement API. */
export class InputSystem {
  private readonly actions = new Set<ActionInputPort>();
  private readonly keyboards = new Map<KeyboardSource, Set<KeyCode>>();
  private dead = false;
  private playback = false;
  private frames: ReadonlyMap<object, ActionFrame> | undefined;
  get sourceCount(): number {
    let count = this.keyboards.size;
    for (const actions of this.actions) count += actions.sourceCount;
    return count;
  }
  /** @internal */ registerActions(actions: ActionInputPort): () => void {
    if (this.dead)
      throw new EngineError("OWNER_DISPOSED", "Input has been disposed");
    this.actions.add(actions);
    return () => {
      this.actions.delete(actions);
    };
  }
  acceptsKey(code: KeyCode): boolean {
    if (this.playback) return false;
    for (const actions of this.actions) if (actions.accepts(code)) return true;
    return false;
  }
  private notify(): void {
    for (const actions of this.actions) actions.keyChanged();
  }
  /** @internal Device state is resolved only through Action bindings. */
  keyDown(code: KeyCode): boolean {
    for (const keys of this.keyboards.values()) if (keys.has(code)) return true;
    return false;
  }
  /** @internal Freeze every controller before invoking any callbacks. */
  beginStep(captured?: () => void): void {
    if (!this.actions.size) {
      captured?.();
      return;
    }
    const plan = [...this.actions].filter((actions) => actions.active);
    for (const actions of plan) actions.capture(this.frames?.get(actions));
    captured?.();
    const errors: unknown[] = [];
    for (const actions of plan) {
      if (!this.actions.has(actions) || !actions.active) continue;
      try {
        actions.dispatch();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Input callbacks failed");
  }
  createKeyboardSource(owner?: LifetimeOwner): KeyboardSource {
    if (this.dead || owner?.disposed)
      throw new EngineError("OWNER_DISPOSED", "Input owner has been disposed");
    const source = new KeyboardSource(this);
    this.keyboards.set(source, new Set());
    try {
      if (owner) source.own(owner);
    } catch (error) {
      source.dispose();
      throw error;
    }
    return source;
  }
  /** @internal */ writeKey(
    source: KeyboardSource,
    code: KeyCode,
    pressed: boolean,
  ): void {
    this.assertWrite(!pressed);
    const keys = this.keyboards.get(source);
    if (!keys || this.dead)
      throw new EngineError("OWNER_DISPOSED", "Input has been disposed");
    if (keys.has(code) === pressed) return;
    const before = this.keyDown(code);
    if (pressed) keys.add(code);
    else keys.delete(code);
    if (before !== this.keyDown(code)) this.notify();
  }
  /** @internal */ releaseKeyboard(
    source: KeyboardSource,
    remove: boolean,
  ): void {
    const keys = this.keyboards.get(source);
    if (!keys) return;
    const changed = keys.size > 0;
    keys.clear();
    if (remove) this.keyboards.delete(source);
    if (changed && !this.dead) this.notify();
  }
  /** @internal */ hasController(controller: object): boolean {
    return this.actions.has(controller as ActionInputPort);
  }
  /** @internal */ verifyControllers(controllers: readonly object[]): void {
    const active = [...this.actions].filter((a) => a.active);
    if (
      active.length !== controllers.length ||
      active.some((a) => !controllers.includes(a))
    )
      throw new EngineError(
        "REPLAY_CONTROLLERS",
        "Replay must bind exactly the active Scene controllers",
      );
  }
  /** @internal */ assertWrite(neutral: boolean): void {
    if (this.playback && !neutral)
      throw new EngineError(
        "REPLAY_INPUT_LOCKED",
        "Live Action/device writes are disabled during Replay playback",
      );
  }
  /** @internal */ lockPlayback(): void {
    if (this.playback)
      throw new EngineError(
        "REPLAY_STATE",
        "Input already has a playback driver",
      );
    this.clear();
    this.playback = true;
  }
  /** @internal */ playbackFrames(
    frames: ReadonlyMap<object, ActionFrame>,
  ): void {
    if (!this.playback)
      throw new EngineError("REPLAY_STATE", "Playback is not active");
    this.frames = frames;
  }
  /** @internal */ unlockPlayback(): void {
    this.frames = undefined;
    this.playback = false;
    this.clear();
  }
  clear(): void {
    for (const keys of this.keyboards.values()) keys.clear();
    for (const actions of this.actions) actions.reset();
  }
  /** Device diagnostics only; game state is ActionController.snapshot(). */
  snapshot(): readonly KeyCode[] {
    const keys = new Set<KeyCode>();
    for (const contribution of this.keyboards.values())
      for (const key of contribution) keys.add(key);
    return [...keys].sort();
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    try {
      cleanupAll(
        [
          ...[...this.actions].map((a) => () => a.dispose()),
          ...[...this.keyboards.keys()].map((s) => () => s.dispose()),
        ],
        "Input cleanup failed",
      );
    } finally {
      this.actions.clear();
      this.keyboards.clear();
    }
  }
}
