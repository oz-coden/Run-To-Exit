import type { ActionFrame, ActionSchema } from "./action-frame";
import { EngineError } from "./diagnostics";
import type { Engine } from "./engine";
import type { ExecutionPort } from "./execution";
import {
  copyJson,
  type JsonValue,
  parseReplayData,
  parseReplayHeader,
  type ReplayControllerSchema,
  type ReplayData,
  type ReplayEvent,
  type ReplayHeader,
  type ReplayStep,
} from "./replay-data";
import { ENGINE_VERSION } from "./version";

export type {
  JsonValue,
  ReplayData,
  ReplayEvent,
  ReplayStep,
} from "./replay-data";
export { parseReplayData } from "./replay-data";
export interface ReplayController {
  readonly disposed: boolean;
  readonly active: boolean;
  schema(): readonly ActionSchema[];
  frame(): ActionFrame;
}
export type ReplayControllers = Readonly<Record<string, ReplayController>>;
function state(message: string): never {
  throw new EngineError("REPLAY_STATE", message);
}
function bindings(
  engine: Engine,
  controllers: ReplayControllers,
): [string, ReplayController][] {
  if (engine.disposed || engine.stepCount !== 0)
    state(
      "Replay requires a new Engine before its first step; rebuild game state with the recorded seed",
    );
  const result = Object.entries(controllers).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    seen = new Set<ReplayController>();
  if (result.length > 64) state("Too many Replay controllers");
  for (const [id, c] of result) {
    if (
      !id.length ||
      id.length > 256 ||
      c.disposed ||
      seen.has(c) ||
      !engine.input.hasController(c)
    )
      state("Replay IDs must uniquely bind controllers owned by this Engine");
    seen.add(c);
  }
  return result;
}
function compatible(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Opt-in capture of one fresh Engine/Scene run, not a save-state serializer. */
export class ReplayRecorder implements ExecutionPort {
  private readonly bound: readonly [string, ReplayController][];
  private readonly schemas: readonly ReplayControllerSchema[];
  private readonly metadata: Readonly<Record<string, JsonValue>>;
  private readonly maxSteps: number;
  private steps: ReplayStep[] = [];
  private events: ReplayEvent[] = [];
  private header: ReplayHeader | undefined;
  private scene: Engine["scene"] | undefined;
  private completed = 0;
  private current:
    | {
        dt: number;
        pausedBefore: boolean;
        inputs?: Readonly<Record<string, ActionFrame>>;
      }
    | undefined;
  private failure: unknown;
  private closed = false;
  private readonly detach: () => void = () => {};
  constructor(
    private readonly engine: Engine,
    options: {
      controllers: ReplayControllers;
      metadata?: Readonly<Record<string, JsonValue>>;
      maxSteps?: number;
    },
  ) {
    this.bound = bindings(engine, options.controllers);
    this.schemas = this.bound.map(([id, c]) => ({ id, actions: c.schema() }));
    if (
      options.metadata !== undefined &&
      (!options.metadata ||
        typeof options.metadata !== "object" ||
        Array.isArray(options.metadata))
    )
      state("Replay metadata must be a JSON object");
    this.metadata = copyJson(options.metadata ?? {}) as Readonly<
      Record<string, JsonValue>
    >;
    this.maxSteps = options.maxSteps ?? 100000;
    if (
      !Number.isSafeInteger(this.maxSteps) ||
      this.maxSteps < 1 ||
      this.maxSteps > 1000000
    )
      state("maxSteps must be an integer from 1 to 1000000");
    this.detach = engine.attachExecution(this);
  }
  get disposed(): boolean {
    return this.closed;
  }
  get length(): number {
    return this.completed;
  }
  validateScene(scene: Engine["scene"]): void {
    if (this.scene && this.scene !== scene)
      state(
        "Replay supports one Scene; finish/dispose it before Scene replacement",
      );
  }
  beforeStep(seconds: number): void {
    if (this.closed) return;
    if (this.failure)
      state("Recording failed; dispose it and rebuild the game");
    if (this.steps.length >= this.maxSteps)
      state("Replay recording reached maxSteps; finish before advancing again");
    this.engine.input.verifyControllers(this.bound.map(([, c]) => c));
    if (!this.header) {
      this.header = parseReplayHeader({
        formatVersion: 1,
        engineVersion: ENGINE_VERSION,
        random: this.engine.random.snapshot(),
        sceneId: this.engine.scene.id,
        controllers: this.schemas,
        metadata: this.metadata,
      });
      this.scene = this.engine.scene;
    }
    if (this.scene !== this.engine.scene)
      state(
        "Replay records one Scene; start a fresh Engine to record a different Scene",
      );
    this.current = { dt: seconds, pausedBefore: this.engine.paused };
  }
  readonly captured = (): void => {
    if (this.closed || !this.current) return;
    this.current.inputs = Object.freeze(
      Object.fromEntries(
        this.bound.map(([id, c]) => {
          const frame = c.frame();
          if (frame.events.length > 10000)
            state("Too many Button transitions in one Replay boundary");
          return [id, frame];
        }),
      ),
    );
  };
  afterStep(): void {
    if (this.closed) return;
    const c = this.current;
    if (!c?.inputs) state("Input capture did not complete");
    this.steps.push(
      Object.freeze({
        index: this.steps.length,
        dt: c.dt,
        pausedBefore: c.pausedBefore,
        pausedAfter: this.engine.paused,
        inputs: c.inputs,
      }),
    );
    this.completed = this.steps.length;
    this.current = undefined;
  }
  failed(error: unknown): void {
    this.failure = error;
    this.current = undefined;
  }
  record(type: string, payload: JsonValue): void {
    if (this.closed || this.failure)
      state("Cannot append to a closed or failed recording");
    if (typeof type !== "string" || !type.length || type.length > 256)
      state("Event type must contain 1 to 256 code units");
    if (this.events.length >= 1000000) state("Too many auxiliary events");
    this.events.push(
      Object.freeze({
        step: this.steps.length,
        phase: this.current ? "step" : "between",
        order: this.events.length,
        type,
        payload: copyJson(payload),
      }),
    );
  }
  finish(): ReplayData {
    if (
      this.closed ||
      this.current ||
      this.failure ||
      this.engine.scene.disposed ||
      !this.header ||
      !this.steps.length
    )
      state(
        "Finish requires a healthy recording with completed steps, outside Engine.step",
      );
    // Headers/payloads were validated once and captured Action frames are immutable.
    // Transfer the frozen buffers rather than cloning the full recording on export.
    const result: ReplayData = Object.freeze({
      ...this.header,
      steps: Object.freeze(this.steps),
      events: Object.freeze(this.events),
    });
    this.steps = [];
    this.events = [];
    this.dispose();
    return result;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.current = undefined;
    this.steps.length = 0;
    this.events.length = 0;
  }
}
/** Exclusive logical-frame playback. Auxiliary events are data and are never executed. */
export class ReplayPlayer implements ExecutionPort {
  readonly data: ReplayData;
  private readonly bound: readonly [string, ReplayController][];
  private readonly detach: () => void = () => {};
  private position = 0;
  private clock = 0;
  private advancing = false;
  private scene: Engine["scene"] | undefined;
  private closed = false;
  private failure: unknown;
  constructor(
    private readonly engine: Engine,
    data: unknown,
    options: {
      controllers: ReplayControllers;
      expectedMetadata?: Readonly<Record<string, JsonValue>>;
    },
  ) {
    this.data = parseReplayData(data);
    this.bound = bindings(engine, options.controllers);
    if (
      this.data.engineVersion !== ENGINE_VERSION ||
      engine.random.seed !== this.data.random.seed
    )
      throw new EngineError(
        "REPLAY_INCOMPATIBLE",
        "Engine version or initial seed does not match Replay",
      );
    const schemas = this.bound.map(([id, c]) => ({ id, actions: c.schema() }));
    if (!compatible(schemas, this.data.controllers))
      throw new EngineError(
        "REPLAY_INCOMPATIBLE",
        "Controller IDs or Action names/kinds/normalization do not match Replay",
      );
    for (const [key, value] of Object.entries(options.expectedMetadata ?? {}))
      if (!compatible(copyJson(value), this.data.metadata[key]))
        throw new EngineError(
          "REPLAY_INCOMPATIBLE",
          `Metadata mismatch: ${key}`,
        );
    this.detach = engine.attachExecution(this);
    try {
      engine.input.lockPlayback();
    } catch (error) {
      this.detach();
      throw error;
    }
  }
  get disposed(): boolean {
    return this.closed;
  }
  get done(): boolean {
    return this.position === this.data.steps.length;
  }
  get index(): number {
    return this.position;
  }
  step(): boolean {
    if (this.closed || this.failure) state("Playback is closed or failed");
    if (this.done) return false;
    const frame = this.data.steps[this.position];
    if (!frame) return false;
    this.engine.step(frame.dt);
    return true;
  }
  /** Host-time pacing; bounded catch-up slows playback rather than skipping recorded steps. */
  advance(seconds: number, maxSteps = 8): number {
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      !Number.isInteger(maxSteps) ||
      maxSteps < 1 ||
      maxSteps > 1000
    )
      throw new EngineError(
        "INVALID_DELTA",
        "Playback advance requires nonnegative finite seconds and maxSteps 1..1000",
      );
    if (this.closed || this.failure) state("Playback is closed or failed");
    if (this.advancing)
      throw new EngineError(
        "STEP_REENTRANT",
        "Replay advance is not reentrant",
      );
    this.advancing = true;
    try {
      const next = this.data.steps[this.position]?.dt ?? 0;
      this.clock = Math.min(
        Math.max(0.25, next),
        this.clock + Math.min(seconds, 0.25),
      );
      let count = 0;
      while (!this.done && count < maxSteps) {
        const dt = this.data.steps[this.position]?.dt ?? 0;
        if (this.clock + 1e-12 < dt) break;
        this.clock = Math.max(0, this.clock - dt);
        this.step();
        count++;
      }
      return count;
    } finally {
      this.advancing = false;
    }
  }
  validateScene(scene: Engine["scene"]): void {
    if (
      (this.scene && this.scene !== scene) ||
      (!this.scene && scene.id !== this.data.sceneId)
    )
      state(
        "Replay supports one matching Scene; dispose playback before Scene replacement",
      );
  }
  beforeStep(seconds: number): void {
    if (this.closed || this.failure) state("Playback is closed or failed");
    const frame = this.data.steps[this.position];
    if (!frame)
      throw new EngineError(
        "REPLAY_COMPLETE",
        "Replay has reached its end; dispose playback before live stepping",
      );
    if (seconds !== frame.dt)
      throw new EngineError(
        "REPLAY_DELTA",
        "Step delta differs from the recorded boundary",
        { step: this.position, expected: frame.dt, actual: seconds },
      );
    this.engine.input.verifyControllers(this.bound.map(([, c]) => c));
    if (
      (this.scene && this.scene !== this.engine.scene) ||
      this.engine.scene.id !== this.data.sceneId ||
      (!this.position &&
        !compatible(this.engine.random.snapshot(), this.data.random))
    )
      throw new EngineError(
        "REPLAY_INITIAL_STATE",
        "Rebuild the same Scene and initial random consumption before playback",
      );
    this.scene = this.engine.scene;
    if (this.engine.paused !== frame.pausedBefore) {
      if (frame.pausedBefore) this.engine.pause();
      else this.engine.resume();
    }
    this.engine.input.playbackFrames(
      new Map(
        this.bound.map(([id, c]) => [c, frame.inputs[id] as ActionFrame]),
      ),
    );
  }
  readonly captured = (): void => {};
  afterStep(): void {
    if (this.closed) return;
    const frame = this.data.steps[this.position];
    if (this.engine.paused !== frame?.pausedAfter)
      throw new EngineError(
        "REPLAY_DIVERGED",
        "Pause behavior differs from Replay",
        { step: this.position },
      );
    this.position++;
  }
  failed(error: unknown): void {
    this.failure = error;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.engine.input.unlockPlayback();
  }
}
