import {
	CanvasButton,
	CanvasColumn,
	CanvasLabel,
	CanvasPanel,
	CanvasRow,
	CanvasScroll,
	CanvasSelect,
	CanvasTextInput,
	Game,
	type CanvasNode,
	type CanvasStyle,
	type CanvasUI,
	type SceneContext,
} from "@simpludify/web";
import { Board } from "./board";
import {
	commandText,
	emptyPlan,
	initialWorld,
	same,
	startRun,
	stepRun,
	type Command,
	type Direction,
	type LogEntry,
	type Plan,
	type Point,
	type Run,
} from "./model";
import { collisionExample, solution, stage } from "./stage";
import "./style.css";

function errorText(error: unknown): string {
	return error instanceof AggregateError
		? error.errors.map(errorText).join("; ")
		: String(error);
}
export const game = new Game({
	parent: document.querySelector<HTMLElement>("#app")!,
	resolution: { width: 640, height: 448 },
	maxDelta: 0.25,
	tokens: { background: "#101f2a" },
	onError: (e) =>
		screen?.runNote.setText(
			`ゲームの起動または描画に失敗しました：${errorText(e)}`,
		),
});
export let screen: ReturnType<typeof createScreen>;
game.scene("puzzle", (context) => {
	screen = createScreen(context);
});
function createScreen(context: SceneContext) {
	const colors = {
		surface: 0x192e3c,
		raised: 0x254151,
		accent: 0x416c76,
		text: 0xe4eeee,
		muted: 0xa9c3cd,
	};
	const small: CanvasStyle = { fontSize: 14, color: colors.muted, shrink: 0 };
	const control: CanvasStyle = {
		fontSize: 15,
		minHeight: 44,
		padding: 10,
		background: colors.raised,
		shrink: 0,
	};
	const label = (text: string, style: CanvasStyle = {}) =>
		CanvasLabel(text, { ...small, ...style });
	const button = (text: string, action: () => void, style: CanvasStyle = {}) =>
		CanvasButton(text, action, { ...control, ...style });
	const field = (name: string, value: string) =>
		CanvasTextInput(
			{ label: name, value },
			{ ...control, width: "100%", height: 44 },
		);
	const choose = <T extends string>(
		name: string,
		options: readonly (readonly [T, string])[],
		value: T,
	) =>
		CanvasSelect(
			options.map(([value, label]) => ({ value, label })),
			{ label: name, value },
			{ ...control, width: "100%", height: 44 },
		);
	let draft: Plan = emptyPlan(stage),
		selected = "A",
		run: Run | null = null;
	let playing = false,
		accumulator = 0,
		board: Board | undefined,
		ui: CanvasUI;
	let pendingFocus: CanvasNode | undefined;
	let highlighted: { actor: string; index: number } | null = null;
	let selectedLog: LogEntry | undefined;
	let tab = "map",
		compact = false,
		logPage = 0;
	const PAGE_SIZE = 80;
	const initial = initialWorld(stage);
	const world = () => run?.state ?? initial;
	const status = label("計画中", { fontSize: 16, color: colors.text });
	const runNote = label("人物を選び、命令を追加しよう。"),
		outcome = label("");
	const gate = label(""),
		positions = label(""),
		target = label("対象 (8, 3)");
	const draftBadge = label("編集中"),
		error = label("", { color: 0xffb2a6 });
	const play = button("▶ 再生開始", () => {
		if (!run) newRun();
		playing = !playing;
		accumulator = 0;
		renderStatus();
	});
	const step = button("1 ステップ →", () => {
		playing = false;
		accumulator = 0;
		takeStep();
	});
	const restart = button("↻ 再実行", () => {
		newRun();
		playing = true;
		renderStatus();
	});
	const speed = choose(
		"再生速度",
		[
			["0.5", "0.5×"],
			["1", "1×"],
			["2", "2×"],
			["4", "4×"],
		],
		"1",
	);
	speed.setStyle({ width: 0, grow: 1, minWidth: 0 });
	speed.onChange(() => {
		accumulator = 0;
	});
	const region = CanvasPanel([], {
		grow: 1,
		minHeight: 100,
		pointerEvents: "none",
	});
	const mapPanel = CanvasColumn(
		[
			label("01 / ふたつの合図", { fontSize: 20, color: colors.text }),
			label("S1とS2を同時に操作 → ゲート開放6ステップ"),
			region,
			positions,
			gate,
			CanvasRow([play, step, restart], { gap: 6, wrap: true, shrink: 0 }),
			CanvasRow([label("速度", { alignSelf: "center" }), speed], {
				gap: 8,
				shrink: 0,
			}),
			runNote,
			outcome,
		],
		{ gap: 8, padding: 12, grow: 1, minWidth: 0 },
	);

	const kind = choose(
		"追加する命令",
		[
			["move", "方向へ移動"],
			["go", "座標まで自動移動"],
			["interact", "設備を操作"],
			["wait", "ステップ数で待機"],
			["until", "条件が成立するまで待機"],
		],
		"move",
	);
	const direction = choose<Direction>(
		"方向",
		[
			["up", "↑ 上"],
			["right", "→ 右"],
			["down", "↓ 下"],
			["left", "← 左"],
		],
		"up",
	);
	const moveCount = field("マス数", "1"),
		x = field("X 座標", "8"),
		y = field("Y 座標", "3");
	const waitCount = field("待機するステップ数", "1"),
		cx = field("待機対象 X", "4"),
		cy = field("待機対象 Y", "3");
	const device = choose(
		"スイッチ",
		[
			["s1", "S1 · (2, 2)"],
			["s2", "S2 · (2, 6)"],
		],
		"s1",
	);
	const condition = choose(
		"待つ条件",
		[
			["open", "ゲートが開く"],
			["closed", "ゲートが閉じる"],
			["escaped", "もう1人が脱出する"],
			["at", "もう1人が指定座標に来る"],
		],
		"open",
	);
	const fields = new Map([
		[
			"move",
			CanvasColumn(
				[label("方向"), direction, label("マス数（1〜50）"), moveCount],
				{ gap: 6, shrink: 0 },
			),
		],
		[
			"go",
			CanvasColumn(
				[
					label("X 座標（0〜10）"),
					x,
					label("Y 座標（0〜7）"),
					y,
					label("マップをタップしても指定できます。"),
				],
				{ gap: 6, shrink: 0 },
			),
		],
		[
			"interact",
			CanvasColumn([label("操作するスイッチ"), device], { gap: 6, shrink: 0 }),
		],
		[
			"wait",
			CanvasColumn([label("待機するステップ数（1〜100）"), waitCount], {
				gap: 6,
				shrink: 0,
			}),
		],
	]);
	const conditionPosition = CanvasColumn(
		[label("待機対象 X（0〜10）"), cx, label("待機対象 Y（0〜7）"), cy],
		{ gap: 6, shrink: 0 },
	);
	fields.set(
		"until",
		CanvasColumn(
			[
				label("待つ条件"),
				condition,
				conditionPosition,
				label("条件の判定と解除に1ステップ。その翌ステップに次の命令へ。"),
			],
			{ gap: 6, shrink: 0 },
		),
	);
	function showFields(): void {
		fields.forEach((node, name) => {
			node.visible = name === kind.value;
		});
		conditionPosition.visible = condition.value === "at";
		error.setText("");
	}
	kind.onChange(showFields);
	condition.onChange(showFields);
	showFields();
	function integer(
		input: ReturnType<typeof field>,
		min: number,
		max: number,
	): number {
		const raw = input.editing ? input.draft.text : input.value;
		const value = Number(raw);
		if (
			input.draft.composing ||
			!raw.trim() ||
			!Number.isSafeInteger(value) ||
			value < min ||
			value > max
		)
			throw new Error(
				`${input.text}：${min}〜${max} の整数を入力してください。`,
			);
		input.commit();
		return value;
	}
	const add = button(
		"＋ 命令を追加",
		() => {
			try {
				if (draft[selected].length >= 50)
					throw new Error("1人につき50命令まで追加できます。");
				let command: Command;
				switch (kind.value) {
					case "move":
						command = {
							kind: "move",
							direction: direction.value!,
							count: integer(moveCount, 1, 50),
						};
						break;
					case "go":
						command = { kind: "go", x: integer(x, 0, 10), y: integer(y, 0, 7) };
						break;
					case "interact":
						command = { kind: "interact", target: device.value! };
						break;
					case "wait":
						command = { kind: "wait", steps: integer(waitCount, 1, 100) };
						break;
					default: {
						const actor = selected === "A" ? "B" : "A";
						command = {
							kind: "until",
							condition:
								condition.value === "escaped"
									? { kind: "escaped", actor }
									: condition.value === "at"
										? {
												kind: "at",
												actor,
												x: integer(cx, 0, 10),
												y: integer(cy, 0, 7),
											}
										: {
												kind: "door",
												door: "gate",
												open: condition.value === "open",
											},
						};
					}
				}
				draft[selected].push(command);
				pendingFocus = add;
				highlighted = null;
				error.setText("");
				renderCommands();
				renderStatus();
			} catch (e) {
				error.setText((e as Error).message);
				pendingFocus = add;
			}
		},
		{ background: colors.accent },
	);
	const commands = CanvasColumn([], { gap: 6, shrink: 0 });
	const snapshot = CanvasColumn([], { gap: 6, shrink: 0 });
	let snapshotOpen = false;
	const snapshotToggle = button("現在実行中の計画を表示", () => {
		snapshotOpen = !snapshotOpen;
		snapshot.visible = snapshotOpen;
		snapshotToggle.setText(
			snapshotOpen ? "現在実行中の計画を隠す" : "現在実行中の計画を表示",
		);
		renderSnapshot();
	});
	snapshot.visible = false;
	const peopleButtons = stage.people.map((p) =>
		button(`${p.id} ${p.name}`, () => select(p.id), { grow: 1 }),
	);
	const editor = CanvasScroll(
		[
			label("行動を計画する", { fontSize: 20, color: colors.text }),
			draftBadge,
			CanvasRow(peopleButtons, { gap: 8, shrink: 0 }),
			target,
			commands,
			label("追加する命令"),
			kind,
			...fields.values(),
			error,
			add,
			snapshotToggle,
			snapshot,
		],
		{ grow: 1, minWidth: 0, padding: 12, gap: 10, background: colors.surface },
	);
	const filter = choose(
		"ログ表示",
		[
			["important", "重要イベント"],
			["all", "すべて"],
		],
		"important",
	);
	const logItems = CanvasColumn([], { gap: 6, shrink: 0 });
	const logRange = label("");
	const previous = button("前の80件", () => {
		logPage--;
		renderLog(true);
	});
	const next = button("次の80件", () => {
		logPage++;
		renderLog(true);
	});
	const logScroll = CanvasScroll([logItems], { grow: 1, minHeight: 100 });
	const logs = CanvasColumn(
		[
			label("実行ログ", { fontSize: 20, color: colors.text }),
			filter,
			label("イベントを選ぶと、関係するマスと実行時の命令を強調します。"),
			logRange,
			CanvasRow([previous, next], { gap: 8, shrink: 0 }),
			logScroll,
		],
		{ grow: 1, minWidth: 0, padding: 12, gap: 10, background: colors.surface },
	);
	filter.onChange(() => {
		logPage = 0;
		renderLog(true);
	});
	const load = (plan: Plan) => {
		draft = structuredClone(plan);
		highlighted = null;
		renderCommands();
		renderStatus();
	};
	const help = CanvasScroll(
		[
			label("はじめての脱出計画", { fontSize: 20, color: colors.text }),
			label("1. A・Bそれぞれに命令を追加。近くのスイッチを操作してみよう。"),
			label(
				"2. 再生か1ステップで、全員が同時に行動。スイッチの効果は翌ステップから。",
			),
			label(
				"3. ゲートが開いている間に、2人を出口へ。同じマスへの進入・追従・位置交換はConflict。待機でタイミングを調整しよう。",
			),
			label(
				"操作範囲は同じマスか上下左右の隣。条件待機の解除にも1ステップ使います。座標は左上が(0,0)。",
			),
			label(
				"マップ：Aは(2,3)、Bは(2,5)。S1は(2,2)、S2は(2,6)、扉は(5,3)、出口は(8,3)。中央の壁は扉だけ通れます。",
			),
			label(
				"キーボード：Tabで操作を選び、Enter・Spaceで実行。入力欄と選択欄の矢印キーは入力専用。マップにフォーカスしたときだけ矢印でマスを選択。",
			),
			label(
				"スマホ：上のタブでマップ・命令・ログを切り替え。長い命令やログは指でスクロール。命令の↑↓で並べ替え、×で削除。",
			),
			label(
				"編集中の変更は次回の再実行から反映。再生開始時の計画は固定されます。",
			),
			label(
				"ヒント：Aは先に中央通路を進み、Bは右へ2マス、上へ2マス進んで追いかけると混雑を避けられます。",
			),
			button("攻略例をセット", () => load(solution)),
			button("衝突例をセット", () => load(collisionExample)),
			label("攻略例・衝突例は編集中の命令を置き換えます。"),
		],
		{ grow: 1, minWidth: 0, padding: 12, gap: 16, background: colors.surface },
	);
	const content = CanvasRow([mapPanel, editor, logs, help], {
		grow: 1,
		minHeight: 0,
		gap: 10,
	});
	const tabs = ["マップ", "命令", "ログ", "遊び方"].map((text, i) =>
		button(text, () => setTab(["map", "editor", "logs", "help"][i]), {
			grow: 1,
			padding: 6,
			fontSize: 14,
			minWidth: 0,
		}),
	);
	function setTab(value: string): void {
		tab = value;
		responsive();
	}
	function responsive(): void {
		mapPanel.visible = !compact || tab === "map";
		editor.visible = tab === "editor" || (!compact && tab === "map");
		logs.visible = tab === "logs";
		help.visible = tab === "help";
		mapPanel.setStyle({ grow: 1.25 });
		tabs.forEach((node, i) =>
			node.setStyle({
				background:
					["map", "editor", "logs", "help"][i] === tab
						? colors.accent
						: colors.raised,
			}),
		);
	}
	const root = CanvasColumn(
		[
			CanvasRow(
				[
					label("RUN TO EXIT", { fontSize: 20, color: colors.text, grow: 1 }),
					status,
				],
				{ gap: 8, wrap: true, shrink: 0 },
			),
			CanvasRow(tabs, { gap: 5, shrink: 0 }),
			content,
		],
		{ height: "100%", padding: 10, gap: 10 },
	);
	function select(id: string): void {
		selected = id;
		board?.select(id);
		highlighted = null;
		renderCommands();
		renderStatus();
		board?.focus(run?.conflict?.cells);
	}
	function pick(point: Point): void {
		x.value = cx.value = String(point.x);
		y.value = cy.value = String(point.y);
		target.setText(`対象 (${point.x}, ${point.y})`);
		const found = stage.switches.find((s) => same(s, point));
		if (found) {
			kind.value = "interact";
			device.value = found.id as "s1" | "s2";
		} else if (!world().people.some((p) => !p.escaped && same(p, point)))
			kind.value = "go";
		board?.focus([point]);
	}
	// Keep row identity across simulation updates; rebuild only after an actual draft edit.
	let commandRows: {
		row: CanvasNode;
		text: CanvasNode;
		actions: CanvasNode[];
		command: Command;
	}[] = [];
	let renderedPerson = "";
	function renderCommands(): void {
		if (
			renderedPerson !== selected ||
			commandRows.length !== draft[selected].length ||
			commandRows.some((row, i) => row.command !== draft[selected][i])
		) {
			const append =
				renderedPerson === selected &&
				commandRows.length > 0 &&
				commandRows.length < draft[selected].length &&
				commandRows.every((row, i) => row.command === draft[selected][i]);
			if (!append) {
				commands.clear();
				commandRows = [];
			}
			const start = commandRows.length;
			renderedPerson = selected;
			commandRows.push(
				...draft[selected].slice(start).map((command, offset) => {
					const index = start + offset;
					const text = label(`${index + 1}. ${commandText(command)}`, {
						color: colors.text,
					});
					const actions = (
						[
							[-1, "上へ移動", "↑"],
							[1, "下へ移動", "↓"],
							[0, "削除", "×"],
						] as const
					).map(([delta, title, glyph]) => {
						const action = button(
							`命令 ${index + 1} を${title} ${glyph}`,
							() => {
								const items = draft[selected];
								if (!delta) items.splice(index, 1);
								else
									[items[index], items[index + delta]] = [
										items[index + delta],
										items[index],
									];
								highlighted = null;
								renderCommands();
								renderStatus();
								const at = Math.max(
									0,
									Math.min(commandRows.length - 1, index + delta),
								);
								const focus =
									commandRows[at]?.actions.find((n) => n.enabled) ?? add;
								pendingFocus = focus;
							},
							{ grow: 1, padding: 6, fontSize: 12, minWidth: 0 },
						);
						action.enabled =
							!(delta === -1 && index === 0) &&
							!(delta === 1 && index === draft[selected].length - 1);
						return action;
					});
					const row = CanvasColumn(
						[text, CanvasRow(actions, { gap: 4, shrink: 0 })],
						{ gap: 6, padding: 8, background: colors.raised, shrink: 0 },
					);
					commands.add(row);
					return { row, text, actions, command };
				}),
			);
			if (!commandRows.length)
				commands.add(
					label(
						"ここから脱出計画がはじまる。下のメニューから命令を追加しよう。",
					),
				);
		}
		for (const [index, row] of commandRows.entries()) {
			row.actions[1].enabled = index < commandRows.length - 1;
			const active =
				run &&
				JSON.stringify(run.plan[selected]?.[index]) ===
					JSON.stringify(row.command) &&
				world().people.find((p) => p.id === selected)?.pc === index;
			row.row.setStyle({
				background:
					highlighted?.actor === selected &&
					highlighted.index === index &&
					run &&
					JSON.stringify(run.plan[selected]?.[index]) ===
						JSON.stringify(row.command)
						? 0x685237
						: active
							? 0x345f63
							: colors.raised,
			});
		}
		peopleButtons.forEach((node, i) =>
			node.setStyle({
				background:
					stage.people[i].id === selected ? colors.accent : colors.raised,
			}),
		);
	}
	let snapshotPlan: Plan | undefined;
	let snapshotRendered = false;
	let snapshotRows: { actor: string; index: number; node: CanvasNode }[] = [];
	function renderSnapshot(): void {
		if (!snapshotOpen) return;
		if (!snapshotRendered || snapshotPlan !== run?.plan) {
			snapshotRendered = true;
			snapshot.clear();
			snapshotRows = [];
			snapshotPlan = run?.plan;
			if (!run) snapshot.add(label("再生開始時に計画を固定します。"));
			else
				for (const person of stage.people) {
					snapshot.add(label(`${person.id} ${person.name}`));
					for (const [index, c] of run.plan[person.id].entries()) {
						const node = label(`${index + 1}. ${commandText(c)}`);
						snapshot.add(node);
						snapshotRows.push({ actor: person.id, index, node });
					}
				}
		}
		for (const row of snapshotRows) {
			const chosen =
				highlighted?.actor === row.actor && highlighted.index === row.index;
			const active =
				world().people.find((p) => p.id === row.actor)?.pc === row.index;
			row.node.setStyle({
				color: chosen ? 0xffd28c : active ? 0x95e2c2 : colors.muted,
			});
		}
	}
	function renderStatus(): void {
		const state = world(),
			changed = run && JSON.stringify(draft) !== JSON.stringify(run.plan);
		status.setText(
			run?.conflict
				? "Conflict で停止"
				: state.cleared
					? "全員脱出！"
					: playing
						? "実行中"
						: run
							? "一時停止"
							: "計画中",
		);
		play.enabled = step.enabled = !run?.conflict && !state.cleared;
		play.setText(playing ? "Ⅱ 一時停止" : run ? "▶ 再開" : "▶ 再生開始");
		draftBadge.setText(
			`${selected} の次回実行する計画 / ${draft[selected].length}命令 / ${changed ? "次回用の変更あり" : "編集中"}`,
		);
		positions.setText(
			state.people
				.map((p) => `${p.id} ${p.escaped ? "脱出済み" : `(${p.x}, ${p.y})`}`)
				.join(" · "),
		);
		const door = state.doors[0];
		gate.setText(
			door.open
				? `次の Step ${state.step + 1}：開放 / ${door.until} まで`
				: `次の Step ${state.step + 1}：ゲート閉鎖`,
		);
		runNote.setText(
			`世界 Step ${state.step}。${changed ? "編集中の変更は再実行から適用。現在の計画は固定済み。" : run ? "実行計画は固定済み。編集は次回に適用。" : "人物を選び、命令を追加しよう。"}`,
		);
		const c = run?.conflict;
		outcome.setText(
			c
				? `Step ${c.step}：${c.kind}\n${c.message}\n関係者 ${c.actors.join("・")} / 最後に確定した Step ${state.step}\n${c.commands.map((c) => `${c.actor} 命令${c.index + 1}：${c.command ? commandText(c.command) : "命令なし"}`).join(" / ")}`
				: state.cleared
					? `計画成功。全員、無事に脱出！ ${state.step} ステップでクリア。`
					: "",
		);
		outcome.visible = !!c || state.cleared;
		outcome.setStyle({ color: c ? 0xffb2a6 : 0x95e2c2 });
		renderCommands();
		renderSnapshot();
	}
	let shownEntries: LogEntry[] = [];
	const logButtons = new Map<LogEntry, CanvasNode>();
	function renderLog(reset = false): void {
		const entries = (run?.logs ?? []).filter(
			(l) =>
				filter.value === "all" ||
				!["start", "complete", "move", "wait"].includes(l.kind),
		);
		logPage = Math.max(
			0,
			Math.min(logPage, Math.ceil(entries.length / PAGE_SIZE) - 1),
		);
		const start = logPage * PAGE_SIZE,
			page = entries.slice(start, start + PAGE_SIZE);
		const append =
			!reset &&
			shownEntries.length <= page.length &&
			shownEntries.every((e, i) => e === page[i]);
		if (!append || !shownEntries.length) {
			logItems.clear();
			logButtons.clear();
		}
		for (const entry of page.slice(append ? shownEntries.length : 0)) {
			const node = button(
				`Step ${entry.step} ${entry.actors.join("・") || "SYS"}：${entry.text}`,
				() => focusLog(entry),
				{ fontSize: 14 },
			);
			logItems.add(node);
			logButtons.set(entry, node);
		}
		if (!page.length)
			logItems.add(
				label(
					run
						? "重要イベントはまだありません。「すべて」で移動や待機を確認できます。"
						: "まだ実行していません。",
				),
			);
		shownEntries = page;
		for (const [entry, node] of logButtons)
			node.setStyle({
				background: entry === selectedLog ? 0x685237 : colors.raised,
			});
		logRange.setText(
			`${entries.length}件 / ${page.length ? start + 1 : 0}〜${start + page.length}件（80件ずつ表示）`,
		);
		previous.enabled = logPage > 0;
		next.enabled = start + PAGE_SIZE < entries.length;
		if (reset) logScroll.scrollTo(0, 0);
	}
	function focusLog(entry: LogEntry): void {
		selectedLog = entry;
		if (entry.actors[0]) select(entry.actors[0]);
		const actor = entry.actors[0];
		const index =
			entry.command ??
			(entry.kind === "conflict"
				? run?.conflict?.commands.find((c) => c.actor === actor)?.index
				: undefined);
		highlighted = actor && index !== undefined ? { actor, index } : null;
		snapshotOpen = true;
		snapshot.visible = true;
		snapshotToggle.setText("現在実行中の計画を隠す");
		renderCommands();
		renderSnapshot();
		board?.focus(entry.cells);
		renderLog();
		// The fixed snapshot remains the authoritative instruction when the draft has changed.
		if (entry.command !== undefined)
			runNote.setText(
				`Step ${entry.step}：${entry.text} / 実行時の命令 ${entry.command + 1}。編集中の計画とは別の記録です。`,
			);
	}
	function newRun(): void {
		run = startRun(stage, draft);
		accumulator = 0;
		highlighted = null;
		selectedLog = undefined;
		logPage = 0;
		board?.sync(run.state, false);
		board?.focus();
		renderStatus();
		renderLog(true);
	}
	function takeStep(): void {
		if (!run) newRun();
		run = stepRun(run!);
		if (run.conflict || run.state.cleared) playing = false;
		board?.sync(run.state, true, 0.25 / Number(speed.value));
		board?.focus(run.conflict?.cells);
		renderStatus();
		renderLog();
	}

	ui = context.canvasUI(root);
	game.bindViewport(ui, region);
	board = new Board(
		context,
		stage,
		initial,
		select,
		pick,
		() => mapPanel.visible && !ui.focusedNode,
	);
	board.select(selected);
	board.focus();
	renderStatus();
	renderLog();
	responsive();
	context.onDeactivate(() => {
		playing = false;
		if (!ui.disposed) ui.focus();
	});
	context.onUpdate((seconds) => {
		if (pendingFocus && pendingFocus.bounds.width > 0) {
			const node = pendingFocus;
			pendingFocus = undefined;
			if (node.available) {
				if (ui.focusedNode === node) ui.focus();
				ui.focus(node);
			}
		}
		const narrow = root.bounds.width < 850;
		if (narrow !== compact) {
			compact = narrow;
			responsive();
		}
		if (!playing) return;
		accumulator += seconds;
		if (accumulator >= 0.65 / Number(speed.value)) {
			accumulator -= 0.65 / Number(speed.value);
			takeStep();
			if (world().step >= 200) {
				playing = false;
				renderStatus();
				runNote.setText(
					"200ステップに到達して一時停止。1ステップ操作は続けられます。",
				);
			}
		}
	});
	/** Inspectable public Canvas nodes for embedding and behavioral regression checks. */
	return {
		root,
		region,
		mapPanel,
		editor,
		logs,
		help,
		status,
		runNote,
		outcome,
		gate,
		positions,
		draftBadge,
		error,
		target,
		commands,
		snapshot,
		logItems,
		logScroll,
		logRange,
		play,
		step,
		restart,
		speed,
		kind,
		direction,
		moveCount,
		x,
		y,
		waitCount,
		cx,
		cy,
		device,
		condition,
		conditionPosition,
		add,
		filter,
		previous,
		next,
		tabs,
		peopleButtons,
		get ui() {
			return ui;
		},
	};
}
await game.run("puzzle");
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
