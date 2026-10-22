import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loginLive, openAcme, projectIdOf, selectBucket } from "../helpers";

test.describe.configure({ mode: "serial" });

test("sign up, create a project, sign out and back in", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-passphrase");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByText("No projects yet")).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Side project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/files/);
  await expect(page.getByText("Create your first bucket")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);

  await loginLive(page, email, "a-long-passphrase");
  await expect(page.getByRole("heading", { name: "Side project" })).toBeVisible();
});

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@bytedrop.dev");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("browse, search, select by keyboard, preview, upload, share, delete", async ({ page, playwright }) => {
  await loginLive(page);
  await openAcme(page);
  const pid = projectIdOf(page);

  await selectBucket(page, "acme-assets");
  const list = page.getByRole("listbox", { name: "Files in acme-assets" });
  await expect(list.getByRole("option").first()).toBeVisible();

  // Keyboard model: arrows move the selection, Shift extends it, Space toggles.
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(0);

  // Search lives in the URL.
  await page.keyboard.press("/");
  await expect(page.getByLabel(/^Search/)).toBeFocused();
  await page.getByLabel(/^Search/).fill("shot-03");
  await expect(page).toHaveURL(/q=shot-03/);
  await expect(list.getByRole("option")).toHaveCount(1);

  // Preview shows the real image.
  await list.getByRole("option").first().dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const img = dialog.getByRole("img", { name: /Preview of hero\/shot-03/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Upload into the private bucket and see the list update.
  await selectBucket(page, "acme-private");
  await expect(page.getByLabel(/^Search/)).toHaveValue("");
  // Clearing the search box must not drag the URL back to the previous bucket.
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/bucket=acme-private/);
  const body = `hello from the e2e suite ${Date.now()}`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from(body) });
  const queue = page.getByRole("region", { name: "Upload queue" });
  await expect(queue.getByTestId("upload-item")).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  const privateList = page.getByRole("listbox", { name: "Files in acme-private" });
  const row = privateList.getByRole("option", { name: /note\.txt/ });
  await expect(row).toBeVisible();

  // A signed, expiring link for the private file.
  await row.click();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Link expires after").selectOption({ label: "5 minutes" });
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Link", { exact: true }).inputValue();
  expect(link).toMatch(/exp=\d+&sig=[a-f0-9]{64}/);
  // A visitor with no session: only the signature opens the file.
  const visitor = await playwright.request.newContext();
  const ok = await visitor.get(link);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe(body);
  expect((await visitor.get(link.replace(/sig=[a-f0-9]/, "sig=0"))).status()).toBe(403);
  expect((await visitor.get(link.split("?")[0]!)).status()).toBe(401);
  await page.keyboard.press("Escape");

  // Delete with the keyboard, behind a confirmation.
  await row.click();
  await privateList.focus();
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(row).toHaveCount(0);
  expect((await visitor.get(link)).status()).toBe(404);
  await visitor.dispose();
  expect(pid).toBeTruthy();
});

test("creating a bucket and dropping a file onto the page uploads it", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await page.getByRole("button", { name: "New bucket" }).click();
  const name = `e2e-bucket-${Date.now().toString(36)}`;
  await page.getByLabel("Bucket name").fill(name);
  await page.getByRole("button", { name: "Create bucket" }).click();
  await expect(page).toHaveURL(new RegExp(`bucket=${name}`));
  await expect(page.getByText("This bucket is empty")).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["dropped content"], "dropped.txt", { type: "text/plain" }));
    return dt;
  });
  const zone = page.getByRole("toolbar", { name: "File actions" });
  await zone.dispatchEvent("dragover", { dataTransfer });
  await expect(page.getByText(`Drop files to upload to ${name}`)).toBeVisible();
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(page.getByRole("option", { name: /dropped\.txt/ })).toBeVisible();
});

test("image transform playground shows before and after sizes", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await page.getByRole("link", { name: "Transforms" }).click();
  await expect(page.getByRole("heading", { name: "Image transforms" })).toBeVisible();
  await page.getByLabel("Bucket").selectOption("acme-assets");
  await page.getByLabel("Image").selectOption({ label: "hero/shot-01.png" });
  await page.getByLabel("Format").selectOption("webp");
  await expect(page.getByTestId("size-after")).toBeVisible({ timeout: 20_000 });
  const url1 = await page.getByTestId("transform-url").innerText();
  expect(url1).toContain("format=webp");
  expect(url1).toMatch(/w=640/);

  const thumb = page.getByRole("slider", { name: "Width" });
  await thumb.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("transform-url")).not.toHaveText(url1);
  await expect(page.getByText(/% smaller/)).toBeVisible({ timeout: 20_000 });
});

