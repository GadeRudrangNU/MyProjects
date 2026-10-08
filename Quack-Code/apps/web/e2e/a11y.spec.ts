import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createProjectWithFile, devLogin } from './helpers';

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${name} has accessibility violations`).toEqual([]);
}

test('key screens have no automated WCAG A/AA violations', async ({ page }) => {
  await page.goto('/login');
  await audit(page, 'login');

  await devLogin(page, 'Axel');
  await audit(page, 'workspaces');

  await createProjectWithFile(page);
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
  await audit(page, 'project editor');

  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await audit(page, 'shortcuts dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: /←/ }).click();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await audit(page, 'workspace');
});

test('core flows work with the keyboard alone', async ({ page }) => {
  await devLogin(page, 'Keys');
  await createProjectWithFile(page);
  await page.getByRole('treeitem', { name: /main\.js/ }).focus();
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog', { name: 'Rename or move' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('treeitem', { name: /main\.js/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'main.js' })).toHaveAttribute('aria-selected', 'true');
  // Escape then Tab leaves the editor instead of trapping focus.
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).not.toBeFocused();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});
