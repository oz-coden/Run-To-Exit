import type { ActionKind, ActionSet, ActionToken } from "./action-types";
import { EngineError } from "./diagnostics";
import { KeyCode, parseKeyCode } from "./key-code";
export interface ButtonBinding {
  readonly keys?: readonly KeyCode[];
}
export interface Axis1DBinding {
  readonly negative?: readonly KeyCode[];
  readonly positive?: readonly KeyCode[];
}
export interface Axis2DBinding {
  readonly x?: Axis1DBinding;
  readonly y?: Axis1DBinding;
}
export interface Axis3DBinding extends Axis2DBinding {
  readonly z?: Axis1DBinding;
}
export type ActionBinding<K extends ActionKind> = K extends "button"
  ? ButtonBinding
  : K extends "axis1d"
    ? Axis1DBinding
    : K extends "axis2d"
      ? Axis2DBinding
      : Axis3DBinding;
export type ActionBindings<A extends ActionSet> = {
  readonly [N in keyof A]?: ActionBinding<A[N]["kind"]>;
};
type Binding = ButtonBinding | Axis1DBinding | Axis2DBinding | Axis3DBinding;
export function checkedBinding(action: ActionToken, value: unknown): Binding {
  const record = (v: unknown, allowed: readonly string[]) => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new EngineError("INVALID_BINDING", "Binding must be an object");
    const r = v as Record<string, unknown>;
    if (Object.keys(r).some((k) => !allowed.includes(k)))
      throw new EngineError("INVALID_BINDING", "Unknown binding field", {
        action: action.name,
      });
    return r;
  };
  const codes = (v: unknown): readonly KeyCode[] => {
    if (v === undefined) return Object.freeze([]);
    if (!Array.isArray(v))
      throw new EngineError("INVALID_BINDING", "Key list must be an array");
    return Object.freeze([...new Set(v.map(parseKeyCode))]);
  };
  const axis = (v: unknown): Axis1DBinding => {
    const r = record(v ?? {}, ["negative", "positive"]);
    return Object.freeze({
      negative: codes(r.negative),
      positive: codes(r.positive),
    });
  };
  if (action.kind === "button")
    return Object.freeze({ keys: codes(record(value, ["keys"]).keys) });
  if (action.kind === "axis1d") return axis(value);
  const r = record(
    value,
    action.kind === "axis2d" ? ["x", "y"] : ["x", "y", "z"],
  );
  return Object.freeze(
    action.kind === "axis2d"
      ? { x: axis(r.x), y: axis(r.y) }
      : { x: axis(r.x), y: axis(r.y), z: axis(r.z) },
  );
}
export function keyLists(
  binding: Binding,
  path = "",
): Array<{ path: string; keys: readonly KeyCode[] }> {
  const lists: Array<{ path: string; keys: readonly KeyCode[] }> = [];
  for (const [key, value] of Object.entries(binding)) {
    if (Array.isArray(value)) lists.push({ path: path + key, keys: value });
    else lists.push(...keyLists(value, `${path}${key}.`));
  }
  return lists;
}
export function editBinding(
  current: Binding,
  patch: Binding,
  remove: boolean,
): Binding {
  const result: Record<string, unknown> = { ...current };
  for (const [name, value] of Object.entries(patch)) {
    const old = (current as Record<string, unknown>)[name];
    if (Array.isArray(value))
      result[name] = remove
        ? (old as KeyCode[]).filter((k) => !value.includes(k))
        : [...new Set([...(old as KeyCode[]), ...value])];
    else result[name] = editBinding(old as Binding, value as Binding, remove);
  }
  return result as Binding;
}

/** Physical keyboard presets for any user-defined Axis2D Action. */
export const KeyboardBindings = Object.freeze({
  WASD: Object.freeze({
    x: Object.freeze({
      negative: Object.freeze([KeyCode.A]),
      positive: Object.freeze([KeyCode.D]),
    }),
    y: Object.freeze({
      negative: Object.freeze([KeyCode.W]),
      positive: Object.freeze([KeyCode.S]),
    }),
  }),
  Arrows: Object.freeze({
    x: Object.freeze({
      negative: Object.freeze([KeyCode.ArrowLeft]),
      positive: Object.freeze([KeyCode.ArrowRight]),
    }),
    y: Object.freeze({
      negative: Object.freeze([KeyCode.ArrowUp]),
      positive: Object.freeze([KeyCode.ArrowDown]),
    }),
  }),
});
