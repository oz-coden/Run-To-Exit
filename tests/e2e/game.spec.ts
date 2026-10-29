import { test, expect, type Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("./");
  await expect(page.locator("#play")).toBeEnabled();
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
}) => {
  await open(page);
  const surface = page.locator("#board .simpludify");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Missing game surface");
  const height = box.height - 96,
    scale = Math.min(box.width / 640, height / 448);
  const offsetX = (box.width - 640 * scale) / 2,
    offsetY = 64 + (height - 448 * scale) / 2;
  // Switch S2 at (2,6); use a real pointer/touch, not application state injection.
  const x = box.x + offsetX + (56 + 2.5 * 48) * scale,
    y = box.y + offsetY + (32 + 6.5 * 48) * scale;
  await page.mouse.click(x, y);
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
