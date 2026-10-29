import {
  type ActionFrame,
  type ActionSchema,
  parseActionFrame,
} from "./action-frame";
import { EngineError } from "./diagnostics";
import {
  DEFAULT_RANDOM_STREAM,
  deriveStreamSeed,
  RANDOM_ALGORITHM,
  type RandomSnapshot,
} from "./random";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export interface ReplayControllerSchema {
  readonly id: string;
  readonly actions: readonly ActionSchema[];
}
export interface ReplayStep {
  readonly index: number;
  readonly dt: number;
  readonly pausedBefore: boolean;
  readonly pausedAfter: boolean;
  readonly inputs: Readonly<Record<string, ActionFrame>>;
}
export interface ReplayEvent {
  readonly step: number;
  readonly phase: "between" | "step";
  readonly order: number;
  readonly type: string;
  readonly payload: JsonValue;
}
export interface ReplayData {
  readonly formatVersion: 1;
  readonly engineVersion: string;
  readonly random: RandomSnapshot;
  readonly sceneId: string;
  readonly controllers: readonly ReplayControllerSchema[];
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly steps: readonly ReplayStep[];
  readonly events: readonly ReplayEvent[];
}
function bad(message: string): never {
  throw new EngineError("REPLAY_DATA", message);
}
function object(v: unknown): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    (Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null)
  )
    return bad("Expected a plain JSON object");
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, names: readonly string[]): void {
  if (
    Object.keys(v).length !== names.length ||
    Object.keys(v).some((k) => !names.includes(k))
  )
    bad("Unexpected or missing Replay fields");
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v.length || v.length > 256)
    return bad("Identifier must contain 1 to 256 code units");
  return v;
}
function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
    return bad("Expected a bounded nonnegative integer");
  return v;
}
function array(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max)
    return bad("Expected a bounded array");
  return v;
}
/** Clones JSON-only payloads; rejects nonfinite numbers, cycles, class instances and undefined. */
export function copyJson(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  let nodes = 0;
  const copy = (v: unknown, depth: number): JsonValue => {
    if (++nodes > 100000 || depth > 32)
      return bad("JSON payload exceeds size/depth limit");
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return bad("JSON numbers must be finite");
      return v;
    }
    if (typeof v !== "object" || !v)
      return bad("Expected JSON data, not executable/host values");
    if (Object.getOwnPropertySymbols(v).length)
      return bad("Symbol keys are not JSON payloads");
    if (ancestors.has(v)) return bad("Cyclic JSON payload");
    ancestors.add(v);
    let result: JsonValue;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        return bad("Sparse or extended arrays are not JSON payloads");
      result = Object.freeze(v.map((x) => copy(x, depth + 1)));
    } else
      result = Object.freeze(
        Object.fromEntries(
          Object.entries(object(v))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, copy(x, depth + 1)]),
        ),
      );
    ancestors.delete(v);
    return result;
  };
  return copy(value, 0);
}
/** @internal Shared one-time validation for recording headers and imported Replay data. */
export type ReplayHeader = Omit<ReplayData, "steps" | "events">;
export function parseReplayHeader(value: unknown): ReplayHeader {
  const d = object(value);
  if (d.formatVersion !== 1) return bad("Unsupported Replay formatVersion");
  const engineVersion = text(d.engineVersion),
    sceneId = text(d.sceneId),
    r = object(d.random);
  keys(r, ["algorithm", "seed", "streams"]);
  if (r.algorithm !== RANDOM_ALGORITHM)
    return bad("Unsupported random algorithm");
  const seed = integer(r.seed, 0xffffffff),
    streamNames = new Set<string>();
  const streams = array(r.streams, 4096).map((v) => {
    const s = object(v);
    keys(s, ["name", "seed", "state", "calls"]);
    const name = text(s.name);
    if (streamNames.has(name)) return bad("Duplicate random stream");
    streamNames.add(name);
    const initial = integer(s.seed, 0xffffffff);
    if (
      initial !==
      (name === DEFAULT_RANDOM_STREAM ? seed : deriveStreamSeed(seed, name))
    )
      return bad("Incompatible random stream seed");
    return Object.freeze({
      name,
      seed: initial,
      state: integer(s.state, 0xffffffff),
      calls: integer(s.calls),
    });
  });
  streams.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!streamNames.has(DEFAULT_RANDOM_STREAM))
    return bad("Missing default random stream");
  const ids = new Set<string>();
  const controllers = array(d.controllers, 64).map((v) => {
    const c = object(v);
    keys(c, ["id", "actions"]);
    const id = text(c.id);
    if (ids.has(id)) return bad("Duplicate controller ID");
    ids.add(id);
    const names = new Set<string>();
    const actions = array(c.actions, 256).map((v) => {
      const a = object(v);
      keys(a, ["name", "kind", "normalize"]);
      const name = text(a.name);
      if (
        names.has(name) ||
        typeof a.kind !== "string" ||
        !["button", "axis1d", "axis2d", "axis3d"].includes(a.kind) ||
        typeof a.normalize !== "boolean"
      )
        return bad("Invalid or duplicate Action schema");
      names.add(name);
      if ((a.kind === "button" || a.kind === "axis1d") && a.normalize)
        return bad("Unexpected normalization policy");
      return Object.freeze({
        name,
        kind: a.kind as ActionSchema["kind"],
        normalize: a.normalize,
      });
    });
    actions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return Object.freeze({ id, actions: Object.freeze(actions) });
  });
  controllers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const metadata = copyJson(object(d.metadata)) as Readonly<
    Record<string, JsonValue>
  >;
  return Object.freeze({
    formatVersion: 1,
    engineVersion,
    random: Object.freeze({
      algorithm: RANDOM_ALGORITHM,
      seed,
      streams: Object.freeze(streams),
    }),
    sceneId,
    controllers: Object.freeze(controllers),
    metadata,
  });
}
export function parseReplayData(value: unknown): ReplayData {
  const d = object(value);
  keys(d, [
    "formatVersion",
    "engineVersion",
    "random",
    "sceneId",
    "controllers",
    "metadata",
    "steps",
    "events",
  ]);
  const header = parseReplayHeader(d),
    controllers = header.controllers,
    ids = controllers.map((c) => c.id);
  const steps = array(d.steps, 1000000).map((value, index) => {
    const s = object(value);
    keys(s, ["index", "dt", "pausedBefore", "pausedAfter", "inputs"]);
    if (
      s.index !== index ||
      typeof s.dt !== "number" ||
      !Number.isFinite(s.dt) ||
      s.dt < 0 ||
      typeof s.pausedBefore !== "boolean" ||
      typeof s.pausedAfter !== "boolean"
    )
      return bad("Invalid step number, delta or pause state");
    const raw = object(s.inputs);
    keys(raw, [...ids]);
    const inputs = Object.fromEntries(
      controllers.map((c) => [c.id, parseActionFrame(raw[c.id], c.actions)]),
    );
    return Object.freeze({
      index,
      dt: s.dt,
      pausedBefore: s.pausedBefore,
      pausedAfter: s.pausedAfter,
      inputs: Object.freeze(inputs),
    });
  });
  if (!steps.length)
    return bad("Replay requires at least one completed input boundary");
  let lastStep = -1,
    lastPhase = -1;
  const events = array(d.events, 1000000).map((value, index) => {
    const e = object(value);
    keys(e, ["step", "phase", "order", "type", "payload"]);
    const step = integer(e.step, steps.length);
    if (
      e.order !== index ||
      (e.phase !== "between" && e.phase !== "step") ||
      (e.phase === "step" && step === steps.length)
    )
      return bad("Invalid auxiliary event position");
    const phase = e.phase === "between" ? 0 : 1;
    if (step < lastStep || (step === lastStep && phase < lastPhase))
      return bad("Auxiliary event order is not monotonic");
    lastStep = step;
    lastPhase = phase;
    return Object.freeze({
      step,
      phase: e.phase,
      order: index,
      type: text(e.type),
      payload: copyJson(e.payload),
    });
  });
  return Object.freeze({
    ...header,
    steps: Object.freeze(steps),
    events: Object.freeze(events),
  });
}
