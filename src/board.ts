import {
  Actor,
  CanvasButton,
  CanvasColumn,
  CanvasLabel,
  CanvasPanel,
  CanvasRow,
  Grid,
  PointerClick,
  Renderable,
  Shape,
  SpriteSheet,
  Tilemap,
  Transform,
  type CanvasNode,
  type Game,
  type SceneContext,
} from "@simpludify/web";
import { same, type Point, type Stage, type World } from "./model";
export const TILE = 48,
  OX = 56,
  OY = 32;
const tiles = SpriteSheet.grid(
  new URL("./assets/tiles.svg", import.meta.url).href,
  {
    frameWidth: 48,
    frameHeight: 48,
    names: { floor: 0, wall: 1, s1: 2, s2: 3, closed: 4, open: 5, exit: 6 },
  },
);
const peopleSheet = SpriteSheet.grid(
  new URL("./assets/people.svg", import.meta.url).href,
  { frameWidth: 48, frameHeight: 48 },
);
type Tile = "floor" | "wall" | "s1" | "s2" | "closed" | "open" | "exit";
export class Board {
  private readonly map: Tilemap<Tile>;
  private readonly people = new Map<
    string,
    { actor: Actor; position: Transform; visual: Renderable }
  >();
  private readonly outlines: { position: Transform; visual: Renderable }[] = [];
  private readonly buttons = new Map<string, CanvasNode>();
  private readonly stepLabel: CanvasNode;
  private readonly hint: CanvasNode;
  private previous: World;
  private state: World;
  private selected = "A";
  private elapsed = 1;
  private duration = 0.2;
  constructor(
    game: Game,
    context: SceneContext,
    private readonly stage: Stage,
    initial: World,
    select: (id: string) => void,
    pick: (point: Point) => void,
  ) {
    this.previous = this.state = initial;
    this.map = new Tilemap<Tile>({
      id: "building",
      sheet: tiles,
      tiles: Grid.generate<Tile>(11, 8, (x, y) =>
        stage.rows[y][x] === "#" ? "wall" : "floor",
      ),
      tileWidth: TILE,
      tileHeight: TILE,
      x: OX,
      y: OY,
    }).place(context.scene);
    stage.switches.forEach((s, i) =>
      this.map.set(s.x, s.y, i === 0 ? "s1" : "s2"),
    );
    stage.exits.forEach((e) => this.map.set(e.x, e.y, "exit"));
    this.stepLabel = CanvasLabel("STEP 00", {
      fontSize: 16,
      color: 0xd8e7e7,
      grow: 1,
      alignSelf: "center",
    });
    this.hint = CanvasLabel("人物を選択 → マスをタップして目的地を指定", {
      fontSize: 12,
      color: 0xa5bdc8,
      textWrap: false,
    });
    const characterButtons = stage.people.map((p) => {
      const button = CanvasButton(`${p.id} ${p.name}`, () => select(p.id), {
        minHeight: 44,
        width: 92,
        fontSize: 15,
        background: 0x243a49,
        radius: 8,
        color: p.color,
        shrink: 0,
      });
      this.buttons.set(p.id, button);
      return button;
    });
    context.canvasUI(
      CanvasColumn(
        [
          CanvasRow([...characterButtons, this.stepLabel], {
            gap: 8,
            minHeight: 44,
            shrink: 0,
          }),
          CanvasPanel([], { grow: 1 }),
          this.hint,
        ],
        { padding: 10, gap: 6 },
      ),
    );
    for (const [i, p] of stage.people.entries()) {
      const actor = new Actor({ id: `person-${p.id}` });
      const position = actor.add(new Transform());
      const visual = actor.add(
        new Renderable({
          width: 42,
          height: 42,
          source: peopleSheet.get(i),
          zIndex: 4,
        }),
      );
      context.add(actor);
      this.people.set(p.id, { actor, position, visual });
    }
    for (let i = 0; i < 16; i++) {
      const actor = new Actor();
      const position = actor.add(new Transform());
      const visual = actor.add(
        new Renderable({
          width: 46,
          height: 3,
          color: 0xf0ce8a,
          visible: false,
          zIndex: 5,
          source: { kind: "shape", shape: Shape.Box },
        }),
      );
      context.add(actor);
      this.outlines.push({ position, visual });
    }
    context.pointer.events.on(PointerClick, (event) => {
      const cell = this.map.worldToTile(event.world.x, event.world.y);
      if (!cell) return;
      const person = this.state.people.find((p) => !p.escaped && same(p, cell));
      if (person) select(person.id);
      pick({ x: cell.x, y: cell.y });
    });
    const resize = () => {
      const width = game.element.clientWidth,
        height = game.element.clientHeight;
      if (width && height)
        game.setViewport({
          x: 0,
          y: 64,
          width,
          height: Math.max(1, height - 96),
        });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(game.element);
    context.onActivate(resize);
    context.onDispose(() => observer.disconnect());
    context.onUpdate((seconds) => {
      this.elapsed += seconds;
      this.draw();
    });
    this.sync(initial, false);
  }
  sync(state: World, animate: boolean, duration = 0.24): void {
    this.previous = this.state;
    this.state = state;
    this.duration = duration;
    this.elapsed = animate ? 0 : duration;
    for (const door of this.stage.doors)
      this.map.set(
        door.x,
        door.y,
        state.doors.find((d) => d.id === door.id)?.open ? "open" : "closed",
      );
    this.stepLabel.setText(`STEP ${String(state.step).padStart(2, "0")}`);
    this.draw();
  }
  select(id: string): void {
    this.selected = id;
    this.buttons.forEach((b, actor) =>
      b.setStyle({ background: actor === id ? 0x405663 : 0x243a49 }),
    );
    this.draw();
  }
  focus(cells: Point[] = []): void {
    this.outlines.forEach((o) => (o.visual.visible = false));
    const selected = this.state.people.find(
      (p) => p.id === this.selected && !p.escaped,
    );
    const targets = [...(selected ? [selected] : []), ...cells].slice(0, 4);
    targets.forEach((p, i) => {
      const cx = OX + (p.x + 0.5) * TILE,
        cy = OY + (p.y + 0.5) * TILE;
      [
        [cx, cy - 23, 46, 3],
        [cx, cy + 23, 46, 3],
        [cx - 23, cy, 3, 46],
        [cx + 23, cy, 3, 46],
      ].forEach(([x, y, w, h], j) => {
        const o = this.outlines[i * 4 + j];
        o.position.x = x;
        o.position.y = y;
        o.visual.width = w;
        o.visual.height = h;
        o.visual.visible = true;
        o.visual.color = i === 0 && selected ? 0xe8f1df : 0xf1bf6c;
      });
    });
  }
  private draw(): void {
    const t = Math.min(1, this.elapsed / this.duration),
      alpha = t * t * (3 - 2 * t);
    for (const p of this.state.people) {
      const old = this.previous.people.find((o) => o.id === p.id)!,
        view = this.people.get(p.id)!;
      view.position.x = OX + (old.x + (p.x - old.x) * alpha + 0.5) * TILE;
      view.position.y = OY + (old.y + (p.y - old.y) * alpha + 0.5) * TILE;
      view.visual.visible = !p.escaped || (!old.escaped && alpha < 1);
      view.visual.opacity = p.escaped ? 1 - alpha : 1;
    }
  }
}
