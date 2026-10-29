import {
  type CollisionPolicy,
  type CollisionResponse,
  collisionBits,
  collisionResponse,
  samePolicy,
} from "./collision-policy";
import { EngineError } from "./diagnostics";

export interface TileCollisionPolicy {
  readonly response: CollisionResponse;
  readonly layer?: number;
  readonly mask?: number;
}
export type ResolvedTileCollision = Readonly<CollisionPolicy>;
export interface TileCollisionOptions<Name extends string> {
  readonly tiles: readonly (TileCollisionPolicy & {
    readonly tile: number | NoInfer<Name>;
  })[];
}
/** @internal Notifications invalidate collision state only, never presentation. */
export type TileCollisionChange<Name extends string> =
  | { readonly kind: "cell"; readonly index: number }
  | { readonly kind: "tile"; readonly tile: number | Name }
  | { readonly kind: "all" };
function normalized(
  value: TileCollisionPolicy | null,
): ResolvedTileCollision | null {
  if (value === null) return null;
  if (!value || typeof value !== "object")
    throw new EngineError(
      "INVALID_VALUE",
      "Tile collision requires a policy or null",
    );
  return Object.freeze({
    response: collisionResponse(value.response),
    layer: collisionBits(
      value.layer === undefined ? 1 : value.layer,
      "layer",
      false,
    ),
    mask: collisionBits(
      value.mask === undefined ? 0xffffffff : value.mask,
      "mask",
      true,
    ),
  });
}
/** @internal Sparse overrides and copied ID policies; no geometry/Scene/renderer ownership. */
export class TileCollisionData<Name extends string> {
  private readonly defaults = new Map<number | Name, ResolvedTileCollision>();
  private readonly overrides = new Map<number, ResolvedTileCollision | null>();
  private positiveOverrides = 0;
  constructor(
    options?: TileCollisionOptions<Name>,
    validate?: (tile: number | Name) => void,
  ) {
    if (options !== undefined) {
      if (!options || !Array.isArray(options.tiles))
        throw new EngineError(
          "INVALID_VALUE",
          "collision.tiles must be an array",
        );
      for (const rule of options.tiles) {
        if (!rule || typeof rule !== "object")
          throw new EngineError("INVALID_VALUE", "Invalid tile collision rule");
        validate?.(rule.tile);
        if (this.defaults.has(rule.tile))
          throw new EngineError(
            "INVALID_VALUE",
            "Duplicate tile collision rule",
          );
        const policy = normalized(rule);
        if (policy) this.defaults.set(rule.tile, policy);
      }
    }
  }
  get configured(): boolean {
    return this.defaults.size > 0 || this.positiveOverrides > 0;
  }
  get(index: number, tile: number | Name | null): ResolvedTileCollision | null {
    if (this.overrides.has(index)) return this.overrides.get(index) ?? null;
    return tile === null ? null : (this.defaults.get(tile) ?? null);
  }
  set(index: number, value: TileCollisionPolicy | null): boolean {
    const policy = normalized(value),
      old = this.overrides.get(index);
    if (this.overrides.has(index) && samePolicy(old ?? null, policy))
      return false;
    if (old) this.positiveOverrides--;
    if (policy) this.positiveOverrides++;
    this.overrides.set(index, policy);
    return true;
  }
  reset(index: number): boolean {
    if (this.overrides.get(index)) this.positiveOverrides--;
    return this.overrides.delete(index);
  }
  setDefault(tile: number | Name, value: TileCollisionPolicy | null): boolean {
    const policy = normalized(value),
      old = this.defaults.get(tile) ?? null;
    if (samePolicy(old, policy)) return false;
    if (policy) this.defaults.set(tile, policy);
    else this.defaults.delete(tile);
    return true;
  }
}
