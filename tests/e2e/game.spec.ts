import { test, expect, type Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("./");
  await expect(page.locator("#play")).toBeEnabled();
}
async function boardProjection(page: Page, point = {x: 56 + 2.5 * 48, y: 32 + 6.5 * 48}) {
  await page.locator("#board .simpludify").scrollIntoViewIfNeeded();
  return page.evaluate(async (point) => {
    const response = await fetch(new URL(".vite/manifest.json", document.baseURI));
    if (!response.ok) throw new Error("Missing production asset manifest");
    const manifest = await response.json();
    const entry = manifest["src/main.ts"]?.file;
    if (!entry) throw new Error("Missing game entry module");
    const { game } = await import(new URL(entry, document.baseURI).href) as {game: import("@simpludify/web").Game};
    const projected = game.worldToScreen({...point, space: "world"});
    const box = game.element.getBoundingClientRect();
    return {x:box.x + projected.x, y:box.y + projected.y, viewport:{...game.viewport}, width:game.element.clientWidth, height:game.element.clientHeight};
  },point);
}
async function hint(page: Page, kind = "solution") {
  await page.getByText("ヒント・攻略例", { exact: true }).click();
  await page.locator(`#load-${kind}`).click();
}
async function add(
  page: Page,
  kind: string,
  fields: Record<string, string> = {},
) {
  await page.locator("#command-kind").selectOption(kind);
  for (const [id, content] of Object.entries(fields)) {
    if (["direction", "device", "condition"].includes(id))
      await page.locator(`#${id}`).selectOption(content);
    else await page.locator(`#${id}`).fill(content);
  }
  await page.locator("#add-command").click();
}
async function solveByEditor(page: Page) {
  await add(page, "interact", { device: "s1" });
  await add(page, "go", { "target-x": "8", "target-y": "3" });
  await page.locator('[data-person="B"]').click();
  await add(page, "interact", { device: "s2" });
  await add(page, "move", { direction: "right", "move-count": "2" });
  await add(page, "move", { direction: "up", "move-count": "2" });
  await add(page, "go", { "target-x": "8", "target-y": "3" });
}
test("builds a plan in the real editor and clears the original stage", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await solveByEditor(page);
  await page.locator("#speed").selectOption("4");
  await page.locator("#play").click();
  await expect(page.locator("#outcome")).toContainText("全員、無事に脱出", {
    timeout: 15000,
  });
  await expect(page.locator("#run-note")).toContainText("Step 9");
  await expect(page.locator("#pos-A")).toHaveText("脱出済み");
  await expect(page.locator("#pos-B")).toHaveText("脱出済み");
  await expect(page.locator("#log")).toContainText("Step 2 から開放");
  await expect(page.locator("#log")).toContainText("Step 8 から閉鎖");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/clear-${info.project.name}.png`,
    fullPage: true,
  });
});
test("pauses, resumes, single-steps, and isolates edits from an active snapshot", async ({
  page,
}) => {
  await open(page);
  await hint(page);
  await page.locator("#speed").selectOption("0.5");
  await page.locator("#play").click();
  await expect(page.locator("#run-note")).toContainText(
    /世界 Step [1-9]\d*。/,
    { timeout: 10000 },
  );
  await page.locator("#play").click();
  await expect(page.locator("#status")).toHaveText("一時停止");
  const note = await page.locator("#run-note").innerText();
  await page.waitForTimeout(500);
  await expect(page.locator("#run-note")).toHaveText(note);
  await page.locator("#step").click();
  const pausedStep = Number(note.match(/Step (\d+)/)?.[1]);
  await expect(page.locator("#run-note")).toContainText(
    `Step ${pausedStep + 1}。`,
  );
  await add(page, "wait", { "wait-count": "2" });
  await expect(page.locator("#draft-badge")).toHaveText("次回用の変更あり");
  await page.getByText("現在実行中の計画", { exact: false }).first().click();
  await expect(page.locator("#snapshot-content")).not.toContainText(
    "2 ステップ待機",
  );
  await page.locator("#play").click();
  await expect(page.locator("#status")).toHaveText("実行中");
  await page.locator("#play").click();
  await page.locator("#restart").click();
  await page.locator("#play").click();
  await expect(page.locator("#snapshot-content")).toContainText(
    "2 ステップ待機",
  );
});
test("reports a collision without partially moving either person and highlights its log", async ({
  page,
}) => {
  await open(page);
  await hint(page, "conflict");
  await page.locator("#step").click();
  await expect(page.locator("#status")).toContainText("Conflict");
  await expect(page.locator("#outcome")).toContainText("Step 1：same-cell");
  await expect(page.locator("#outcome")).toContainText("最後に確定した Step 0");
  await expect(page.locator("#pos-A")).toHaveText("(2, 3)");
  await expect(page.locator("#pos-B")).toHaveText("(2, 5)");
  await expect(page.locator("#play")).toBeDisabled();
  await page.locator("#log .log-conflict").click();
  await expect(page.locator('[data-person="A"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#load-solution").click();
  await page.locator("#speed").selectOption("4");
  await page.locator("#restart").click();
  await expect(page.locator("#outcome")).toContainText("全員、無事に脱出", {
    timeout: 15000,
  });
});
test("reorders/deletes commands, validates values, and supports all waiting controls", async ({
  page,
}) => {
  await open(page);
  await add(page, "wait", { "wait-count": "2" });
  await add(page, "move", { direction: "right", "move-count": "1" });
  await page
    .getByRole("button", { name: "命令 2 を上へ移動", exact: true })
    .click();
  await expect(page.locator("#commands .command").first()).toContainText(
    "右へ 1",
  );
  await page
    .getByRole("button", { name: "命令 1 を削除", exact: true })
    .click();
  await expect(page.locator("#commands .command")).toHaveCount(1);
  await add(page, "until", { condition: "open" });
  await expect(page.locator("#commands")).toContainText("扉が開くまで待機");
  await page.locator("#command-kind").selectOption("move");
  await page.locator("#move-count").fill("0");
  await page.locator("#add-command").click();
  await expect(page.locator("#edit-error")).toBeVisible();
  await expect(page.locator("#commands .command")).toHaveCount(2);
  await page.locator("#step").click();
  await expect(page.locator("#run-note")).toContainText("Step 1");
  await page.locator("#step").click();
  await page.locator("#step").click();
  await expect(page.locator("#run-note")).toContainText("Step 3");
  await page.locator("#log-filter").selectOption("all");
  await expect(page.locator("#log")).toContainText("条件待機中");
});
test("Canvas pointer coordinates choose a cell and Canvas buttons choose a person", async ({
  page,
}, info) => {
  await open(page);
  // Project through the public Game API instead of copying HUD/Viewport constants.
  const {x,y} = await boardProjection(page);
  if (info.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(page.locator("#command-kind")).toHaveValue("interact");
  await expect(page.locator("#device")).toHaveValue("s2");
  // Native semantic mirror exercises Canvas keyboard activation.
  await page
    .getByRole("button", { name: "B ベニ", exact: true })
    .press("Enter");
  await expect(page.locator('[data-person="B"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#add-command").click();
  await expect(page.locator("#commands")).toContainText("S2");
});
test("loads and reloads the production subpath with healthy local assets", async ({
  page,
}) => {
  const broken: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/Run-To-Exit/"))
      broken.push(response.url());
  });
  await open(page);
  await page.reload();
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("canvas")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/Run-To-Exit/");
  expect(broken).toEqual([]);
});


test("keyboard map targeting stays isolated from form input and editor focus survives edits", async ({ page }) => {
  await open(page);
  const surface = page.locator("#board .simpludify");
  await surface.focus();
  await surface.press("ArrowLeft");
  await expect(page.locator("#selected-cell")).toHaveText("対象 (7, 3)");
  await surface.press("ArrowUp");
  await expect(page.locator("#target-y")).toHaveValue("2");
  await page.locator("#target-x").focus();
  await page.locator("#target-x").press("ArrowDown");
  await expect(page.locator("#selected-cell")).toHaveText("対象 (7, 2)");
  await expect(page.locator("#status")).toHaveText("計画中");
  await add(page, "wait", { "wait-count": "1" });
  await add(page, "move", { direction: "right" });
  await page.getByRole("button", { name: "命令 2 を上へ移動", exact: true }).press("Enter");
  await expect(page.locator("#commands .command").first()).toContainText("右へ");
  await expect(page.locator("#commands button:focus")).toHaveCount(1);
  await page.getByRole("button", { name: "命令 1 を削除", exact: true }).press("Enter");
  await expect(page.locator("#commands button:focus")).toHaveCount(1);
  await page.getByRole("button", { name: "命令 1 を削除", exact: true }).press("Enter");
  await expect(page.locator("#add-command")).toBeFocused();
  await add(page, "wait", { "wait-count": "10" });
  await page.locator("#speed").selectOption("4");
  await page.clock.install({ time: new Date(0) });
  await page.clock.pauseAt(new Date(60_000));
  await page.locator("#play").click();
  const deleteCommand = page.getByRole("button", { name: "命令 1 を削除", exact: true });
  await deleteCommand.focus();
  const currentStep = async () => Number(
    (await page.locator("#run-note").innerText()).match(/Step (\d+)/)?.[1],
  );
  const focusedAtStep = await currentStep();
  await page.clock.runFor(650);
  expect(await currentStep()).toBeGreaterThan(focusedAtStep);
  await expect(deleteCommand).toBeFocused();
  await page.locator("#play").click();
});

test("ships registry SDK inventory, license notices, and supports 320px command scrolling", async ({ page, request }) => {
  await open(page);
  const response = await request.get("dependencies.json");
  expect(response.ok()).toBe(true);
  const inventory = await response.json();
  for (const name of ["@simpludify/core", "@simpludify/web"]) {
    expect(inventory.find((p: { name: string }) => p.name === name)).toMatchObject({ version: "0.1.2", license: "MIT" });
  }
  expect((await (await request.get("THIRD-PARTY-NOTICES.txt")).text())).toContain("Vlad Shilov");
  await page.setViewportSize({ width: 320, height: 740 });
  for (let i = 0; i < 12; i++) await add(page, "wait", { "wait-count": "1" });
  const commands = page.locator("#commands");
  expect(await commands.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await commands.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole("button", { name: "命令 12 を削除", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#play")).toBeInViewport();
});

test("bound map viewport follows host resize and HUD taps keep world coordinates", async ({page}, info) => {
  await open(page);
  for (const width of [900, 390, 320]) {
    await page.setViewportSize({width,height:844});
    await expect.poll(async () => {
      const view=await boardProjection(page);
      return Math.abs(view.viewport.width - (view.width - 20));
    }).toBeLessThan(0.1);
    const view=await boardProjection(page);
    expect(view.viewport.x).toBeCloseTo(10,1);
    expect(view.viewport.y).toBeGreaterThanOrEqual(44);
    expect(view.viewport.height).toBeGreaterThan(1);
    expect(view.viewport.y + view.viewport.height).toBeLessThan(view.height - 10);
    if(info.project.use.hasTouch) await page.touchscreen.tap(view.x,view.y);
    else await page.mouse.click(view.x,view.y);
    await expect(page.locator("#selected-cell")).toHaveText("対象 (2, 6)");
    await expect(page.locator("#device")).toHaveValue("s2");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const button=await page.getByRole("button",{name:"B ベニ",exact:true}).boundingBox();
  if(!button) throw new Error("Missing Canvas HUD button");
  if(info.project.use.hasTouch) await page.touchscreen.tap(button.x+button.width/2,button.y+button.height/2);
  else await page.mouse.click(button.x+button.width/2,button.y+button.height/2);
  await expect(page.locator('[data-person="B"]')).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("#selected-cell")).toHaveText("対象 (2, 6)");
});
