import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, loginLive, openAcme, projectIdOf, selectBucket } from "../helpers";

test.describe.configure({ mode: "serial" });

test("the file browser only renders the visible rows, however long the list is", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await selectBucket(page, "acme-archive");
  const list = page.getByRole("listbox", { name: "Files in acme-archive" });
  await expect(list.getByRole("option").first()).toBeVisible();

  const rendered = await page.getByTestId("file-row").count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(60);
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-setsize", /\d+/);

  // Scrolling pulls in the remaining pages (cursor pagination) until the list ends.
  for (let i = 0; i < 40; i++) {
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    if (await page.getByText(/end of list/).isVisible()) break;
    await page.waitForTimeout(250);
  }
  await expect(page.getByText(/Loaded 1,500 · end of list/)).toBeVisible();
  expect(await page.getByTestId("file-row").count()).toBeLessThan(60);

  await list.focus();
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("status").filter({ hasText: "1500 selected" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-posinset", "1");
});

const pages = (pid: string): [string, string][] => [
  ["login (signed out)", "/login"],
  ["projects", "/projects"],
  ["files", `/p/${pid}/files?bucket=acme-assets`],
  ["analytics", `/p/${pid}/analytics?range=7d`],
  ["transforms", `/p/${pid}/playground`],
  ["webhooks", `/p/${pid}/webhooks`],
  ["api keys", `/p/${pid}/keys`],
];

async function pid(page: Page) {
  await loginLive(page);
  await openAcme(page);
  return projectIdOf(page);
}

test("pages have no accessibility violations (light and dark)", async ({ page }) => {
  const id = await pid(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, url] of pages(id)) {
      if (label.startsWith("login")) continue;
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      if (label === "analytics") await expect(page.getByRole("region", { name: "Charts" })).toBeVisible({ timeout: 20_000 });
      await expectNoA11yViolations(page, `${label} (${scheme})`);
    }
  }
});

test("dialogs are accessible", async ({ page }) => {
  const id = await pid(page);
  await page.goto(`/p/${id}/files?bucket=acme-assets`);
  const list = page.getByRole("listbox", { name: "Files in acme-assets" });
  await list.getByRole("option").first().dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoA11yViolations(page, "preview dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New bucket" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoA11yViolations(page, "new bucket dialog");
  await page.keyboard.press("Escape");

  await list.getByRole("option").first().click();
  await page.getByRole("button", { name: "Share" }).click();
  await expectNoA11yViolations(page, "share dialog");
  await page.keyboard.press("Escape");

  await page.goto(`/p/${id}/keys`);
  await page.getByRole("button", { name: "Create API key" }).click();
  await expectNoA11yViolations(page, "create key dialog");
});

test("the upload queue is accessible and keyboard operable", async ({ page }) => {
  const id = await pid(page);
  await page.goto(`/p/${id}/files?bucket=acme-assets`);
  await page.route("**/v1/projects/*/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByLabel("Choose files to upload").setInputFiles({ name: "a11y.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(3 * 1024 * 1024, 7) });
  const queue = page.getByRole("region", { name: "Upload queue" });
  await expect(queue).toBeVisible();
  await expectNoA11yViolations(page, "upload queue");
  const pause = queue.getByRole("button", { name: "Pause a11y.bin" });
  await pause.focus();
  await page.keyboard.press("Enter");
  await expect(queue.getByTestId("upload-item")).toHaveAttribute("data-status", "paused");
});

test("layout holds up on a phone: no sideways scroll and a working menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const id = await pid(page);
  for (const [label, url] of pages(id)) {
    if (label.startsWith("login")) continue;
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(1);
  }
  await page.goto(`/p/${id}/files`);
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "Analytics" })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page).toHaveURL(/analytics/);
  await page.screenshot({ path: "test-results/mobile-analytics.png", fullPage: true });
});
