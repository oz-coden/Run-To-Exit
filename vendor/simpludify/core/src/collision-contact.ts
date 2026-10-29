import type { ContactGeometry } from "./collider";
import type { Manifold } from "./collision-geometry";
import type { CollisionResponse } from "./collision-policy";
import { EngineError } from "./diagnostics";
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export interface ContactObservation {
  seen: number;
  readonly aContact: Mutable<ContactGeometry>;
  readonly bContact?: Mutable<ContactGeometry>;
}
/** One observation path for both public payload families. */
export function observeContact(
  pair: ContactObservation,
  pass: number,
  manifold: Manifold,
  response: CollisionResponse,
  sign = 1,
): void {
  if (
    !Number.isFinite(manifold.depth) ||
    !Number.isFinite(manifold.normalX) ||
    !Number.isFinite(manifold.normalY)
  )
    throw new EngineError("INVALID_VALUE", "Contact geometry overflowed");
  const a = pair.aContact,
    b = pair.bContact;
  if (pair.seen !== pass) {
    a.depth = -1;
    a.resolved = false;
    if (b) b.resolved = false;
  }
  if (manifold.depth >= a.depth) {
    a.normalX = sign * manifold.normalX;
    a.normalY = sign * manifold.normalY;
    a.depth = manifold.depth;
    if (b) {
      b.normalX = -a.normalX;
      b.normalY = -a.normalY;
      b.depth = manifold.depth;
    }
  }
  a.response = response;
  if (b) b.response = response;
  pair.seen = pass;
}
export type ContactPhase = "enter" | "stay" | "exit";
export function contactPhase(entered: boolean, active: boolean): ContactPhase {
  return active ? (entered ? "stay" : "enter") : "exit";
}
