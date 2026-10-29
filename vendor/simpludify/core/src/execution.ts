import type { Scene } from "./scene";
/** @internal One opt-in execution driver; no observer list or per-step log exists by default. */
export interface ExecutionPort {
  validateScene(scene: Scene): void;
  beforeStep(seconds: number): void;
  readonly captured: () => void;
  afterStep(): void;
  failed(error: unknown): void;
  dispose(): void;
}
