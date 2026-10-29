import { EngineError } from "./diagnostics";
export type ActionKind = "button" | "axis1d" | "axis2d" | "axis3d";
export interface Axis2DValue {
  readonly x: number;
  readonly y: number;
}
export interface Axis3DValue extends Axis2DValue {
  readonly z: number;
}
export type ActionValue<K extends ActionKind> = K extends "button"
  ? boolean
  : K extends "axis1d"
    ? number
    : K extends "axis2d"
      ? Axis2DValue
      : Axis3DValue;
/** Axis2D writes reject a third component even when supplied through a typed variable. */
export type ActionInputValue<K extends ActionKind> = K extends "axis2d"
  ? Axis2DValue & { readonly z?: never }
  : ActionValue<K>;
export interface ActionDefinition<K extends ActionKind = ActionKind> {
  readonly kind: K;
  readonly normalize: boolean;
}
export interface ActionToken<
  K extends ActionKind = ActionKind,
  N extends string = string,
> extends ActionDefinition<K> {
  readonly id: symbol;
  readonly name: N;
}
export const Action = {
  button: (): ActionDefinition<"button"> =>
    Object.freeze({ kind: "button", normalize: false }),
  axis1D: (): ActionDefinition<"axis1d"> =>
    Object.freeze({ kind: "axis1d", normalize: false }),
  axis2D: (options: { normalize?: boolean } = {}): ActionDefinition<"axis2d"> =>
    Object.freeze({ kind: "axis2d", normalize: options.normalize ?? true }),
  axis3D: (options: { normalize?: boolean } = {}): ActionDefinition<"axis3d"> =>
    Object.freeze({ kind: "axis3d", normalize: options.normalize ?? true }),
};
export type ActionSet = Readonly<Record<string, ActionToken>>;
export function defineActions<const D extends Record<string, ActionDefinition>>(
  definitions: D,
): { readonly [N in keyof D]: ActionToken<D[N]["kind"], N & string> } {
  const result: Record<string, ActionToken> = Object.create(null);
  for (const [name, definition] of Object.entries(definitions)) {
    if (
      !name.trim() ||
      !["button", "axis1d", "axis2d", "axis3d"].includes(definition.kind) ||
      typeof definition.normalize !== "boolean"
    )
      throw new EngineError("INVALID_ACTION", "Invalid action definition", {
        name,
      });
    result[name] = Object.freeze({ ...definition, id: Symbol(name), name });
  }
  return Object.freeze(result) as {
    readonly [N in keyof D]: ActionToken<D[N]["kind"], N & string>;
  };
}
