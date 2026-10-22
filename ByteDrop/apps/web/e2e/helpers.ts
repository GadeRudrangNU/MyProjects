import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const DEMO_EMAIL = "demo@bytedrop.dev";
export const DEMO_PASSWORD = "Demo#2025-pass";

export async function loginLive(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects/);
}

export async function openAcme(page: Page) {
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/files/);
}

export const projectIdOf = (page: Page) => /\/p\/([^/]+)/.exec(page.url())![1]!;

export async function selectBucket(page: Page, name: string) {
  await page.getByLabel("Bucket", { exact: true }).selectOption({ value: name });
  await expect(page).toHaveURL(new RegExp(`bucket=${name}`));
  await expect(page.getByRole("listbox", { name: `Files in ${name}` })).toBeVisible();
}

export async function expectNoA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

export async function waitIdle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}
