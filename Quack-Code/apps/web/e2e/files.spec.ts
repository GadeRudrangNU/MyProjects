import { expect, test } from '@playwright/test';
import { createInviteLink, createProjectWithFile, devLogin, editorText, joinAndOpenFile, newUser } from './helpers';

test.describe('managing files', () => {
  test('upload, rename, delete (toolbar and right-click) and invite from the editor window', async ({ page }) => {
    await devLogin(page, 'Filer');
    await createProjectWithFile(page, { file: 'main.js' });
    const fileInput = page.locator('input[type=file]');
    const tree = page.getByRole('tree', { name: 'Project files' });

    await test.step('imports existing text files and refuses non-text ones', async () => {
      await page.getByRole('button', { name: 'New folder' }).click();
      await page.getByLabel('Path').fill('src');
      await page.getByRole('button', { name: 'Create' }).click();
      await tree.getByRole('treeitem', { name: /^src/ }).click(); // uploads go into the selected folder
      await fileInput.setInputFiles([
        { name: 'imported.js', mimeType: 'text/javascript', buffer: Buffer.from("console.log('imported ok')") },
        { name: 'photo.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 255, 254]) },
        { name: 'bad name!.js', mimeType: 'text/javascript', buffer: Buffer.from('x') },
      ]);
      const notice = page.getByRole('status').filter({ hasText: 'Imported 1 file' });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('photo.bin: not a text file');
      await expect(notice).toContainText('bad name!.js');
      await tree.getByRole('treeitem', { name: /imported\.js/ }).click();
      await expect(page.getByRole('textbox', { name: 'Editor for src/imported.js' })).toBeVisible();
      await expect.poll(() => editorText(page)).toContain("console.log('imported ok')");
      await page.locator('.cm-content').click();
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.getByRole('log', { name: 'Console output' })).toContainText('imported ok');
    });

    await test.step('renames from the toolbar and keeps the tab and content', async () => {
      await tree.getByRole('treeitem', { name: /imported\.js/ }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Path').fill('src/renamed.js');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(tree.getByRole('treeitem', { name: /renamed\.js/ })).toBeVisible();
      await expect(tree.getByRole('treeitem', { name: /imported\.js/ })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'renamed.js' })).toBeVisible();
      await expect.poll(() => editorText(page)).toContain('imported ok');
    });

    await test.step('right-click menu offers rename and delete', async () => {
      await tree.getByRole('treeitem', { name: /renamed\.js/ }).click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeVisible();
      await page.getByRole('menuitem', { name: /Delete/ }).click();
      await expect(page.getByRole('dialog', { name: 'Delete' })).toContainText('src/renamed.js');
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(tree.getByRole('treeitem', { name: /renamed\.js/ })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'renamed.js' })).toHaveCount(0);
    });

    await test.step('deletes a folder from the toolbar', async () => {
      await tree.getByRole('treeitem', { name: /^src/ }).click();
      await page.getByRole('toolbar', { name: 'File actions' }).getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('dialog', { name: 'Delete' }).getByRole('button', { name: 'Delete' }).click();
      await expect(tree.getByRole('treeitem', { name: /^src/ })).toHaveCount(0);
      await expect(tree.getByRole('treeitem', { name: /main\.js/ })).toBeVisible();
    });

    await test.step('invites people without leaving the editor', async () => {
      await page.getByRole('button', { name: '+ Invite' }).click();
      await page.getByLabel('Role').selectOption('viewer');
      await page.getByRole('button', { name: 'Create link' }).click();
      await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\/.+/);
    });
  });

  test('viewers see no upload, rename, delete or invite controls', async ({ browser }) => {
    const owner = await newUser(browser, 'Boss');
    await createProjectWithFile(owner.page);
    const link = await createInviteLink(owner.page, 'viewer');
    const viewer = await newUser(browser, 'Watcher');
    await joinAndOpenFile(viewer.page, link);
    await expect(viewer.page.getByRole('button', { name: /Upload/ })).toHaveCount(0);
    await expect(viewer.page.getByRole('toolbar', { name: 'File actions' })).toHaveCount(0);
    await expect(viewer.page.getByRole('button', { name: '+ Invite' })).toHaveCount(0);
    await viewer.page.getByRole('treeitem', { name: /main\.js/ }).click({ button: 'right' });
    await expect(viewer.page.getByRole('menuitem')).toHaveCount(0);
    await owner.context.close();
    await viewer.context.close();
  });
});
