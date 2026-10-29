import type { ViewTransform } from "./coordinates";
import type { Scene } from "./scene";
export interface PreparedScene {
  render(view: ViewTransform): void;
  /** Drain latest synchronized requests; reject current failures promptly or disposed presentations.
   * Superseded/removed requests stop blocking. Does not await future requests/navigation. */
  ready?(): Promise<void>;
  dispose(): void;
}
export interface RendererPort {
  init(): Promise<void>;
  prepare(scene: Scene): Promise<PreparedScene>;
  resize(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}
export interface FrameDriver {
  request(callback: (milliseconds: number) => void): number;
  cancel(handle: number): void;
}
