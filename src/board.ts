import {
	Action,
	defineActions,
	Actor,
	Grid,
	PointerClick,
	Renderable,
	Shape,
	SpriteSheet,
	Tilemap,
	Transform,
	Tween,
	Easing,
	type TweenPlayback,
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
	private previous: World;
	private state: World;
	private selected = "A";
	private progress = 1;
	private animation?: TweenPlayback;
	private cursor: Point = { x: 8, y: 3 };
	constructor(
		private readonly context: SceneContext,
		private readonly stage: Stage,
		initial: World,
		select: (id: string) => void,
		pick: (point: Point) => void,
		canTarget: () => boolean,
	) {
		this.previous = this.state = initial;
		this.map = new Tilemap<Tile>({
			id: "building",
			sheet: tiles,
			tiles: Grid.generate<Tile>(
				stage.rows[0].length,
				stage.rows.length,
				(x, y) => (stage.rows[y][x] === "#" ? "wall" : "floor"),
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
			this.cursor = { x: cell.x, y: cell.y };
			pick(this.cursor);
		});
		const keys = defineActions({
			Left: Action.button(),
			Right: Action.button(),
			Up: Action.button(),
			Down: Action.button(),
			Confirm: Action.button(),
		});
		const controls = context.actions(keys, {
			Left: { keys: ["ArrowLeft"] },
			Right: { keys: ["ArrowRight"] },
			Up: { keys: ["ArrowUp"] },
			Down: { keys: ["ArrowDown"] },
			Confirm: { keys: ["Enter", "Space"] },
		});
		for (const [action, dx, dy] of [
			[keys.Left, -1, 0],
			[keys.Right, 1, 0],
			[keys.Up, 0, -1],
			[keys.Down, 0, 1],
		] as const)
			controls.onPressed(action, () => {
				if (!canTarget()) return;
				this.cursor = {
					x: Math.max(0, Math.min(this.map.width - 1, this.cursor.x + dx)),
					y: Math.max(0, Math.min(this.map.height - 1, this.cursor.y + dy)),
				};
				pick(this.cursor);
			});
		controls.onPressed(keys.Confirm, () => {
			if (!canTarget()) return;
			const person = this.state.people.find(
				(p) => !p.escaped && same(p, this.cursor),
			);
			if (person) select(person.id);
			pick(this.cursor);
		});
		this.sync(initial, false);
	}
	sync(state: World, animate: boolean, duration = 0.24): void {
		// Finish an interrupted display transition before replacing its immutable endpoints.
		this.animation?.finish();
		this.previous = this.state;
		this.state = state;
		this.progress = animate ? 0 : 1;
		if (animate) {
			this.animation = this.context.scene.presentationTweens.play(
				Tween.to(
					Tween.bind({
						target: this,
						key: "progress",
						owner: this.context.scene,
						read: () => this.progress,
						write: (value) => {
							this.progress = value;
							this.draw();
						},
					}),
					1,
					{ from: 0, duration, easing: Easing.InOutCubic },
				),
			);
		}
		for (const door of this.stage.doors)
			this.map.set(
				door.x,
				door.y,
				state.doors.find((d) => d.id === door.id)?.open ? "open" : "closed",
			);
		this.draw();
	}
	select(id: string): void {
		this.selected = id;
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
		const alpha = this.progress;
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
