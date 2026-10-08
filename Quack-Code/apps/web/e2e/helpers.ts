import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export async function devLogin(page: Page, name: string) {
  await page.goto('/login');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Dev sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
}

export async function newUser(browser: Browser, name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Surfaced in the test output so a failing run explains itself.
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && console.log(`[${name}] ${r.status()} ${r.request().method()} ${r.url()}`));
  await devLogin(page, name);
  return { context, page };
}

/** Owner creates workspace -> project -> main.js and lands in the editor. Returns the project URL. */
export async function createProjectWithFile(page: Page, opts: { workspace?: string; file?: string } = {}) {
  const file = opts.file ?? 'main.js';
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Name').fill(opts.workspace ?? 'Demo Team');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Hello App');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/p\//);
  await addFile(page, file);
  return page.url();
}

export async function addFile(page: Page, path: string) {
  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByLabel('Path').fill(path);
  await page.getByRole('button', { name: 'Create' }).click();
  // The previous file's editor stays on screen until the new one has loaded: wait for the new one by name.
  await expect(page.getByRole('textbox', { name: `Editor for ${path}` })).toBeVisible();
}

/** Creates an invite link for the workspace of the current project page. */
export async function createInviteLink(page: Page, role: 'editor' | 'viewer') {
  const back = page.getByRole('link', { name: /←/ });
  if (await back.count()) await back.click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.getByLabel('Role').selectOption(role);
  await page.getByRole('button', { name: 'Create link' }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  await page.keyboard.press('Escape');
  return link;
}

/** Joins via an invite link as an already signed-in user, then opens the project's first file. */
export async function joinAndOpenFile(page: Page, inviteLink: string, projectName = 'Hello App', file = 'main.js') {
  await page.goto(new URL(inviteLink).pathname);
  await page.getByRole('link', { name: projectName }).click();
  await page.getByRole('treeitem', { name: new RegExp(file.replace('.', '\\.')) }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
}

/** The document text, without remote cursors' name labels or zero-width helper characters. */
export const editorText = (page: Page) =>
  page.locator('.cm-content').evaluate((el) => {
    const zeroWidth = new RegExp('[' + String.fromCharCode(0x200b, 0x2060, 0xfeff) + ']', 'g');
    return [...el.querySelectorAll('.cm-line')]
      .map((line) => {
        const copy = line.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo, .cm-widgetBuffer').forEach((n) => n.remove());
        return (copy.textContent ?? '').replace(zeroWidth, '');
      })
      .join(String.fromCharCode(10));
  });

export async function replaceEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}
