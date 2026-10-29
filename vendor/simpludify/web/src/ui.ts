import { cleanupAll } from "@simpludify/core";
export const Layout = { Column: "column", Row: "row", Grid: "grid" } as const;
export type Layout = (typeof Layout)[keyof typeof Layout];
export const Theme = { Dark: "dark", Light: "light" } as const;
export type Theme = (typeof Theme)[keyof typeof Theme];
export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  font: string;
}
export const Themes: Readonly<Record<Theme, ThemeTokens>> = {
  dark: {
    background: "#101922",
    surface: "#172630",
    text: "#eff7f6",
    muted: "#afc4ca",
    accent: "#73e3c0",
    font: "system-ui, sans-serif",
  },
  light: {
    background: "#eaf2ef",
    surface: "#ffffff",
    text: "#17332d",
    muted: "#45645d",
    accent: "#17654f",
    font: "system-ui, sans-serif",
  },
};

export const Placement = {
  Top: "top",
  Center: "center",
  Bottom: "bottom",
} as const;
export type Placement = (typeof Placement)[keyof typeof Placement];
export interface TextBinding {
  readonly text: string;
  setText(text: string): void;
  subscribe(listener: (text: string) => void): () => void;
}
export interface LabelNode extends TextBinding {
  readonly kind: "label";
  readonly muted: boolean;
}
export interface ButtonNode extends TextBinding {
  readonly kind: "button";
  readonly onClick: (signal: AbortSignal) => void | Promise<void>;
}
export interface HoldButtonNode extends TextBinding {
  readonly kind: "hold-button";
  readonly onHold: (held: boolean) => void;
}
export interface PanelNode {
  readonly kind: "panel";
  readonly layout: Layout;
  readonly placement: Placement;
  readonly children: readonly UINode[];
  readonly title?: string;
}
export type UINode = LabelNode | ButtonNode | HoldButtonNode | PanelNode;
function textBinding(text: string): TextBinding {
  let value = text;
  const listeners = new Set<(text: string) => void>();
  let plan: readonly ((text: string) => void)[] = [];
  return {
    get text() {
      return value;
    },
    setText(next) {
      if (next === value) return;
      value = next;
      const errors: unknown[] = [];
      for (const listener of plan)
        if (listeners.has(listener)) {
          try {
            listener(value);
          } catch (error) {
            errors.push(error);
          }
        }
      if (errors.length)
        throw new AggregateError(errors, "Text subscribers failed");
    },
    subscribe(listener) {
      listeners.add(listener);
      plan = [...listeners];
      return () => {
        listeners.delete(listener);
        plan = [...listeners];
      };
    },
  };
}
function withText<T extends object>(node: T, text: string): T & TextBinding {
  return Object.defineProperties(
    node,
    Object.getOwnPropertyDescriptors(textBinding(text)),
  ) as T & TextBinding;
}
export function Label(
  text: string,
  options: { muted?: boolean } = {},
): LabelNode {
  return withText(
    { kind: "label" as const, muted: options.muted ?? false },
    text,
  );
}
export function Button(
  text: string,
  onClick: (signal: AbortSignal) => void | Promise<void>,
): ButtonNode {
  return withText({ kind: "button" as const, onClick }, text);
}
export function HoldButton(
  text: string,
  onHold: (held: boolean) => void,
): HoldButtonNode {
  return withText({ kind: "hold-button" as const, onHold }, text);
}
export function Panel(
  children: readonly UINode[],
  options: { layout?: Layout; title?: string; placement?: Placement } = {},
): PanelNode {
  return {
    kind: "panel",
    children: [...children],
    layout: options.layout ?? Layout.Column,
    placement: options.placement ?? Placement.Top,
    ...(options.title === undefined ? {} : { title: options.title }),
  };
}
export interface MountedUI {
  readonly element: HTMLDivElement;
  dispose(): void;
}
export function mountUI(
  nodes: readonly UINode[],
  onError: (error: unknown) => void,
): MountedUI {
  const element = document.createElement("div");
  element.className = "s-ui";
  const controller = new AbortController(),
    subscriptions: Array<() => void> = [];
  let disposed = false;
  const report = (error: unknown) => {
    try {
      onError(error);
    } catch {
      /* Observers cannot interrupt cleanup. */
    }
  };
  const render = (node: UINode): HTMLElement => {
    if (node.kind === "label") {
      const label = document.createElement("p");
      label.textContent = node.text;
      if (node.muted) label.className = "s-muted";
      subscriptions.push(
        node.subscribe((text) => {
          label.textContent = text;
        }),
      );
      return label;
    }
    if (node.kind === "button" || node.kind === "hold-button") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = node.text;
      subscriptions.push(
        node.subscribe((text) => {
          button.textContent = text;
        }),
      );
      const options = { signal: controller.signal };
      if (node.kind === "button")
        button.addEventListener(
          "click",
          async () => {
            if (button.disabled) return;
            button.disabled = true;
            try {
              await node.onClick(controller.signal);
            } catch (error) {
              if (!controller.signal.aborted) report(error);
            } finally {
              button.disabled = false;
            }
          },
          options,
        );
      else {
        button.classList.add("s-hold");
        button.setAttribute("aria-pressed", "false");
        const pointers = new Set<number>(),
          keys = new Set<string>();
        let held = false;
        const update = () => {
          const next = pointers.size > 0 || keys.size > 0;
          if (held === next) return;
          held = next;
          button.setAttribute("aria-pressed", String(held));
          try {
            node.onHold(held);
          } catch (error) {
            report(error);
          }
        };
        const release = () => {
          pointers.clear();
          keys.clear();
          update();
        };
        button.addEventListener(
          "pointerdown",
          (event) => {
            if (event.button !== 0) return;
            pointers.add(event.pointerId);
            button.setPointerCapture(event.pointerId);
            update();
          },
          options,
        );
        for (const type of [
          "pointerup",
          "pointercancel",
          "lostpointercapture",
        ] as const)
          button.addEventListener(
            type,
            (event) => {
              pointers.delete(event.pointerId);
              update();
            },
            options,
          );
        button.addEventListener(
          "keydown",
          (event) => {
            if (event.code !== "Space" && event.code !== "Enter") return;
            event.preventDefault();
            keys.add(event.code);
            update();
          },
          options,
        );
        button.addEventListener(
          "keyup",
          (event) => {
            if (event.code !== "Space" && event.code !== "Enter") return;
            event.preventDefault();
            keys.delete(event.code);
            update();
          },
          options,
        );
        button.addEventListener(
          "blur",
          () => {
            keys.clear();
            update();
          },
          options,
        );
        window.addEventListener("blur", release, options);
        document.addEventListener(
          "visibilitychange",
          () => {
            if (document.hidden) release();
          },
          options,
        );
        subscriptions.push(release);
      }
      return button;
    }
    const panel = document.createElement("section");
    panel.className = "s-panel s-" + node.layout + " s-" + node.placement;
    if (node.title) {
      const title = document.createElement("h2");
      title.textContent = node.title;
      panel.append(title);
    }
    panel.append(...node.children.map(render));
    return panel;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const cleanup = subscriptions.splice(0).reverse();
    cleanupAll([...cleanup, () => element.remove()], "UI cleanup failed");
  };
  try {
    element.append(...nodes.map(render));
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "UI creation and cleanup failed",
      );
    }
    throw error;
  }
  return { element, dispose };
}
