import {
  type ActionBinding,
  type ActionBindings,
  type Axis1DBinding,
  type Axis2DBinding,
  type Axis3DBinding,
  type ButtonBinding,
  checkedBinding,
  editBinding,
  keyLists,
} from "./action-bindings";
import {
  type ActionFrame,
  type ActionSchema,
  checkedActionValue,
} from "./action-frame";
import type {
  ActionInputValue,
  ActionKind,
  ActionSet,
  ActionToken,
  ActionValue,
  Axis2DValue,
  Axis3DValue,
} from "./action-types";

export type {
  ActionBinding,
  ActionBindings,
  Axis1DBinding,
  Axis2DBinding,
  Axis3DBinding,
  ButtonBinding,
} from "./action-bindings";
export { KeyboardBindings } from "./action-bindings";
export type {
  ActionDefinition,
  ActionInputValue,
  ActionKind,
  ActionSet,
  ActionToken,
  ActionValue,
  Axis2DValue,
  Axis3DValue,
} from "./action-types";
export { Action, defineActions } from "./action-types";

import { EngineError } from "./diagnostics";
import { defineEvent, EventBus } from "./events";
import type { ActionInputPort, InputSystem } from "./input";
import { OwnedInputSource } from "./input-source";
import type { KeyCode } from "./key-code";
import { cleanupAll, Lifetime, type LifetimeOwner } from "./lifetime";
import { type Scene, SceneState } from "./scene";

type Token<A extends ActionSet> = A[keyof A];
type ButtonToken<A extends ActionSet> = Extract<Token<A>, { kind: "button" }>;
type Value = boolean | number | Axis2DValue | Axis3DValue;
type Binding = ButtonBinding | Axis1DBinding | Axis2DBinding | Axis3DBinding;
export interface ButtonState {
  readonly held: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
  readonly pressCount: number;
  readonly releaseCount: number;
}
export type ActionSnapshot<A extends ActionSet> = {
  readonly [N in keyof A]: {
    readonly kind: A[N]["kind"];
    readonly value: ActionValue<A[N]["kind"]>;
  } & (A[N]["kind"] extends "button"
    ? { readonly button: ButtonState }
    : unknown);
};
export interface ButtonTransition<
  T extends ActionToken = ActionToken<"button">,
