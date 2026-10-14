import { expect, test } from '@playwright/test'

test('devices overview lists the fleet and filters by type', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('device-1')).toBeVisible()
  const all = await page.locator('[data-testid^="device-"]').count()
  await page.getByLabel('Filter by type').selectOption('BMU')
  await expect.poll(() => page.locator('[data-testid^="device-"]').count()).toBeLessThan(all)
})

test('device detail streams live telemetry and acknowledges commands', async ({ page }) => {
  await page.goto('/devices/2')
  await expect(page.getByText('live', { exact: true })).toBeVisible()
  await expect(page.getByTestId('latency')).toContainText(/p50 \d+ ms/, { timeout: 15_000 })
  await page.getByLabel('Command').selectOption('GET_VERSION')
  await page.getByLabel('Arguments').fill('{}')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('command-history')).toContainText(/ACK in/)
})

test('launching a run fills the results matrix and opens a report', async ({ page }) => {
  await page.goto('/runs')
  await page.getByLabel('Plan').selectOption({ label: 'quick_health (3 tests)' })
  await page.getByLabel('Device type').selectOption('BMU')
  await page.getByRole('button', { name: 'Select all' }).click()
  await page.getByRole('button', { name: /^Launch on/ }).click()

  await expect(page).toHaveURL(/\/runs\/\d+/)
  const verdictCells = page.locator('[data-testid^="cell-"] [data-verdict]')
  await expect(verdictCells.first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.badge.run-completed')).toBeVisible({ timeout: 90_000 })

  await verdictCells.first().click()
  await expect(page.getByTestId('cell-report')).toBeVisible()
  await expect(page.getByText('Step timeline')).toBeVisible()
})

test('invalid test definitions are rejected with a line number', async ({ page }) => {
  await page.goto('/definitions')
  await expect(page.getByTestId('yaml-editor')).toBeVisible()
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('name: broken_one\nkind: custom\ndevice_type: BCM\nversion: 1\nsteps:\n  - assert: "nope >"\n')
  await page.getByRole('button', { name: 'Validate and save' }).click()
  await expect(page.getByTestId('definition-errors')).toContainText(/line \d+/)
})

test('scorecard page renders a campaign when one exists', async ({ page }) => {
  await page.goto('/scorecard')
  await expect(page.getByRole('heading', { name: 'Validation scorecard' })).toBeVisible()
})
