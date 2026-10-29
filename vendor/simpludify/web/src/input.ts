import { type InputSystem, isKeyCode } from "@simpludify/core";
/** Keyboard belongs to the focused game surface; native controls keep their keys. */
export class BrowserInput {
  private readonly controller = new AbortController();
  constructor(host: HTMLElement, input: InputSystem) {
    const source = input.createKeyboardSource();
    let composing = false;
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest("input, textarea, select, button"));
    const down = (event: KeyboardEvent) => {
      if (
        composing ||
        event.isComposing ||
        event.keyCode === 229 ||
        editable(event.target)
      )
        return;
      if (!isKeyCode(event.code) || !input.acceptsKey(event.code)) return;
      event.preventDefault();
      // A cleared held key must be pressed afresh after pause/focus changes.
      if (!event.repeat) source.set(event.code, true);
    };
    const up = (event: KeyboardEvent) => {
      if (isKeyCode(event.code)) source.set(event.code, false);
    };
    const options = { signal: this.controller.signal };
    host.addEventListener("keydown", down, options);
    host.addEventListener(
      "compositionstart",
      () => {
        composing = true;
        source.clear();
      },
      options,
    );
    host.addEventListener(
      "compositionend",
      () => {
        composing = false;
      },
      options,
    );
    window.addEventListener("keyup", up, options);
    window.addEventListener(
      "blur",
      () => {
        composing = false;
        source.clear();
      },
      options,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) source.clear();
      },
      options,
    );
    host.addEventListener(
      "focusout",
      (event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !host.contains(event.relatedTarget) ||
          editable(event.relatedTarget)
        ) {
          composing = false;
          source.clear();
        }
      },
      options,
    );
    host.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.defaultPrevented && !editable(event.target))
          host.focus({ preventScroll: true });
      },
      options,
    );
    this.clear = () => source.dispose();
  }
  private readonly clear: () => void;
  dispose(): void {
    this.controller.abort();
    this.clear();
  }
}
