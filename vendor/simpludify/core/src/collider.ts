import type { Actor } from "./actor";
import { Component, type ComponentType, defineComponent } from "./component";
import { Transform } from "./components";
import { EngineError, positive } from "./diagnostics";
import { defineEvent, type EventType } from "./events";
export const CollisionShape = { Box: "box", Circle: "circle" } as const;
export type CollisionShape =
  (typeof CollisionShape)[keyof typeof CollisionShape];

import {
  CollisionResponse,
  collisionBits,
  collisionResponse,
} from "./collision-policy";

export { CollisionResponse } from "./collision-policy";

type ShapeOptions =
  | { shape?: typeof CollisionShape.Box; width?: number; height?: number }
  | { shape: typeof CollisionShape.Circle; radius?: number };
export type ColliderOptions = ShapeOptions & {
  response?: CollisionResponse;
  offsetX?: number;
  offsetY?: number;
  layer?: number;
  mask?: number;
};
export interface ContactGeometry {
  /** Unit normal from self toward other at detection, before position correction. */
  readonly normalX: number;
  readonly normalY: number;
  readonly depth: number;
  readonly response: CollisionResponse;
  readonly resolved: boolean;
}
export interface Contact extends ContactGeometry {
  readonly self: Collider;
  readonly other: Collider;
  readonly selfActor: Actor;
  readonly otherActor: Actor;
}
export const ContactEnter = defineEvent<Contact>("ContactEnter");
export const ContactStay = defineEvent<Contact>("ContactStay");
export const ContactExit = defineEvent<Contact>("ContactExit");
function finite(value: number, name: string): number {
  if (!Number.isFinite(value))
    throw new EngineError("INVALID_VALUE", `${name} must be finite`, {
      field: name,
    });
  return value;
}
/** Geometry and contact policy. CollisionBody separately controls position correction. */
export class Collider extends Component {
  static readonly type: ComponentType<Collider> = defineComponent<Collider>(
    "Collider",
    [Transform.type],
  );
  readonly type = Collider.type;
  readonly response: CollisionResponse;
  readonly shape: CollisionShape;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly layer: number;
  readonly mask: number;
  constructor(options: ColliderOptions = {}) {
    super();
    this.response = collisionResponse(
      options.response ?? CollisionResponse.Trigger,
    );
    this.shape = options.shape ?? CollisionShape.Box;
    if (
      this.shape !== CollisionShape.Box &&
      this.shape !== CollisionShape.Circle
    )
      throw new EngineError("INVALID_VALUE", "Unknown collider shape");
    this.width =
      options.shape === CollisionShape.Circle
        ? 0
        : positive(options.width ?? 32, "width");
    this.height =
      options.shape === CollisionShape.Circle
        ? 0
        : positive(options.height ?? 32, "height");
    this.radius =
      options.shape === CollisionShape.Circle
        ? positive(options.radius ?? 16, "radius")
        : 0;
    this.offsetX = finite(options.offsetX ?? 0, "offsetX");
    this.offsetY = finite(options.offsetY ?? 0, "offsetY");
    this.layer = collisionBits(options.layer ?? 1, "layer", false);
    this.mask = collisionBits(options.mask ?? 0xffffffff, "mask", true);
  }
  /** @internal */ notify<T>(type: EventType<T>, contact: T): void {
    this.emit(type, contact);
  }
}
