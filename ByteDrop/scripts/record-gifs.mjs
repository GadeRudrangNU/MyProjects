// Records short walkthrough GIFs of the real stack (seeded data) for the README.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import gifenc from "gifenc";
import { stackUrls, startStack, stopStack } from "./e2e-stack.mjs";
import { apiDir, root, webDir } from "./lib/proc.mjs";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const sharp = createRequire(path.join(apiDir, "package.json"))("sharp");
const playwright = await import(pathToFileURL(createRequire(path.join(webDir, "package.json")).resolve("@playwright/test")).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const out = path.join(root, "docs", "media");
mkdirSync(out, { recursive: true });

async function encode(name, frames, width) {
  const gif = GIFEncoder();
  let size = { w: 0, h: 0 };
  for (const { png, delay } of frames) {
    const img = sharp(png).resize({ width });
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256, { format: "rgb565" });
    gif.writeFrame(applyPalette(rgba, palette, "rgb565"), info.width, info.height, { palette, delay });
    size = { w: info.width, h: info.height };
  }
  gif.finish();
  const file = path.join(out, `${name}.gif`);
  writeFileSync(file, gif.bytes());
  console.log(`  ${name}.gif  ${size.w}x${size.h}  ${frames.length} frames  ${(gif.bytes().length / 1024).toFixed(0)} KB`);
}

class Recorder {
  frames = [];
  constructor(page) {
    this.page = page;
  }
  async snap(delay = 900) {
    await this.page.waitForTimeout(250);
    this.frames.push({ png: await this.page.screenshot(), delay });
  }
}

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@bytedrop.dev");
  await page.getByLabel("Password").fill("Demo#2025-pass");
}