test("API keys: the secret is shown once, works, and stops working when revoked", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  const pid = projectIdOf(page);
  await page.getByRole("link", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Name").fill("e2e key");
  await page.getByLabel("Permissions").selectOption("write");
  await page.getByRole("button", { name: "Create key" }).click();
  const secret = await page.getByLabel("Secret", { exact: true }).inputValue();
  expect(secret).toMatch(/^bd_live_/);
  await page.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByRole("row", { name: /e2e key/ })).toBeVisible();

  const call = () => page.request.get(`/v1/projects/${pid}/buckets`, { headers: { authorization: `Bearer ${secret}` } });
  expect((await call()).status()).toBe(200);

  await page.reload();
  expect(await page.content()).not.toContain(secret);

  await page.getByRole("button", { name: "Revoke e2e key" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByRole("row", { name: /e2e key/ }).getByText("Revoked")).toBeVisible();
  expect((await call()).status()).toBe(401);
});

test("webhooks: delivery log, failures, and the replay button", async ({ page, request }) => {
  await loginLive(page);
  await openAcme(page);
  const pid = projectIdOf(page);
  await page.getByRole("link", { name: "Webhooks" }).click();

  // Remove the seeded endpoint so only ours receives events.
  await page.getByRole("button", { name: /Remove http:\/\/127\.0\.0\.1:4010/ }).click();
  await page.getByRole("button", { name: "Remove endpoint" }).click();
  await expect(page.getByText("hooks/bytedrop")).toHaveCount(0);

  await request.get("http://127.0.0.1:4110/mode?m=fail");
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Endpoint URL").fill("http://127.0.0.1:4110/hook");
  await page.getByRole("button", { name: "Add endpoint" }).last().click();
  const secret = await page.getByLabel("Secret", { exact: true }).inputValue();
  expect(secret).toMatch(/^whsec_/);
  await page.getByRole("button", { name: "I have saved it" }).click();

  // Trigger an event by uploading a file.
  await page.getByRole("link", { name: "Files" }).click();
  await selectBucket(page, "acme-assets");
  await page.getByLabel("Choose files to upload").setInputFiles({ name: `hook-${Date.now()}.txt`, mimeType: "text/plain", buffer: Buffer.from("hook me") });
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done", { timeout: 20_000 });

  await page.goto(`/p/${pid}/webhooks`);
  const failed = page.getByTestId("delivery-row").filter({ hasText: "failed" }).first();
  await expect(async () => {
    await page.reload();
    await expect(failed).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(failed).toContainText("3");

  await request.get("http://127.0.0.1:4110/mode?m=ok");
  await failed.getByRole("button", { name: /Replay/ }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("delivery-row").filter({ hasText: "success" }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const stats = await (await request.get("http://127.0.0.1:4110/stats")).json();
  expect(stats.received).toBeGreaterThanOrEqual(4);
});

test("analytics: filters live in the URL and new traffic shows up after a refresh", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Delivery analytics" })).toBeVisible();

  await page.getByLabel("Date range").selectOption("7d");
  await expect(page).toHaveURL(/range=7d/);
  await page.getByLabel("Bucket").selectOption("acme-assets");
  await expect(page).toHaveURL(/bucket=acme-assets/);
  await page.getByLabel("File type").selectOption("image");
  await expect(page).toHaveURL(/kind=image/);
  await expect(page.getByRole("region", { name: "Charts" })).toBeVisible({ timeout: 20_000 });

  // Shareable: a fresh page load of the same URL keeps the filters.
  const shared = page.url();
  await page.goto("/projects");
  await page.goto(shared);
  await expect(page.getByLabel("Date range")).toHaveValue("7d");
  await expect(page.getByLabel("File type")).toHaveValue("image");

  // Real traffic: requests with a referrer, then recompute the latest hourly summaries.
  await page.goto(shared.split("?")[0]! + "?range=24h&bucket=acme-assets");
  for (let i = 0; i < 6; i++) {
    const res = await page.request.get("/f/acme-assets/data/readme.txt", { headers: { referer: "https://e2e.example.com/page" } });
    expect(res.status()).toBe(200);
  }
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText("Summaries refreshed")).toBeVisible();
  await expect(page.getByRole("table", { name: "Sites sending the most requests" })).toContainText("e2e.example.com", { timeout: 15_000 });
  await expect(page.getByRole("table", { name: "Most requested files" })).toContainText("data/readme.txt");
});

test("sha256 stays correct for a file downloaded after upload", async ({ page }) => {
  await loginLive(page);
  await openAcme(page);
  await selectBucket(page, "acme-assets");
  const data = randomBytes(300_000);
  await page.getByLabel("Choose files to upload").setInputFiles({ name: "integrity.bin", mimeType: "application/octet-stream", buffer: data });
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const res = await page.request.get("/f/acme-assets/integrity.bin");
  expect(createHash("sha256").update(await res.body()).digest("hex")).toBe(createHash("sha256").update(data).digest("hex"));
  const part = await page.request.get("/f/acme-assets/integrity.bin", { headers: { range: "bytes=10-19" } });
  expect(part.status()).toBe(206);
  expect((await part.body()).equals(data.subarray(10, 20))).toBe(true);
});
