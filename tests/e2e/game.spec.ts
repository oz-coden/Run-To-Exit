import { test, expect, type Page } from "@playwright/test";
import type { CanvasNode } from "@simpludify/web";
import { PNG } from "pngjs";
type Puzzle = typeof import("../../src/main");
declare global {
	interface Window {
		puzzle: Puzzle;
	}
}
test.afterEach(async ({}, info) => {
	for (const error of info.errors) console.error(error.message ?? error);
});
test.beforeEach(async ({ page }, info) => {
	if (info.project.metadata.renderer !== "canvas2d") return;
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "gpu", { get: () => undefined });
		for (const proto of [
			HTMLCanvasElement.prototype,
			typeof OffscreenCanvas === "undefined"
				? undefined
				: OffscreenCanvas.prototype,
		]) {
			if (!proto) continue;
			const get = proto.getContext;
			proto.getContext = function (
				this: HTMLCanvasElement | OffscreenCanvas,
				kind: string,
				...args: unknown[]
			) {
				return kind.includes("webgl")
					? null
					: Reflect.apply(get, this, [kind, ...args]);
			} as typeof proto.getContext;
		}
	});
});
async function open(page: Page) {
	await page.clock.install({ time: new Date(0) });
	await page.clock.pauseAt(new Date(1000));
	await page.goto("./");
	await page.evaluate(async () => {
		const manifest = await (
			await fetch(new URL(".vite/manifest.json", document.baseURI))
		).json();
		window.puzzle = await import(
			new URL(manifest["src/main.ts"].file, document.baseURI).href
		);
	});
	await page.clock.runFor(32);
	await expect
		.poll(() => page.evaluate(() => window.puzzle.screen.root.bounds.width))
		.toBeGreaterThan(0);
}
async function text(page: Page, name: keyof Puzzle["screen"]) {
	return page.evaluate(
		(name) => (window.puzzle.screen[name] as CanvasNode).text,
		name,
	);
}
async function activate(page: Page, name: string) {
	const point = await page.evaluate(async (name) => {
		const { screen, game } = window.puzzle;
		const find = (node: CanvasNode): CanvasNode | undefined =>
			node.text === name && node.interactive
				? node
				: node.children.map(find).find(Boolean);
		const node = find(screen.root);
		if (!node) throw Error(`Missing control: ${name}`);
		void game.viewport;
		if (screen.ui.focusedNode === node) screen.ui.focus();
		screen.ui.focus(node);
		void game.viewport;
		const b = node.bounds,
			r = game.element.getBoundingClientRect();
		if (!screen.ui.containsNode(node, b.x + b.width / 2, b.y + b.height / 2)) throw Error(`Canvas control center is clipped: ${name}`);
		return {
			x: r.x + (b.x + b.width / 2) * screen.ui.scale,
			y: r.y + (b.y + b.height / 2) * screen.ui.scale,
		};
	}, name);
	// Native semantic mirrors have no pointer ownership; activate the actual Canvas hit box.
	if (test.info().project.use.hasTouch)
		await page.touchscreen.tap(point.x, point.y);
	else await page.mouse.click(point.x, point.y);
	await page.clock.runFor(32);
}
async function tab(page: Page, name: string) {
	await page.getByRole("button", { name, exact: true }).press("Enter");
	await page.clock.runFor(32);
}
async function assertTabPaint(page: Page, name: string) {
	// A semantic mirror can remain usable while a recycled GPU cache paints blank.
	const point = await page.evaluate((name) => {
		const { game, screen } = window.puzzle;
		const node = screen.tabs.find((node) => node.text === name);
		if (!node) throw Error("Missing tab paint target");
		const bounds = game.element.getBoundingClientRect();
		return {
			x: Math.round(bounds.x + (node.bounds.x + 8) * screen.ui.scale),
			y: Math.round(bounds.y + (node.bounds.y + 8) * screen.ui.scale),
			width: 1,
			height: 1,
		};
	}, name);
	// Browser capture reads the composited result; Canvas drawImage/getImageData
	// forces a very expensive GPU readback on some software-WebGL runtimes.
	const pixel = PNG.sync.read(await page.screenshot({ clip: point, scale: "css" })).data;
	expect(pixel[3]).toBe(255);
	for (const [channel, expected] of [0x41, 0x6c, 0x76].entries())
		expect(Math.abs(pixel[channel] - expected)).toBeLessThanOrEqual(22);
}
async function focusText(page: Page, name: string) {
	await page.evaluate(async (name) => {
		const { screen: s, game } = window.puzzle;
		const walk = (n: CanvasNode): CanvasNode | undefined =>
			n.text === name && n.interactive ? n : n.children.map(walk).find(Boolean);
		const n = walk(s.root);
		if (!n) throw Error(name);
		void game.viewport;
		if (s.ui.focusedNode === n) s.ui.focus();
		s.ui.focus(n);
		void game.viewport;
	}, name);
}
async function select(page: Page, name: string, label: string) {
	await focusText(page, name);
	await page
		.getByRole("combobox", { name, exact: true })
		.selectOption({ label });
	await page.clock.runFor(32);
}
async function add(
	page: Page,
	kind: string,
	fields: Record<string, string> = {},
) {
	await tab(page, "命令");
	await select(page, "追加する命令", kind);
	for (const [name, value] of Object.entries(fields)) {
		const combo = page.getByRole("combobox", { name, exact: true });
		if (await combo.count()) {
			await focusText(page, name);
			await combo.selectOption({ label: value });
		} else {
			await focusText(page, name);
			await page.getByRole("textbox", { name, exact: true }).fill(value);
		}
	}
	await activate(page, "＋ 命令を追加");
}
async function hint(page: Page, conflict = false) {
	await tab(page, "遊び方");
	await activate(page, conflict ? "衝突例をセット" : "攻略例をセット");
}
async function transport(page: Page, name: string) {
	await tab(page, "マップ");
	await activate(page, name);
}
async function solve(page: Page) {
	await add(page, "設備を操作", { スイッチ: "S1 · (2, 2)" });
	await add(page, "座標まで自動移動", { "X 座標": "8", "Y 座標": "3" });
	await activate(page, "B ベニ");
	await add(page, "設備を操作", { スイッチ: "S2 · (2, 6)" });
	await add(page, "方向へ移動", { 方向: "→ 右", マス数: "2" });
	await add(page, "方向へ移動", { 方向: "↑ 上", マス数: "2" });
	await add(page, "座標まで自動移動", { "X 座標": "8", "Y 座標": "3" });
}
test("builds a plan through Canvas/native input and clears the original stage", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await open(page);
	await solve(page);
	await tab(page, "マップ");
	await select(page, "再生速度", "4×");
	await activate(page, "▶ 再生開始");
	await page.clock.runFor(2500);
	await expect
		.poll(() => text(page, "outcome"), { timeout: 20000 })
		.toContain("全員、無事に脱出");
	expect(await text(page, "runNote")).toContain("Step 9");
	expect(await text(page, "positions")).toContain("A 脱出済み · B 脱出済み");
	await tab(page, "ログ");
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.puzzle.screen.logItems.children.map((n) => n.text).join("\n"),
			),
		)
		.toContain("Step 2 から開放");
	expect(errors).toEqual([]);
});
test("paints after editor-map-log cache target reuse", async ({ page }, info) => {
	// Software GPU readback has a separate budget from the interaction suite.
	test.setTimeout(180000);
	await open(page);
	await add(page, "方向へ移動", { 方向: "→ 右", マス数: "2" });
	await tab(page, "マップ");
	await tab(page, "ログ");
	await assertTabPaint(page, "ログ");
	await page.screenshot({ path: `test-results/canvas-${info.project.name}.png` });
});
test("pauses, single-steps and keeps edits separate from the running snapshot", async ({
	page,
}) => {
	await open(page);
	await hint(page);
	await tab(page, "マップ");
	await select(page, "再生速度", "0.5×");
	await activate(page, "▶ 再生開始");
	await page.clock.runFor(1400);
	await expect.poll(() => text(page, "runNote")).toMatch(/Step [1-9]/);
	await activate(page, "Ⅱ 一時停止");
	const note = await text(page, "runNote");
	await page.waitForTimeout(250);
	expect(await text(page, "runNote")).toBe(note);
	await activate(page, "1 ステップ →");
	expect(await text(page, "status")).toBe("一時停止");
	await add(page, "ステップ数で待機", { 待機するステップ数: "2" });
	expect(await text(page, "draftBadge")).toContain("次回用の変更あり");
	await activate(page, "現在実行中の計画を表示");
	expect(
		await page.evaluate(() =>
			window.puzzle.screen.snapshot.children.map((n) => n.text).join("\n"),
		),
	).not.toContain("2 ステップ待機");
	await transport(page, "↻ 再実行");
	await activate(page, "Ⅱ 一時停止");
	expect(
		await page.evaluate(() =>
			window.puzzle.screen.snapshot.children.map((n) => n.text).join("\n"),
		),
	).toContain("2 ステップ待機");
});
test("Conflict rolls back both people and log selection highlights the command", async ({
	page,
}) => {
	await open(page);
	await hint(page, true);
	await transport(page, "1 ステップ →");
	expect(await text(page, "status")).toContain("Conflict");
	expect(await text(page, "outcome")).toContain("Step 1：same-cell");
	expect(await text(page, "outcome")).toContain("最後に確定した Step 0");
	expect(await text(page, "positions")).toBe("A (2, 3) · B (2, 5)");
	await expect(
		page.getByRole("button", { name: "▶ 再開", exact: true }),
	).toBeDisabled();
	await tab(page, "ログ");
	const event = await page.evaluate(
		() =>
			window.puzzle.screen.logItems.children.filter((n) => n.interactive).at(-1)
				?.text,
	);
	expect(event).toBeTruthy();
	await activate(page, event!);
	expect(
		await page.evaluate(
			() => window.puzzle.screen.commands.children[0].style.background,
		),
	).toBe(0x685237);
});
test("reorders/deletes, validates integers and supports every condition", async ({
	page,
}) => {
	await open(page);
	await add(page, "ステップ数で待機", { 待機するステップ数: "2" });
	await add(page, "方向へ移動", { 方向: "→ 右", マス数: "1" });
	await activate(page, "命令 2 を上へ移動 ↑");
	await expect
		.poll(() =>
			page.evaluate(
				() => window.puzzle.screen.commands.children[0].children[0].text,
			),
		)
		.toContain("右へ");
	await activate(page, "命令 1 を削除 ×");
	for (const condition of [
		"ゲートが開く",
		"ゲートが閉じる",
		"もう1人が脱出する",
		"もう1人が指定座標に来る",
	])
		await add(page, "条件が成立するまで待機", {
			待つ条件: condition,
			...(condition.includes("指定座標")
				? { "待機対象 X": "4", "待機対象 Y": "3" }
				: {}),
		});
	const count = await page.evaluate(
		() => window.puzzle.screen.commands.children.length,
	);
	for (const value of ["0", "", "1.5", "日本語"]) {
		await add(page, "方向へ移動", { マス数: value });
		expect(await text(page, "error")).toContain("整数");
		expect(
			await page.evaluate(() => window.puzzle.screen.commands.children.length),
		).toBe(count);
	}
});
test("pointer projection picks switches and HUD taps never select a world cell", async ({
	page,
}) => {
	await open(page);
	const point = await page.evaluate(() => {
		const { game } = window.puzzle;
		const p = game.worldToScreen({
			space: "world",
			x: 56 + 2.5 * 48,
			y: 32 + 6.5 * 48,
		});
		const r = game.element.getBoundingClientRect();
		return { x: r.x + p.x, y: r.y + p.y };
	});
	if (test.info().project.use.hasTouch)
		await page.touchscreen.tap(point.x, point.y);
	else await page.mouse.click(point.x, point.y);
	await page.clock.runFor(32);
	expect(await text(page, "target")).toBe("対象 (2, 6)");
	await tab(page, "命令");
	await activate(page, "B ベニ");
	await activate(page, "＋ 命令を追加");
	expect(
		await page.evaluate(
			() => window.puzzle.screen.commands.children[0].children[0].text,
		),
	).toContain("S2");
	expect(await text(page, "target")).toBe("対象 (2, 6)");
});
test("keyboard map targeting stays isolated from editing and command focus survives updates", async ({
	page,
}) => {
	await open(page);
	const host = page.locator(".simpludify");
	await host.focus();
	await host.press("ArrowLeft");
	await page.clock.runFor(32);
	expect(await text(page, "target")).toBe("対象 (7, 3)");
	await tab(page, "命令");
	await focusText(page, "X 座標");
	await page
		.getByRole("textbox", { name: "X 座標", exact: true })
		.press("ArrowDown");
	expect(await text(page, "target")).toBe("対象 (7, 3)");
	await add(page, "ステップ数で待機", { 待機するステップ数: "10" });
	await add(page, "方向へ移動", { 方向: "→ 右" });
	await focusText(page, "命令 2 を上へ移動 ↑");
	await page.keyboard.press("Enter");
	await page.clock.runFor(64);
	await expect
		.poll(() => page.evaluate(() => window.puzzle.screen.ui.focusedNode?.text))
		.toContain("命令 1");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Space");
	expect(await text(page, "status")).toBe("計画中");
});
test("all 50 commands remain reachable and event pages bound the displayed history", async ({
	page,
}) => {
	test.setTimeout(180000);
	await open(page);
	await add(page, "ステップ数で待機", { 待機するステップ数: "100" });
	for (let i = 1; i < 50; i++) await activate(page, "＋ 命令を追加");
	await activate(page, "＋ 命令を追加");
	expect(await text(page, "error")).toContain("50命令");
	await activate(page, "命令 50 を削除 ×");
	await expect
		.poll(() =>
			page.evaluate(() => window.puzzle.screen.commands.children.length),
		)
		.toBe(49);
    await transport(page, "1 ステップ →");
    // Generate a long history through the public UI command; do not inject a plan/world snapshot.
    await page.evaluate(() => { for (let i = 0; i < 90; i++) window.puzzle.screen.step.activate(); });
    await page.clock.runFor(64);
	await tab(page, "ログ");
	await select(page, "ログ表示", "すべて");
	expect(
		await page.evaluate(() => window.puzzle.screen.logItems.children.length),
	).toBeLessThanOrEqual(80);
	await expect(
		page.getByRole("button", { name: "次の80件", exact: true }),
	).toBeEnabled();
	await activate(page, "次の80件");
	expect(await text(page, "logRange")).toContain("81〜");
});
test("scene recreation disposes old UI and releases native input and projection", async ({
	page,
}) => {
	await open(page);
	await tab(page, "命令");
	await add(page, "方向へ移動");
	const result = await page.evaluate(async () => {
		const { game, screen: old } = window.puzzle;
		await game.changeScene("puzzle");
		return {
			oldDisposed: old.ui.disposed,
			rootDisposed: old.root.disposed,
			nodes: old.ui.diagnostics.nodes,
			newRoot: window.puzzle.screen.root !== old.root,
			step: window.puzzle.screen.runNote.text,
		};
	});
	expect(result).toMatchObject({
		oldDisposed: true,
		rootDisposed: true,
		nodes: 0,
		newRoot: true,
	});
	expect(result.step).toContain("Step 0");
	await expect(page.locator(".s-canvas-accessibility")).toHaveCount(1);
	await page.evaluate(() => {
		window.puzzle.game.dispose();
		window.puzzle.game.dispose();
	});
	await expect(page.locator(".simpludify")).toHaveCount(0);
});
test("production subpath, registry inventory and 320/390 layouts stay healthy", async ({
	page,
	request,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await open(page);
	await page.reload();
	await page.evaluate(async () => {
		const manifest = await (await fetch(".vite/manifest.json")).json();
		window.puzzle = await import(
			new URL(manifest["src/main.ts"].file, document.baseURI).href
		);
	});
	await page.clock.runFor(32);
	const inventory = await (await request.get("dependencies.json")).json();
	for (const name of ["@simpludify/core", "@simpludify/web"])
		expect(
			inventory.find((p: { name: string }) => p.name === name),
		).toMatchObject({
			version: process.env.E2E_SDK_VERSION ?? "0.1.7",
			license: "MIT",
		});
	expect(await (await request.get("THIRD-PARTY-NOTICES.txt")).text()).toContain(
		"Vlad Shilov",
	);
	for (const width of [900, 390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		// Let the browser deliver Game's ResizeObserver before advancing the paused
		// clock. The next scene update then selects the layout for the new size.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					const observer = new ResizeObserver(() => {
						observer.disconnect();
						resolve();
					});
					observer.observe(window.puzzle.game.element);
				}),
		);
		await tab(page, "マップ");
		const layout = await page.evaluate(() => {
			const { game, screen } = window.puzzle;
			return {
				mapWidth: game.viewport.width,
				editorVisible: screen.editor.visible,
				noOverflow: document.documentElement.scrollWidth <= innerWidth,
			};
		});
		expect(layout.mapWidth, `map width at ${width}px`).toBeGreaterThan(150);
		expect(layout.editorVisible, `editor visibility at ${width}px`).toBe(
			width === 900,
		);
		expect(layout.noOverflow, `horizontal overflow at ${width}px`).toBe(true);
		await tab(page, "遊び方");
		await activate(page, "攻略例をセット");
	}
	expect(errors).toEqual([]);
});

test("label semantics expose stage help, errors and status", async ({
	page,
}) => {
	await open(page);
	const labels = page.locator(".s-canvas-label");
	await expect(labels.filter({ hasText: "RUN TO EXIT" })).toHaveCount(1);
	await expect(page.getByRole("heading", { name: "RUN TO EXIT", level: 1 })).toHaveCount(1);
	await expect(page.getByRole("status").filter({ hasText: "計画中" })).toHaveAttribute("aria-live", "polite");
	await tab(page, "遊び方");
	await expect(labels.filter({ hasText: "はじめての脱出計画" })).toHaveCount(1);
	await expect(page.getByRole("heading", { name: "はじめての脱出計画", level: 2 })).toHaveCount(1);
	await add(page, "方向へ移動", { マス数: "日本語" });
	await expect(page.getByRole("textbox", { name: "マス数", exact: true })).toHaveAttribute("inputmode", "numeric");
	await expect(
		labels.filter({ hasText: "整数を入力してください" }),
	).toHaveCount(1);
	await expect(page.getByRole("alert")).toContainText("整数を入力してください");
});