async function filesAndSharing(browser) {
  const ctx = await browser.newContext({ baseURL: stackUrls.web, viewport: { width: 1100, height: 680 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const r = new Recorder(page);
  await login(page);
  await r.snap(1000);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/projects/);
  await r.snap(900);
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await page.waitForURL(/files/);
  await page.getByLabel("Bucket", { exact: true }).selectOption("acme-assets");
  const list = page.getByRole("listbox", { name: /Files in acme-assets/ });
  await list.getByRole("option").first().waitFor();
  await r.snap(1100);
  await list.focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+ArrowDown");
    await r.snap(450);
  }
  await page.keyboard.press("Escape");
  await page.getByLabel(/^Search/).fill("shot-0");
  await list.getByRole("option").first().waitFor();
  await r.snap(1000);
  await list.getByRole("option").first().dblclick();
  await page.getByRole("dialog").getByRole("img").waitFor();
  await page.waitForTimeout(500);
  await r.snap(1600);
  await page.keyboard.press("Escape");
  await page.getByLabel("Bucket", { exact: true }).selectOption("acme-private");
  const priv = page.getByRole("listbox", { name: /Files in acme-private/ });
  await priv.getByRole("option").first().waitFor();
  await priv.getByRole("option", { name: /contracts\/msa/ }).click();
  await r.snap(900);
  await page.getByRole("button", { name: "Share" }).click();
  await r.snap(900);
  await page.getByLabel("Link expires after").selectOption({ label: "24 hours" });
  await page.getByRole("button", { name: "Create link" }).click();
  await page.getByLabel("Link", { exact: true }).waitFor();
  await r.snap(2200);
  await encode("files-and-sharing", r.frames, 960);
  await ctx.close();
}

async function resumableUpload(browser) {
  const ctx = await browser.newContext({ baseURL: stackUrls.web, viewport: { width: 1100, height: 680 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const r = new Recorder(page);
  await page.route("**/v1/projects/*/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((res) => setTimeout(res, 700));
    await route.continue();
  });
  await login(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/projects/);
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await page.waitForURL(/files/);
  await page.getByLabel("Bucket", { exact: true }).selectOption("acme-assets");
  await page.getByRole("listbox", { name: /Files in acme-assets/ }).getByRole("option").first().waitFor();
  const data = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < data.length; i += 4096) data.writeUInt32LE((i * 2654435761) >>> 0, i);
  await r.snap(800);
  await page.getByLabel("Choose files to upload").setInputFiles({ name: "launch-video.mp4", mimeType: "video/mp4", buffer: data });
  const bar = () => page.getByTestId("upload-item").getByRole("progressbar").first();
  await page.waitForTimeout(600);
  await r.snap(700);
  for (const target of [25, 50]) {
    await page.waitForFunction(
      (t) => Number(document.querySelector('[data-testid="upload-item"] [role=progressbar]')?.getAttribute("aria-valuenow")) >= t,
      target,
      { timeout: 30_000 },
    );
    await r.snap(800);
  }
  await page.getByRole("button", { name: /^Pause launch-video/ }).click();
  await r.snap(1400);
  await page.reload();
  await page.getByTestId("upload-item").waitFor();
  await r.snap(1500);
  await page.getByRole("button", { name: /^Resume launch-video/ }).click();
  await page.waitForTimeout(900);
  await r.snap(800);
  await page.waitForFunction(() => document.querySelector('[data-testid="upload-item"]')?.getAttribute("data-status") === "done", null, { timeout: 60_000 });
  await page.getByLabel(/^Search/).fill("launch");
  await page.getByRole("option", { name: /launch-video/ }).waitFor();
  await r.snap(2200);
  void bar;
  await encode("resumable-upload", r.frames, 960);
  await ctx.close();
}

async function analyticsAndTransforms(browser) {
  const ctx = await browser.newContext({ baseURL: stackUrls.web, viewport: { width: 1100, height: 760 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const r = new Recorder(page);
  await login(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/projects/);
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await page.getByRole("link", { name: "Analytics" }).click();
  await page.getByRole("region", { name: "Charts" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await r.snap(1800);
  await page.getByLabel("Date range").selectOption("14d");
  await page.waitForURL(/range=14d/);
  await page.getByRole("region", { name: "Charts" }).waitFor();
  await page.waitForTimeout(1500);
  await r.snap(1800);
  await page.getByLabel("File type").selectOption("image");
  await page.waitForURL(/kind=image/);
  await page.waitForTimeout(1500);
  await r.snap(1800);
  await page.evaluate(() => window.scrollTo({ top: 520 }));
  await r.snap(1800);
  await page.getByRole("link", { name: "Transforms" }).click();
  await page.getByTestId("size-after").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await r.snap(1800);
  await page.getByLabel("Format").selectOption("avif");
  await page.waitForTimeout(1500);
  await r.snap(1600);
  const slider = page.getByRole("slider", { name: "Width" });
  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await r.snap(2000);
  await encode("analytics-and-transforms", r.frames, 960);
  await ctx.close();
}

async function mobile(browser) {
  const ctx = await browser.newContext({ baseURL: stackUrls.web, viewport: { width: 390, height: 780 }, colorScheme: "light", deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const r = new Recorder(page);
  await login(page);
  await r.snap(1000);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/projects/);
  await r.snap(900);
  await page.getByRole("link", { name: /Acme Media/ }).click();
  await page.waitForURL(/files/);
  await page.getByLabel("Bucket", { exact: true }).selectOption("acme-assets");
  await page.getByRole("listbox", { name: /Files in acme-assets/ }).getByRole("option").first().waitFor();
  await r.snap(1200);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await r.snap(1000);
  await page.getByRole("link", { name: "Analytics" }).click();
  await page.getByRole("region", { name: "Charts" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1300);
  await r.snap(1500);
  await page.evaluate(() => window.scrollTo({ top: 700 }));
  await r.snap(1500);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Webhooks" }).click();
  await page.getByTestId("delivery-row").first().waitFor();
  await r.snap(1500);
  await page.evaluate(() => window.scrollTo({ top: 500 }));
  await r.snap(1500);
  await encode("mobile", r.frames, 390);
  await ctx.close();
}

await startStack();
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge", headless: true });
  console.log("Recording...");
  await filesAndSharing(browser);
  await resumableUpload(browser);
  await analyticsAndTransforms(browser);
  await mobile(browser);
} finally {
  await browser?.close();
  stopStack();
}
process.exit(0);
