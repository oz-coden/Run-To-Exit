import { EngineError } from "./diagnostics";
export const CollisionResponse = {
  Trigger: "trigger",
  Solid: "solid",
} as const;
export type CollisionResponse =
  (typeof CollisionResponse)[keyof typeof CollisionResponse];
export interface CollisionPolicy {
  readonly response: CollisionResponse;
  readonly layer: number;
  readonly mask: number;
}
export function collisionResponse(value: CollisionResponse): CollisionResponse {
  if (!Object.values(CollisionResponse).includes(value))
    throw new EngineError("INVALID_VALUE", "Unknown collision response");
  return value;
}
export function collisionBits(
  value: number,
  name: string,
  allowZero: boolean,
): number {
  if (
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 0xffffffff
  )
    throw new EngineError(
      "INVALID_VALUE",
      `${name} must be an unsigned 32-bit ${allowZero ? "mask" : "nonzero layer"}`,
    );
  return value;
}
export function allowsPair(a: CollisionPolicy, b: CollisionPolicy): boolean {
  return !!(a.mask & b.layer) && !!(b.mask & a.layer);
}
export function pairResponse(
  a: CollisionPolicy,
  b: CollisionPolicy,
): CollisionResponse {
  return a.response === CollisionResponse.Solid &&
    b.response === CollisionResponse.Solid
    ? CollisionResponse.Solid
    : CollisionResponse.Trigger;
}
export function samePolicy(
  a: CollisionPolicy | null,
  b: CollisionPolicy | null,
): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.response === b.response &&
      a.layer === b.layer &&
      a.mask === b.mask)
  );
}
