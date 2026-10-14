import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { createInviteLink, createProjectWithFile, devLogin, joinAndOpenFile } from '../e2e/helpers';

// gifenc is CommonJS, so its named exports are read off the default import.
const { GIFEncoder, applyPalette, quantize } = gifenc;
const OUT = resolve(import.meta.dirname, '../../../docs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Frame {
  t: number;
  rgba: Uint8Array;
}

/** Encodes timestamped frames into a looping GIF, merging identical neighbours so idle moments cost nothing. */
function encodeGif(frames: Frame[], width: number, height: number, holdLastMs: number) {
  // One shared palette sampled across the whole recording keeps colours stable and the file small.
  const step = Math.max(1, Math.floor(frames.length / 8));
  const sample = frames.filter((_, i) => i % step === 0).map((f) => f.rgba);
  const joined = new Uint8Array(sample.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  for (const s of sample) {
    joined.set(s, offset);
    offset += s.length;
  }
  const palette = quantize(joined, 128);

  const gif = GIFEncoder();
  let pending: { index: Uint8Array; delay: number } | null = null;
  let first = true;
  const flush = () => {
    if (!pending) return;
    gif.writeFrame(pending.index, width, height, { palette: first ? palette : undefined, delay: Math.max(20, pending.delay), repeat: 0 });
    first = false;
    pending = null;
  };
  frames.forEach((f, i) => {
    const index = applyPalette(f.rgba, palette);
    const next = frames[i + 1];
    const delay = next ? next.t - f.t : holdLastMs;
    if (pending && pending.index.length === index.length && pending.index.every((v, k) => v === index[k])) {
      pending.delay += delay;
    } else {
      flush();
      pending = { index, delay };
    }
  });
  flush();
  gif.finish();
  return gif.bytes();
}

test('record the README demo GIF', async ({ browser }) => {
  test.setTimeout(240_000);
  const viewport = { width: 1000, height: 620 };
  const ctxOptions = { colorScheme: 'dark' as const, viewport };

  // Set up the scene without recording: Olivia owns a project, Eddie has joined and has the file open.
  const setup = await browser.newContext(ctxOptions);
  const owner = await setup.newPage();
  await devLogin(owner, 'Olivia');
  const projectUrl = await createProjectWithFile(owner, { file: 'demo.js', workspace: 'Quack Team' });
  const invite = await createInviteLink(owner, 'editor');
  const eddieCtx = await browser.newContext(ctxOptions);
  const eddie = await eddieCtx.newPage();
  await devLogin(eddie, 'Eddie');
  await joinAndOpenFile(eddie, invite, 'Hello App', 'demo.js');
  const session = await setup.storageState();
  await setup.close();

  // The recorded view is Olivia's.
  const ctx = await browser.newContext({ ...ctxOptions, storageState: session });
  const page = await ctx.newPage();
  await page.goto(projectUrl);
  await page.getByRole('treeitem', { name: /demo\.js/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Editor for demo.js' }).click();

  const frames: Frame[] = [];
  let recording = true;
  const t0 = Date.now();
  const grabber = (async () => {
    while (recording) {
      const png = await page.screenshot({ type: 'png', caret: 'initial' });
      const { data } = PNG.sync.read(png);
      frames.push({ t: Date.now() - t0, rgba: new Uint8Array(data) });
    }
  })();

  await sleep(800);
  await page.keyboard.type('const total = [3, 4, 5].reduce((a, b) => a + b, 0);', { delay: 40 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('console.log("total:", total);', { delay: 40 });
  await sleep(700);

  // Eddie adds a line from his own window; it appears live on Olivia's screen with his name on the cursor.
  await eddie.locator('.cm-content').click();
  await eddie.keyboard.press('ControlOrMeta+End');
  await eddie.keyboard.press('Enter');
  await eddie.keyboard.type('console.log("hi from Eddie");', { delay: 55 });
  await sleep(1400);

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('log', { name: 'Console output' })).toContainText('hi from Eddie');
  await sleep(2200);

  recording = false;
  await grabber;
  await Promise.all([ctx.close(), eddieCtx.close()]);

  const gifBytes = encodeGif(frames, viewport.width, viewport.height, 2500);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/demo.gif`, gifBytes);
  console.log(`demo.gif: ${frames.length} frames captured, ${(gifBytes.length / 1024 / 1024).toFixed(2)} MB`);
});
