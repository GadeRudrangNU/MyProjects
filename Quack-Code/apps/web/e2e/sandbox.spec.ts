import { expect, test, type Page } from '@playwright/test';
import { addFile, createProjectWithFile, devLogin, replaceEditorText } from './helpers';

const consoleOutput = (page: Page) => page.getByRole('log', { name: 'Console output' });
// The visible summary line (the screen-reader announcement repeats it, so plain getByText is ambiguous).
const summary = (page: Page) => page.getByRole('region', { name: 'Console' }).locator('span.truncate');
const run = (page: Page) => page.getByRole('button', { name: /Run/ }).click();

test.describe('running code', () => {
  test('JavaScript and Python run in the sandbox, with timeouts and no network', async ({ page }) => {
    test.setTimeout(150_000);
    await devLogin(page, 'Runner');
    await createProjectWithFile(page);

    await test.step('runs JavaScript and shows console output', async () => {
      await replaceEditorText(page, "console.log('sum', [1,2,3].reduce((a,b)=>a+b)); console.error('oops')");
      await run(page);
      await expect(consoleOutput(page)).toContainText('sum 6');
      await expect(consoleOutput(page)).toContainText('oops');
      await expect(summary(page)).toHaveText(/Finished in \d+ ms/);
    });

    await test.step('keyboard shortcut runs the file', async () => {
      await replaceEditorText(page, "console.log('via shortcut')");
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(consoleOutput(page)).toContainText('via shortcut');
    });

    await test.step('reports errors', async () => {
      await replaceEditorText(page, 'null.x');
      await run(page);
      await expect(consoleOutput(page)).toContainText('TypeError');
      await expect(summary(page)).toHaveText('Failed with an error');
    });

    await test.step('the sandbox cannot reach the network or the app', async () => {
      await replaceEditorText(page, "try { await fetch('/api/v1/me'); console.log('LEAKED'); } catch (e) { console.log('blocked'); } console.log(typeof document, typeof localStorage);");
      await run(page);
      await expect(consoleOutput(page)).toContainText('blocked');
      await expect(consoleOutput(page)).toContainText('undefined undefined');
      await expect(consoleOutput(page)).not.toContainText('LEAKED');
    });

    await test.step('an infinite loop is stopped automatically and the sandbox keeps working', async () => {
      await replaceEditorText(page, 'while (true) {}');
      await run(page);
      await expect(summary(page)).toHaveText(/took longer than 10 seconds/, { timeout: 20_000 });
      await replaceEditorText(page, "console.log('alive again')");
      await run(page);
      await expect(consoleOutput(page)).toContainText('alive again');
    });

    await test.step('Stop ends a run on demand', async () => {
      await replaceEditorText(page, 'setInterval(() => {}, 100)');
      await run(page);
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(summary(page)).toHaveText('Stopped');
    });

    await test.step('runs Python via Pyodide', async () => {
      await addFile(page, 'hello.py');
      await replaceEditorText(page, "print('hello from python', sum(range(10)))");
      await run(page);
      await expect(consoleOutput(page)).toContainText('hello from python 45', { timeout: 90_000 });
      await replaceEditorText(page, '1/0');
      await run(page);
      await expect(consoleOutput(page)).toContainText('ZeroDivisionError');
    });
  });

  test('files that cannot run say so', async ({ page }) => {
    await devLogin(page, 'Reader');
    await createProjectWithFile(page, { file: 'notes.txt' });
    await expect(page.getByRole('button', { name: /Run/ })).toBeDisabled();
    await expect(page.getByText('This file type cannot be run')).toBeVisible();
  });
});
