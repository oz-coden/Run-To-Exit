import {
  containsScreenPoint,
  screenPoint,
  type ViewTransform,
  type WorldPoint,
} from "@simpludify/core";
import type { PointerInfo } from "./pointer-routing";
import { PointerRouting } from "./pointer-routing";
/** One DOM capture-phase adapter per Game; Pixi federated events never route these widgets. */
export class BrowserPointer {
  readonly routing: PointerRouting;
  private readonly abort = new AbortController();
  constructor(
    private readonly host: HTMLElement,
    private readonly project: (event: { clientX: number; clientY: number }) => {
      screen: PointerInfo["screen"];
      world: WorldPoint;
      view: ViewTransform;
    },
    private readonly report: (error: unknown) => void,
    private readonly flush: () => void,
  ) {
    this.routing = new PointerRouting((id) => {
      if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
    });
    const options = { signal: this.abort.signal, capture: true };
    host.addEventListener(
      "pointerdown",
      (e) =>
        this.guard(() => {
          if (!this.surface(e.target)) return;
          this.flush();
          const data = this.data(e);
          // Capture before delivery: callbacks may remove the target or navigate.
          try {
            host.setPointerCapture(e.pointerId);
          } catch {
            /* Window capture listeners also cover synthetic events. */
          }
          this.routing.down(data);
          if (this.routing.has(e.pointerId)) {
            e.preventDefault();
            // Keep game keyboard input while a touch/mouse UI source is held.
            // Tab still focuses native semantic controls explicitly.
            host.focus({ preventScroll: true });
          } else if (host.hasPointerCapture(e.pointerId))
            host.releasePointerCapture(e.pointerId);
        }),
      options,
    );
    window.addEventListener(
      "pointermove",
      (e) =>
        this.guard(() => {
          if (!this.routing.owns(e.pointerId) && !this.surface(e.target)) {
            if (this.routing.hasHover(e.pointerId))
              this.routing.leave(this.data(e));
            return;
          }
          this.flush();
          this.routing.move(this.data(e));
        }),
      options,
    );
    window.addEventListener(
      "pointerup",
      (e) =>
        this.guard(() => {
          if (this.routing.owns(e.pointerId)) {
            e.preventDefault();
            this.flush();
            this.routing.up(this.data(e));
          }
        }),
      options,
    );
    window.addEventListener(
      "pointercancel",
      (e) => this.guard(() => this.routing.cancel(e.pointerId, false)),
      options,
    );
    host.addEventListener(
      "lostpointercapture",
      (e) => this.guard(() => this.routing.cancel(e.pointerId)),
      options,
    );
    host.addEventListener(
      "pointerleave",
      (e) => this.guard(() => this.routing.leave(this.data(e))),
      options,
    );
    window.addEventListener(
      "blur",
      (event) => {
        if (event.target === window) this.release();
      },
      options,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.release();
      },
      options,
    );
  }
  private surface(target: EventTarget | null): boolean {
    return (
      target === this.host ||
      (target instanceof HTMLCanvasElement &&
        target.parentElement === this.host)
    );
  }
  private data(e: PointerEvent): PointerInfo {
    const { screen, world, view } = this.project(e);
    return Object.freeze({
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      button: e.button,
      buttons: e.buttons,
      screen: Object.freeze(screenPoint(screen.x, screen.y)),
      world: Object.freeze(world),
      inside: containsScreenPoint(view, screen),
    });
  }
  private guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.report(error);
    }
  }
  release(): void {
    this.guard(() => this.routing.release());
  }
  dispose(): void {
    this.abort.abort();
    this.guard(() => this.routing.dispose());
  }
}
