// Records short walkthrough GIFs of the running stack (instance + agent + local model) for the README.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import sharp from "sharp";
import { chromium } from "playwright-core";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(root, "docs", "media");
mkdirSync(out, { recursive: true });
const BASE = "http://127.0.0.1:8070";
const demo = JSON.parse(readFileSync(path.join(root, "docs", "demo_tickets.json"), "utf8"));

async function encode(name, frames, width = 960) {
  const gif = GIFEncoder();
  let size = { w: 0, h: 0 };
  for (const { png, delay } of frames) {
    const { data, info } = await sharp(png).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256, { format: "rgb565" });
    gif.writeFrame(applyPalette(rgba, palette, "rgb565"), info.width, info.height, { palette, delay });
    size = { w: info.width, h: info.height };
  }
  gif.finish();
  writeFileSync(path.join(out, `${name}.gif`), gif.bytes());
  console.log(`  ${name}.gif  ${size.w}x${size.h}  ${frames.length} frames  ${(gif.bytes().length / 1024).toFixed(0)} KB`);
}

class Recorder {
  frames = [];
  constructor(page) {
    this.page = page;
  }
  async snap(delay = 1000) {
    await this.page.waitForTimeout(250);
    this.frames.push({ png: await this.page.screenshot(), delay });
  }
}

async function signIn(page, user, password) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=user_name]", user);
  await page.fill("input[name=password]", password);
}

async function newTicket(page, rec, t) {
  await page.goto(`${BASE}/incident_new.do`);
  await page.fill("input[name=short_description]", t.short_description);
  await rec.snap(700);
  await page.fill("textarea[name=description]", t.description);
  await page.selectOption("select[name=priority]", t.priority || "3");
  await rec.snap(1200);
  await page.click("#create");
  await page.waitForURL(/incident\.do/);
  await rec.snap(1500);
}

async function waitForAi(page, states, timeout = 120000) {
  await page.waitForFunction((s) => s.includes(document.querySelector('[name="u_ai_suggestion_state"]').value), states, { timeout });
}

async function autoRouting(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  const rec = new Recorder(page);
  await signIn(page, "desk.agent", "agent-local");
  await rec.snap(900);
  await page.click("button.primary");
  await page.waitForURL(/incident_list/);
  await rec.snap(900);
  await newTicket(page, rec, demo.auto);
  await waitForAi(page, ["applied_auto"]);
  await page.waitForTimeout(600);
  await rec.snap(2200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await rec.snap(2800);
  await ctx.close();
  await encode("auto-routing", rec.frames);
}

async function approval(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  const rec = new Recorder(page);
  await signIn(page, "desk.agent", "agent-local");
  await page.click("button.primary");
  await page.waitForURL(/incident_list/);
  await newTicket(page, rec, demo.review);
  await waitForAi(page, ["pending"]);
  await page.waitForTimeout(800);
  await rec.snap(2600);
  await page.click("button.action:has-text('Reject')");
  await page.waitForTimeout(300);
  await rec.snap(1800);
  await page.fill("input[name=u_reject_reason]", "I want a person to check the quote first");
  await rec.snap(1300);
  await page.click("button.action:has-text('Reject')");
  await page.waitForFunction(() => document.querySelector('[name="u_ai_suggestion_state"]').value === "rejected", null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await rec.snap(2200);
  await page.click("button.action:has-text('Re-run')");
  await page.waitForFunction(() => document.querySelector('[name="u_ai_suggestion_state"]').value === "pending", null, { timeout: 120000 });
  await page.waitForTimeout(700);
  await rec.snap(2200);
  await page.click("button.action:has-text('Accept')");
  await page.waitForFunction(() => document.querySelector('[name="u_ai_suggestion_state"]').value === "accepted", null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await rec.snap(3000);
  await page.goto(`${BASE}/approvals.do`);
  await rec.snap(2200);
  await ctx.close();
  await encode("human-approval", rec.frames);
}

async function resolveAndKnowledge(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  const rec = new Recorder(page);
  await signIn(page, "desk.agent", "agent-local");
  await page.click("button.primary");
  await page.waitForURL(/incident_list/);
  await newTicket(page, rec, demo.resolve);
  await waitForAi(page, ["applied_auto", "pending"]);
  await page.waitForTimeout(500);
  const state = await page.inputValue('[name="u_ai_suggestion_state"]');
  if (state === "pending") {
    await page.click("button.action:has-text('Accept')");
    await page.waitForFunction(() => document.querySelector('[name="u_ai_suggestion_state"]').value === "accepted", null, { timeout: 30000 });
  }
  await rec.snap(1500);
  await page.fill("textarea[name=close_notes]", demo.resolve.close_notes);
  await rec.snap(1500);
  await page.click("#btn-resolve");
  await page.waitForLoadState();
  await rec.snap(1500);
  await page.goto(`${BASE}/kb.do`);
  await page.waitForFunction(() => document.body.innerText.includes("drafted") || document.body.innerText.includes("skipped_duplicate"), null, { timeout: 120000 });
  await page.waitForTimeout(600);
  await rec.snap(2800);
  const draft = page.locator("table a[href*='kb.do?number=']").first();
  await draft.click();
  await rec.snap(3000);
  await ctx.close();
  await encode("knowledge-article", rec.frames);
}

async function dashboard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  const rec = new Recorder(page);
  await signIn(page, "desk.agent", "agent-local");
  await page.click("button.primary");
  await page.waitForURL(/incident_list/);
  await rec.snap(900);
  await page.goto(`${BASE}/dashboard.do`);
  await page.waitForSelector(".tile");
  await rec.snap(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await rec.snap(2800);
  await page.goto(`${BASE}/runs.do`);
  await rec.snap(2800);
  await ctx.close();
  await encode("dashboard", rec.frames);
}

const which = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge" });
const jobs = { autoRouting, approval, resolveAndKnowledge, dashboard };
for (const [name, fn] of Object.entries(jobs)) {
  if (which.length && !which.includes(name)) continue;
  console.log(name);
  await fn(browser);
}
await browser.close();
