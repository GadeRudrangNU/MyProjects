import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addFile, createInviteLink, devLogin } from '../e2e/helpers';

const OUT = resolve(import.meta.dirname, '../../../docs/screenshots');

const FIZZBUZZ = `// Collaborative FizzBuzz: edit this together, live.
function fizzbuzz(n) {
  if (n % 15 === 0) return 'FizzBuzz';
  if (n % 3 === 0) return 'Fizz';
  if (n % 5 === 0) return 'Buzz';
  return String(n);
}

for (let i = 1; i <= 15; i++) {
  console.log(fizzbuzz(i));
}
`;

const STATS = `from statistics import mean, median

scores = [88, 92, 79, 95, 84]
print("mean:", mean(scores))
print("median:", median(scores))
print("best:", max(scores))
`;

/** Sets the document through CodeMirror's view so formatting is exact; Yjs syncs it like a normal edit. */
async function setDoc(page: Page, text: string) {
  await page.locator('.cm-content').evaluate((el, t) => {
    const view = (el as unknown as { cmTile: { view: { state: { doc: { length: number } }; dispatch: (tr: unknown) => void } } }).cmTile.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, text);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

test('capture README screenshots', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const ctx = (await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } }));
  const page = await ctx.newPage();

  await page.goto('/login');
  await shot(page, 'login');

  await devLogin(page, 'Olivia');
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Name').fill('Quack Team');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('FizzBuzz Demo');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/p\//);

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Path').fill('src');
  await page.getByRole('button', { name: 'Create' }).click();
  await addFile(page, 'src/stats.py');
  await setDoc(page, STATS);
  await addFile(page, 'src/fizzbuzz.js');
  await setDoc(page, FIZZBUZZ);
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();

  const editorInvite = await createInviteLink(page, 'editor');
  const viewerInvite = await createInviteLink(page, 'viewer');

  const eddie = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const ep = await eddie.newPage();
  await devLogin(ep, 'Eddie');
  await ep.goto(new URL(editorInvite).pathname);
  const vera = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const vp = await vera.newPage();
  await devLogin(vp, 'Vera');
  await vp.goto(new URL(viewerInvite).pathname);

  await shot(page, 'workspace');

  // Everyone opens the project and the JS file.
  await page.getByRole('link', { name: 'FizzBuzz Demo' }).click();
  for (const p of [ep, vp]) {
    await p.getByRole('link', { name: 'FizzBuzz Demo' }).click();
    await p.getByRole('treeitem', { name: /^src/ }).click();
    await p.getByRole('treeitem', { name: /fizzbuzz\.js/ }).click();
    await expect(p.locator('.cm-content')).toBeVisible();
  }
  await page.getByRole('treeitem', { name: /^src/ }).click();
  await page.getByRole('treeitem', { name: /stats\.py/ }).click();
  await page.getByRole('treeitem', { name: /fizzbuzz\.js/ }).click();
  await expect(page.getByLabel('Collaborators online')).toContainText('Eddie');
  await expect(page.getByLabel('Collaborators online')).toContainText('Vera');

  // Eddie puts his cursor mid-function so his name label shows on Olivia's screen.
  await ep.locator('.cm-line', { hasText: "return 'Fizz';" }).click({ position: { x: 300, y: 8 } });
  await ep.keyboard.type(' // fizz!');
  await page.waitForTimeout(800);
  await shot(page, 'collaboration');

  await shot(vp, 'viewer-readonly');

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('log', { name: 'Console output' })).toContainText('FizzBuzz');
  await shot(page, 'run-javascript');

  await page.getByRole('treeitem', { name: /stats\.py/ }).click();
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.getByRole('log', { name: 'Console output' })).toContainText('mean: 87.6', { timeout: 90_000 });
  await shot(page, 'run-python');

  await ep.context().setOffline(true);
  await expect(ep.getByRole('status').filter({ hasText: /Offline/ })).toBeVisible({ timeout: 30_000 });
  await shot(ep, 'offline');
  await ep.context().setOffline(false);

  await Promise.all([ctx.close(), eddie.close(), vera.close()]);
});
