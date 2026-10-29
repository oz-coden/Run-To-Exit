import type { ActionKind, ActionValue } from "./action-types";
import { EngineError } from "./diagnostics";
export interface ActionSchema {
  readonly name: string;
  readonly kind: ActionKind;
  readonly normalize: boolean;
}
export interface ActionFrame {
  readonly values: Readonly<Record<string, ActionValue<ActionKind>>>;
  readonly events: readonly { readonly name: string; readonly down: boolean }[];
}
/** Shared validation for device-independent Action values, including JSON imports. */
export function checkedActionValue(
  action: { readonly kind: ActionKind; readonly normalize?: boolean },
  value: unknown,
): ActionValue<ActionKind> {
  if (action.kind === "button") {
    if (typeof value !== "boolean")
      throw new EngineError(
        "INVALID_ACTION_VALUE",
        "Button requires a boolean",
      );
    return value;
  }
  const number = (v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1)
      throw new EngineError(
        "INVALID_ACTION_VALUE",
        "Axis components must be finite and between -1 and 1",
      );
    return v;
  };
  if (action.kind === "axis1d") return number(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EngineError("INVALID_ACTION_VALUE", "Axis requires a vector");
  const v = value as Record<string, unknown>,
    expected = action.kind === "axis2d" ? ["x", "y"] : ["x", "y", "z"];
  if (
    Object.keys(v).length !== expected.length ||
    Object.keys(v).some((k) => !expected.includes(k))
  )
    throw new EngineError(
      "INVALID_ACTION_VALUE",
      "Unexpected vector component",
    );
  return Object.freeze(
    action.kind === "axis2d"
      ? { x: number(v.x), y: number(v.y) }
      : { x: number(v.x), y: number(v.y), z: number(v.z) },
  );
}
export function parseActionFrame(
  value: unknown,
  schema: readonly ActionSchema[],
): ActionFrame {
  const invalid = () => {
    throw new EngineError("REPLAY_DATA", "Malformed Action frame");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const f = value as Record<string, unknown>;
  if (
    Object.keys(f).length !== 2 ||
    !f.values ||
    typeof f.values !== "object" ||
    Array.isArray(f.values) ||
    !Array.isArray(f.events) ||
    f.events.length > 10000
  )
    return invalid();
  const raw = f.values as Record<string, unknown>,
    values: Record<string, ActionValue<ActionKind>> = Object.create(null),
    definitions = new Map(schema.map((s) => [s.name, s]));
  if (
    Object.keys(raw).length !== schema.length ||
    Object.keys(raw).some((n) => !definitions.has(n))
  )
    return invalid();
  for (const s of schema) {
    const v = checkedActionValue(s, raw[s.name]);
    if (
      typeof v === "object" &&
      s.normalize &&
      Math.hypot(v.x, v.y, "z" in v ? v.z : 0) > 1 + 1e-12
    )
      return invalid();
    values[s.name] = v;
  }
  const held = new Map<string, boolean>();
  const events = f.events.map((event: unknown) => {
    if (!event || typeof event !== "object" || Array.isArray(event))
      return invalid();
    const e = event as Record<string, unknown>;
    if (
      Object.keys(e).length !== 2 ||
      typeof e.name !== "string" ||
      typeof e.down !== "boolean" ||
      definitions.get(e.name)?.kind !== "button"
    )
      return invalid();
    if (held.has(e.name) && held.get(e.name) === e.down) return invalid();
    held.set(e.name, e.down);
    return Object.freeze({ name: e.name, down: e.down });
  });
  for (const [name, down] of held) if (values[name] !== down) return invalid();
  return Object.freeze({
    values: Object.freeze(values),
    events: Object.freeze(events),
  });
}
