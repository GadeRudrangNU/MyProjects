import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginLive, openAcme, selectBucket } from "../helpers";

test.describe.configure({ mode: "serial" });

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function slowChunks(page: Page, ms = 500) {
  await page.route("**/v1/projects/*/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

const progress = (page: Page) => page.getByTestId("upload-item").getByRole("progressbar");
const percent = async (page: Page) => Number(await progress(page).first().getAttribute("aria-valuenow"));

test.beforeEach(async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await selectBucket(page, "acme-assets");
});

test("pause and resume continue from the server's offset and the file arrives intact", async ({ page }) => {
  await slowChunks(page);
  const data = randomBytes(6 * 1024 * 1024 + 123);
  const name = `pause-${Date.now()}.bin`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: data });
  const item = page.getByTestId("upload-item");

  await expect.poll(() => percent(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(20);
  await page.getByRole("button", { name: `Pause ${name}` }).click();
  await expect(item).toHaveAttribute("data-status", "paused");
  const pausedAt = await percent(page);
  expect(pausedAt).toBeLessThan(100);
  await page.waitForTimeout(1200);
  expect(await percent(page)).toBe(pausedAt);

  await page.getByRole("button", { name: `Resume ${name}` }).click();
  await expect(item).toHaveAttribute("data-status", "done", { timeout: 40_000 });
  const res = await page.request.get(`/f/acme-assets/${name}`);
  expect(sha(await res.body())).toBe(sha(data));
});

test("an upload interrupted by a page refresh resumes by itself", async ({ page }) => {
  await slowChunks(page);
  const data = randomBytes(6 * 1024 * 1024);
  const name = `refresh-${Date.now()}.bin`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: data });
  await expect.poll(() => percent(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(30);

  await page.reload();
  const item = page.getByTestId("upload-item");
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const res = await page.request.get(`/f/acme-assets/${name}`);
  expect(sha(await res.body())).toBe(sha(data));
});

test("a failed chunk can be retried and cancel removes the upload", async ({ page }) => {
  let failing = true;
  await page.route("**/v1/projects/*/uploads/*", async (route) => {
    if (route.request().method() === "PATCH" && failing) return route.fulfill({ status: 400, json: { error: { code: "chunk_too_large", message: "forced failure" } } });
    return route.continue();
  });
  const data = randomBytes(1_500_000);
  const name = `retry-${Date.now()}.bin`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: data });
  const item = page.getByTestId("upload-item");
  await expect(item).toHaveAttribute("data-status", "error", { timeout: 15_000 });
  await expect(item).toContainText("forced failure");

  failing = false;
  await page.getByRole("button", { name: `Retry ${name}` }).click();
  await expect(item).toHaveAttribute("data-status", "done", { timeout: 30_000 });

  await page.getByLabel("Choose files to upload").setInputFiles({ name: `cancel-${Date.now()}.bin`, mimeType: "application/octet-stream", buffer: randomBytes(4 * 1024 * 1024) });
  await slowChunks(page, 800);
  await page.getByRole("button", { name: /^Cancel cancel-/ }).click();
  await expect(page.getByTestId("upload-item").filter({ hasText: /cancel-/ })).toHaveAttribute("data-status", "cancelled");
});

test("hashing a large file happens in a worker and never freezes the page", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __long: number[] }).__long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  });
  const data = randomBytes(40 * 1024 * 1024);
  const name = `big-${Date.now()}.bin`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: data });
  // Building the 40 MB File inside the page is the test harness's own work; only count tasks from here on.
  await page.evaluate(() => ((window as unknown as { __long: number[] }).__long.length = 0));
  const item = page.getByTestId("upload-item");
  await expect(item).toHaveAttribute("data-status", /hashing|uploading|done/, { timeout: 20_000 });
  await expect(item).toHaveAttribute("data-status", "done", { timeout: 120_000 });
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
  // Hashing 40 MB on the main thread would block for well over a second.
  expect(longest).toBeLessThan(400);
});
