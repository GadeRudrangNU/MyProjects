import { expect, test } from '@playwright/test';
import { createInviteLink, createProjectWithFile, editorText, joinAndOpenFile, newUser, replaceEditorText } from './helpers';

test.describe('multi-user collaboration', () => {
  test('editors converge, viewers are read-only, offline edits merge on reconnect', async ({ browser }) => {
    const owner = await newUser(browser, 'Olivia');
    await createProjectWithFile(owner.page);
    await expect(owner.page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();

    const editorInvite = await createInviteLink(owner.page, 'editor');
    const viewerInvite = await createInviteLink(owner.page, 'viewer');
    await owner.page.getByRole('link', { name: 'Hello App' }).click();
    await owner.page.getByRole('treeitem', { name: /main\.js/ }).click();

    const editor = await newUser(browser, 'Eddie');
    await joinAndOpenFile(editor.page, editorInvite);
    const viewer = await newUser(browser, 'Vera');
    await joinAndOpenFile(viewer.page, viewerInvite);

    await test.step('concurrent edits converge on every client', async () => {
      await replaceEditorText(owner.page, 'const owner = 1;');
      await expect.poll(() => editorText(editor.page)).toContain('const owner = 1;');
      await editor.page.locator('.cm-content').click();
      await editor.page.keyboard.press('ControlOrMeta+End');
      await editor.page.keyboard.type(' // from eddie');
      await expect.poll(() => editorText(owner.page)).toContain('// from eddie');
      await expect.poll(() => editorText(viewer.page)).toContain('// from eddie');
      expect(await editorText(owner.page)).toBe(await editorText(editor.page));
    });

    await test.step('presence shows who is online, by name', async () => {
      await expect(owner.page.getByLabel('Collaborators online')).toContainText('Eddie is online');
      await expect(owner.page.getByLabel('Collaborators online')).toContainText('Vera is online');
    });

    await test.step('viewers cannot change the document', async () => {
      await expect(viewer.page.getByText('Read-only')).toBeVisible();
      const before = await editorText(owner.page);
      await viewer.page.locator('.cm-content').click();
      await viewer.page.keyboard.type('HACKED');
      await owner.page.waitForTimeout(500);
      expect(await editorText(owner.page)).toBe(before);
      expect(await editorText(viewer.page)).not.toContain('HACKED');
    });

    await test.step('per-user undo never reverts a collaborator', async () => {
      await owner.page.locator('.cm-content').click();
      await owner.page.keyboard.press('ControlOrMeta+End');
      await owner.page.keyboard.type(' // owner-edit');
      await expect.poll(() => editorText(editor.page)).toContain('// owner-edit');
      await editor.page.locator('.cm-content').click();
      await editor.page.keyboard.press('ControlOrMeta+End');
      await editor.page.keyboard.type(' // editor-edit');
      await expect.poll(() => editorText(owner.page)).toContain('// editor-edit');
      // Eddie undoes: his own edit goes, Olivia's stays.
      await editor.page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editorText(owner.page)).not.toContain('// editor-edit');
      expect(await editorText(owner.page)).toContain('// owner-edit');
    });

    await test.step('offline edits are kept locally and merge on reconnect', async () => {
      await editor.context.setOffline(true);
      await expect(editor.page.getByRole('status').filter({ hasText: /Offline|Reconnecting/ })).toBeVisible({ timeout: 30_000 });
      await editor.page.locator('.cm-content').click();
      await editor.page.keyboard.press('ControlOrMeta+Home');
      await editor.page.keyboard.type('// offline-edit\n');
      // Meanwhile the owner keeps working online.
      await owner.page.locator('.cm-content').click();
      await owner.page.keyboard.press('ControlOrMeta+End');
      await owner.page.keyboard.type(' // online-edit');
      await editor.context.setOffline(false);
      await expect(editor.page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible({ timeout: 45_000 });
      await expect.poll(() => editorText(owner.page), { timeout: 20_000 }).toContain('// offline-edit');
      await expect.poll(() => editorText(editor.page), { timeout: 20_000 }).toContain('// online-edit');
      expect(await editorText(owner.page)).toBe(await editorText(editor.page));
    });

    await Promise.all([owner, editor, viewer].map((u) => u.context.close()));
  });
});
