import { chromium } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080'
const out = process.env.FRAMES_DIR ?? '../out/frames'
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
let n = 0
const shot = async (wait = 0) => {
  if (wait) await page.waitForTimeout(wait)
  await page.screenshot({ path: `${out}/${String(n++).padStart(3, '0')}.png` })
}

await page.goto(base)
await page.getByTestId('device-1').waitFor()
await shot(800)
await shot(600)

await page.getByTestId('device-1').click()
await page.getByTestId('chart-cell_v_1').waitFor()
await page.getByTestId('latency').getByText(/p50 \d+ ms/).waitFor()
await shot(2500)
await shot(1500)

await page.request.post(`${base}/lab/faults`, { data: { device_id: 1, type: 'drift', severity: 0.03, duration_s: 40 } })
for (let i = 0; i < 5; i++) await shot(1400)
await page.getByLabel('Command').selectOption('GET_VERSION')
await page.getByLabel('Arguments').fill('{}')
await page.getByRole('button', { name: 'Send' }).click()
await shot(900)
await page.request.delete(`${base}/lab/faults`)

await page.goto(`${base}/runs`)
await page.getByLabel('Plan').selectOption({ label: 'quick_health (3 tests)' })
await page.getByRole('button', { name: 'Select all' }).click()
await shot(500)
await page.request.post(`${base}/lab/faults`, { data: { device_id: 4, type: 'wrong_firmware', severity: 1, duration_s: 60 } })
await page.getByRole('button', { name: /^Launch on/ }).click()
await page.getByTestId('matrix').waitFor()
for (let i = 0; i < 7; i++) await shot(2200)
await page.locator('[data-verdict="FAIL"]').first().click({ timeout: 20000 }).catch(() => {})
await shot(1200)
await page.request.delete(`${base}/lab/faults`)

await page.goto(`${base}/scorecard`)
await page.getByTestId('confusion').waitFor({ timeout: 15000 }).catch(() => {})
await shot(1200)
await shot(800)

await browser.close()
console.log(`captured ${n} frames`)