> {
  readonly action: T;
  readonly down: boolean;
}
interface Entry {
  value: Value;
  frame: Value;
  button: ButtonState;
  binding: Binding;
  defaults: Binding;
}
const noButton: ButtonState = Object.freeze({
  held: false,
  pressed: false,
  released: false,
  pressCount: 0,
  releaseCount: 0,
});
const pressedEvent = defineEvent<ActionToken>("ActionPressed");
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
function neutral(action: ActionToken): Value {
  if (action.kind === "button") return false;
  if (action.kind === "axis1d") return 0;
  return Object.freeze(
    action.kind === "axis2d" ? { x: 0, y: 0 } : { x: 0, y: 0, z: 0 },
  );
}
function isNeutral(value: Value): boolean {
  return typeof value === "boolean"
    ? !value
    : typeof value === "number"
      ? value === 0
      : value.x === 0 && value.y === 0 && (!("z" in value) || value.z === 0);
}
/** Scene-owned logical input, sampled automatically at each Engine.step boundary. */
export class ActionController<A extends ActionSet>
  implements LifetimeOwner, ActionInputPort
{
  private readonly lifetime = new Lifetime();
  private readonly entries = new Map<ActionToken, Entry>();
  private readonly sources = new Map<
    ActionSource<A>,
    Map<ActionToken, Value>
  >();
  private readonly bus = new EventBus();
  private pending: ButtonTransition[] = [];
  private transitions: readonly ButtonTransition[] = [];
  constructor(
    readonly actions: A,
    private readonly options: {
      scene: Scene;
      input: InputSystem;
      bindings?: ActionBindings<A>;
    },
  ) {
    for (const action of Object.values(actions)) {
      const binding = checkedBinding(
        action,
        options.bindings?.[action.name] ?? {},
      );
      const value = neutral(action);
      this.entries.set(action, {
        value,
        frame: value,
        button: noButton,
        binding,
        defaults: binding,
      });
    }
    if (
      Object.keys(options.bindings ?? {}).some(
        (name) => !Object.hasOwn(actions, name),
      )
    )
      throw new EngineError("INVALID_ACTION", "Unknown action in bindings");
    const off = options.input.registerActions(this);
    try {
      options.scene.claimInput(options.input);
      this.lifetime.onDispose(options.scene.onDispose(() => this.dispose()));
    } catch (error) {
      off();
      throw error;
    }
    this.lifetime.onDispose(off);
    this.keyChanged();
  }
  get disposed(): boolean {
    return this.lifetime.disposed;
  }
  get active(): boolean {
    return (
      !this.disposed &&
      this.options.scene.state === SceneState.Active &&
      this.options.scene.inputOwner === this.options.input
    );
  }
  get sourceCount(): number {
    return this.sources.size;
  }
  onDispose(callback: () => void): () => void {
    return this.lifetime.onDispose(callback);
  }
  private entry(action: ActionToken): Entry {
    if (this.disposed)
      throw new EngineError(
        "OWNER_DISPOSED",
        "Action controller has been disposed",
      );
    const entry = this.entries.get(action);
    if (!entry)
      throw new EngineError(
        "INVALID_ACTION",
        "Action belongs to another definition",
        { action: action.name },
      );
    return entry;
  }
  value<T extends Token<A>>(action: T): ActionValue<T["kind"]> {
    return this.entry(action).frame as ActionValue<T["kind"]>;
  }
  schema(): readonly ActionSchema[] {
    return Object.freeze(
      [...this.entries.keys()]
        .map(({ name, kind, normalize }) =>
          Object.freeze({ name, kind, normalize }),
        )
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    );
  }
  frame(): ActionFrame {
    if (this.disposed)
      throw new EngineError(
        "OWNER_DISPOSED",
        "Action controller has been disposed",
      );
    return Object.freeze({
      values: Object.freeze(
        Object.fromEntries(
          [...this.entries].map(([a, e]) => [a.name, e.frame]),
        ),
      ),
      events: Object.freeze(
        this.transitions.map((e) =>
          Object.freeze({ name: e.action.name, down: e.down }),
        ),
      ),
    });
  }
  reader<T extends Token<A>>(action: T): ActionReader<T["kind"]> {
    this.entry(action);
    const controller = this;
    return Object.freeze({
      scene: this.options.scene,
      kind: action.kind,
      get disposed() {
        return controller.disposed;
      },
      value: () => controller.value(action),
    });
  }
  button(action: ButtonToken<A>): ButtonState {
    return this.entry(action).button;
  }
  pressed(action: ButtonToken<A>): boolean {
    return this.button(action).pressed;
  }
  released(action: ButtonToken<A>): boolean {
    return this.button(action).released;
  }
  get events(): readonly ButtonTransition<ButtonToken<A>>[] {
    return this.transitions as readonly ButtonTransition<ButtonToken<A>>[];
  }
  snapshot(): ActionSnapshot<A> {
    return Object.fromEntries(
      [...this.entries].map(([action, entry]) => [
        action.name,
        {
          kind: action.kind,
          value:
            typeof entry.frame === "object" ? { ...entry.frame } : entry.frame,
          ...(action.kind === "button" ? { button: { ...entry.button } } : {}),
        },
      ]),
    ) as ActionSnapshot<A>;
  }
  onPressed(action: ButtonToken<A>, handler: () => void): () => void {
    this.entry(action);
    return this.bus.on(pressedEvent, (token) => {
      if (token === action) return handler();
    });
  }
  createSource(owner?: LifetimeOwner): ActionSource<A> {
    if (this.disposed || owner?.disposed)
      throw new EngineError("OWNER_DISPOSED", "Input owner has been disposed");
    const source = new ActionSource(this);
    this.sources.set(source, new Map());
    try {
      if (owner) source.own(owner);
    } catch (error) {
      source.dispose();
      throw error;
    }
    return source;
  }
  /** @internal */ write(
    source: ActionSource<A>,
    action: ActionToken,
    value: Value,
  ): void {
    this.options.input.assertWrite(isNeutral(value));
    this.entry(action);
    const values = this.sources.get(source);
    if (!values)
      throw new EngineError(
        "OWNER_DISPOSED",
        "Action source has been disposed",
      );
    values.set(action, value);
    this.recompute(action);
  }
  /** @internal */ clearSource(source: ActionSource<A>, remove: boolean): void {
    const values = this.sources.get(source);
    if (!values) return;
    const actions = [...values.keys()];
    values.clear();
    if (remove) this.sources.delete(source);
    if (!this.disposed) for (const action of actions) this.recompute(action);
  }
  private keyboard(action: ActionToken): Value {
    const binding = this.entry(action).binding;
    const held = (keys: readonly KeyCode[] | undefined) =>
      keys?.some((k) => this.options.input.keyDown(k)) ?? false;
    const axis = (b: Axis1DBinding | undefined) =>
      Number(held(b?.positive)) - Number(held(b?.negative));
    if (action.kind === "button") return held((binding as ButtonBinding).keys);
    if (action.kind === "axis1d") return axis(binding as Axis1DBinding);
    const b = binding as Axis3DBinding;
    return action.kind === "axis2d"
      ? { x: axis(b.x), y: axis(b.y) }
      : { x: axis(b.x), y: axis(b.y), z: axis(b.z) };
  }
  private recompute(action: ActionToken, edges = true): void {
    const entry = this.entry(action);
    let value = this.keyboard(action);
    for (const values of this.sources.values()) {
      const contribution = values.get(action);
      if (contribution === undefined) continue;
      if (typeof value === "boolean") value ||= contribution as boolean;
      else if (typeof value === "number") value += contribution as number;
      else {
        const v = contribution as Axis3DValue;
        value =
          "z" in value
            ? { x: value.x + v.x, y: value.y + v.y, z: value.z + v.z }
            : { x: value.x + v.x, y: value.y + v.y };
      }
    }
    if (typeof value === "number") value = clamp(value);
    else if (typeof value === "object") {
      const x = clamp(value.x),
        y = clamp(value.y),
        z = "z" in value ? clamp(value.z) : 0;
      const length = action.normalize ? Math.max(1, Math.hypot(x, y, z)) : 1;
      value = Object.freeze(
        "z" in value
          ? { x: x / length, y: y / length, z: z / length }
          : { x: x / length, y: y / length },
      );
    }
    if (edges && action.kind === "button" && value !== entry.value)
      this.pending.push(
        Object.freeze({
          action: action as ActionToken<"button">,
          down: value as boolean,
        }),
      );
    entry.value = value;
  }
  /** @internal */ keyChanged(): void {
    // Only the Engine-owned default Scene can retain pre-activation physical taps.
    // Staged Scenes do not accumulate another Scene's keyboard history.
    if (
      this.active ||
      (!this.disposed &&
        this.options.scene.inputOwner === this.options.input &&
        (this.options.scene.state === SceneState.Preparing ||
          this.options.scene.state === SceneState.Ready))
    )
      for (const action of this.entries.keys()) this.recompute(action);
  }
  /** @internal */ accepts(code: KeyCode): boolean {
    return (
      this.active &&
      [...this.entries.values()].some((e) =>
        keyLists(e.binding).some((list) => list.keys.includes(code)),
      )
    );
  }
  /** @internal */ capture(override?: ActionFrame): void {
    if (!this.active) return;
    const tokens = override
      ? new Map([...this.entries.keys()].map((a) => [a.name, a]))
      : undefined;
    this.transitions = override
      ? Object.freeze(
          override.events.map((e) =>
            Object.freeze({
              action: tokens?.get(e.name) as ActionToken<"button">,
              down: e.down,
            }),
          ),
        )
      : Object.freeze(this.pending);
    this.pending = [];
    for (const [action, entry] of this.entries) {
      entry.frame = override
        ? (override.values[action.name] as Value)
        : entry.value;
      if (action.kind === "button") {
        let pressCount = 0,
          releaseCount = 0;
        for (const event of this.transitions)
          if (event.action === action) {
            if (event.down) pressCount++;
            else releaseCount++;
          }
        entry.button = Object.freeze({
          held: entry.frame as boolean,
          pressed: pressCount > 0,
          released: releaseCount > 0,
          pressCount,
          releaseCount,
        });
      }
    }
  }
  /** @internal */ dispatch(): void {
    const errors: unknown[] = [];
    for (const event of this.transitions) {
      if (!this.active) break;
      if (event.down)
        try {
          this.bus.emit(pressedEvent, event.action);
        } catch (error) {
          errors.push(error);
        }
    }
    if (errors.length)
      throw new AggregateError(errors, "Action input handlers failed");
  }
  /** Clears held contributions and unconsumed edges; no synthetic button release. */
  reset(): void {
    for (const values of this.sources.values()) values.clear();
    this.pending = [];
    for (const [action, entry] of this.entries) entry.value = neutral(action);
  }
  getBinding<T extends Token<A>>(action: T): ActionBinding<T["kind"]> {
    return this.entry(action).binding as ActionBinding<T["kind"]>;
  }
  rebind<T extends Token<A>>(
    action: T,
    binding: NoInfer<ActionBinding<T["kind"]>>,
  ): void {
    const checked = checkedBinding(action, binding),
      entry = this.entry(action);
    entry.binding = checked;
    this.pending = this.pending.filter((event) => event.action !== action);
    this.recompute(action, false);
  }
  addBindings<T extends Token<A>>(
    action: T,
    binding: NoInfer<ActionBinding<T["kind"]>>,
  ): void {
    this.rebind(
      action,
      editBinding(
        this.entry(action).binding,
        checkedBinding(action, binding),
        false,
      ) as ActionBinding<T["kind"]>,
    );
  }
  removeBindings<T extends Token<A>>(
    action: T,
    binding: NoInfer<ActionBinding<T["kind"]>>,
  ): void {
    this.rebind(
      action,
      editBinding(
        this.entry(action).binding,
        checkedBinding(action, binding),
        true,
      ) as ActionBinding<T["kind"]>,
    );
  }
  resetBindings(action?: Token<A>): void {
    for (const token of action ? [action] : this.entries.keys())
      this.rebind(
        token as Token<A>,
        this.entry(token).defaults as ActionBinding<Token<A>["kind"]>,
      );
  }
  conflicts(): ReadonlyArray<{
    readonly key: KeyCode;
    readonly bindings: ReadonlyArray<{
      readonly action: Token<A>;
      readonly path: string;
    }>;
  }> {
    const keys = new Map<KeyCode, Array<{ action: Token<A>; path: string }>>();
    for (const [action, entry] of this.entries)
      for (const list of keyLists(entry.binding))
        for (const key of list.keys) {
          const group = keys.get(key) ?? [];
          group.push({ action: action as Token<A>, path: list.path });
          keys.set(key, group);
        }
    return [...keys]
      .filter(([, bindings]) => bindings.length > 1)
      .map(([key, bindings]) => ({ key, bindings }));
  }
  exportBindings(): { version: 1; bindings: ActionBindings<A> } {
    return {
      version: 1,
      bindings: Object.fromEntries(
        [...this.entries].map(([action, entry]) => [
          action.name,
          entry.binding,
        ]),
      ) as ActionBindings<A>,
    };
  }
  importBindings(value: unknown): void {
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("bindings" in value) ||
      !value.bindings ||
      typeof value.bindings !== "object" ||
      Array.isArray(value.bindings) ||
      Object.keys(value).some((key) => key !== "version" && key !== "bindings")
    )
      throw new EngineError(
        "INVALID_BINDING",
        "Expected version 1 binding configuration",
      );
    const data = value.bindings as Record<string, unknown>;
    if (
      Object.keys(data).length !== this.entries.size ||
      Object.keys(data).some((name) => !Object.hasOwn(this.actions, name))
    )
      throw new EngineError(
        "INVALID_ACTION",
        "Binding configuration must contain exactly the defined actions",
      );
    const checked = [...this.entries.keys()].map(
      (action) => [action, checkedBinding(action, data[action.name])] as const,
    );
    for (const [action, binding] of checked)
      this.rebind(
        action as Token<A>,
        binding as ActionBinding<Token<A>["kind"]>,
      );
  }
  dispose(): void {
    if (this.disposed) return;
    cleanupAll(
      [
        () => this.lifetime.dispose(),
        () => this.bus.dispose(),
        ...[...this.sources.keys()].map((source) => () => source.dispose()),
        () => {
          this.entries.clear();
          this.pending = [];
          this.transitions = [];
        },
      ],
      "Action input cleanup failed",
    );
  }
}

/** Read-only, typed dependency injected into Components; no hidden global lookup. */
export interface ActionReader<K extends ActionKind> {
  readonly kind: K;
  readonly scene: Scene;
  readonly disposed: boolean;
  value(): ActionValue<K>;
}
export class ActionSource<A extends ActionSet> extends OwnedInputSource {
  /** @internal */ constructor(
    private readonly controller: ActionController<A>,
  ) {
    super();
  }
  set<T extends Token<A>>(
    action: T,
    value: NoInfer<ActionInputValue<T["kind"]>>,
  ): void {
    const checked = checkedActionValue(action, value);
    if (this.writable(isNeutral(checked)))
      this.controller.write(this, action, checked);
  }
  protected release(remove: boolean): void {
    this.controller.clearSource(this, remove);
  }
}
