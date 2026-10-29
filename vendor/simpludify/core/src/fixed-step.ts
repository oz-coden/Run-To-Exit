import { EngineError } from "./diagnostics";
import type { Engine } from "./engine";
export interface FixedStepOptions {
  readonly step?: number;
  readonly maxSteps?: number;
  readonly maxFrameDelta?: number;
}
export interface FixedStepResult {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
  readonly inputPumps: number;
}
/** Bounded host-time accumulator. Rendering and interpolation remain host responsibilities. */
export class FixedStepRunner {
  readonly step: number;
  readonly maxSteps: number;
  readonly maxFrameDelta: number;
  private accumulator = 0;
  private scene: Engine["scene"];
  private advancing = false;
  constructor(
    private readonly engine: Engine,
    options: FixedStepOptions = {},
  ) {
    this.step = options.step ?? 1 / 60;
    this.maxSteps = options.maxSteps ?? 8;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.scene = engine.scene;
    if (
      !Number.isFinite(this.step) ||
      this.step < 1e-6 ||
      this.step > 1 ||
      !Number.isInteger(this.maxSteps) ||
      this.maxSteps < 1 ||
      this.maxSteps > 1000 ||
      !Number.isFinite(this.maxFrameDelta) ||
      this.maxFrameDelta < this.step ||
      this.maxFrameDelta > 60
    )
      throw new EngineError(
        "INVALID_FIXED_STEP",
        "step must be 1e-6..1 seconds, maxSteps 1..1000, and maxFrameDelta step..60 seconds",
      );
  }
  reset(): void {
    this.accumulator = 0;
    this.scene = this.engine.scene;
  }
  advance(seconds: number): FixedStepResult {
    if (this.engine.disposed)
      throw new EngineError(
        "GAME_DISPOSED",
        "Cannot advance a disposed Engine",
      );
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new EngineError(
        "INVALID_DELTA",
        "Frame delta must be finite and nonnegative",
      );
    if (this.advancing)
      throw new EngineError(
        "STEP_REENTRANT",
        "FixedStepRunner.advance is not reentrant",
      );
    this.advancing = true;
    try {
      if (this.scene !== this.engine.scene) this.reset();
      if (this.engine.paused) {
        this.reset();
        this.engine.step(0);
        return { steps: 0, alpha: 0, droppedSeconds: 0, inputPumps: 1 };
      }
      const accepted = Math.min(seconds, this.maxFrameDelta);
      let dropped = seconds - accepted,
        steps = 0;
      this.accumulator += accepted;
      const epsilon = this.step * 1e-9;
      while (this.accumulator + epsilon >= this.step && steps < this.maxSteps) {
        this.accumulator = Math.max(0, this.accumulator - this.step);
        this.engine.step(this.step);
        steps++;
        if (
          this.engine.disposed ||
          this.engine.paused ||
          this.scene !== this.engine.scene
        ) {
          this.reset();
          break;
        }
      }
      if (this.accumulator + epsilon >= this.step) {
        const discarded =
          Math.floor((this.accumulator + epsilon) / this.step) * this.step;
        dropped += discarded;
        this.accumulator = Math.max(0, this.accumulator - discarded);
      }
      return {
        steps,
        alpha: this.accumulator / this.step,
        droppedSeconds: dropped,
        inputPumps: 0,
      };
    } finally {
      this.advancing = false;
    }
  }
}
