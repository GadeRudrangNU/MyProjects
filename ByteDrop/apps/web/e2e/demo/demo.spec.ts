import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "../helpers";

const PID = "6f0c1f0e-5b1a-4a0e-9a53-0d6f3f6a1001";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => {
    throw e;
  });
});

test("demo mode needs no backend: seeded data, files, upload, share", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} ${m.location().url}`));

  await page.goto("/projects");
  await expect(page.getByText("Demo mode")).toBeVisible();
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await expect(page).toHaveURL(/\/files/);

  const bucket = page.getByLabel("Bucket", { exact: true });
  await bucket.selectOption("acme-assets");
  const list = page.getByRole("listbox", { name: "Files in acme-assets" });
  await expect(list.getByRole("option").first()).toBeVisible();

  await list.getByRole("option", { name: /handbook\.pdf/ }).dblclick();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTitle(/PDF preview/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByLabel("Choose files to upload").setInputFiles({ name: "demo-upload.txt", mimeType: "text/plain", buffer: Buffer.from("browser only") });
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(list.getByRole("option", { name: /demo-upload\.txt/ })).toBeVisible();

  await bucket.selectOption("acme-private");
  const contract = page.getByRole("listbox", { name: "Files in acme-private" }).getByRole("option", { name: /contracts\/msa\.pdf/ });
  await contract.click();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByLabel("Link", { exact: true })).toHaveValue(/exp=\d+&sig=/);
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
});

test("demo analytics, transforms, webhooks and keys work from seeded data", async ({ page }) => {
  await page.goto(`/p/${PID}/analytics`);
  await expect(page.getByRole("region", { name: "Totals" })).toContainText("Requests");
  await page.getByLabel("Date range").selectOption("30d");
  await expect(page).toHaveURL(/range=30d/);
  await expect(page.getByRole("region", { name: "Charts" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("table", { name: "Most requested files" })).toBeVisible();

  await page.goto(`/p/${PID}/playground`);
  await page.getByLabel("Format").selectOption("avif");
  await expect(page.getByTestId("size-after")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/% smaller/)).toBeVisible();

  await page.goto(`/p/${PID}/webhooks`);
  await expect(page.getByTestId("delivery-row").first()).toBeVisible();
  await page.getByLabel("Status").selectOption("failed");
  await expect(page).toHaveURL(/status=failed/);
  const failed = page.getByTestId("delivery-row").first();
  await expect(failed).toHaveAttribute("data-status", "failed");
  await failed.getByRole("button", { name: /Replay/ }).click();
  await expect(page.getByText("Delivery queued again")).toBeVisible();

  await page.goto(`/p/${PID}/keys`);
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Name").fill("Demo key");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByLabel("Secret", { exact: true })).toHaveValue(/^bd_live_/);
});

test("demo pages pass axe in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of ["/login", "/projects", `/p/${PID}/files?bucket=acme-assets`, `/p/${PID}/analytics`, `/p/${PID}/playground`, `/p/${PID}/webhooks`, `/p/${PID}/keys`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      if (url.endsWith("analytics")) await expect(page.getByRole("region", { name: "Charts" })).toBeVisible({ timeout: 20_000 });
      await expectNoA11yViolations(page, `${url} (${scheme})`);
    }
  }
});

test("demo layout works on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of [`/p/${PID}/files`, `/p/${PID}/analytics`, `/p/${PID}/webhooks`, `/p/${PID}/keys`, `/p/${PID}/playground`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBeLessThanOrEqual(1);
  }
});
