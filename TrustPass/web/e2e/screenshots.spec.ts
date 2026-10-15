import { expect, test } from '@playwright/test'
import { STAFF_PASSWORD, signInAndWait } from './helpers'

test.skip(!process.env.E2E_SCREENSHOTS, 'only runs when refreshing the documentation screenshots')

const out = (name: string) => `../docs/screenshots/${name}.png`

test.use({ viewport: { width: 1280, height: 800 } })

test('capture the main screens', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.screenshot({ path: out('login') })

  await signInAndWait(page, 'member@trustpass.dev', STAFF_PASSWORD)
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible()
  await page.screenshot({ path: out('member-overview') })

  await page.goto('/app/membership')
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible()
  await page.screenshot({ path: out('membership') })

  await page.goto('/app/book')
  await expect(page.getByTestId('slot').first()).toBeVisible()
  await page.screenshot({ path: out('booking') })

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signInAndWait(page, 'admin@trustpass.dev', STAFF_PASSWORD)
  await page.goto('/admin')
  await expect(page.getByRole('img', { name: /Signups per day/ })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out('admin-dashboard') })

  await page.goto('/admin/verifications')
  await expect(page.getByRole('heading', { name: 'Verification review' })).toBeVisible()
  await page.screenshot({ path: out('verification-review') })

  await page.goto('/admin/audit')
  await expect(page.getByRole('cell', { name: 'LOGIN' }).first()).toBeVisible()
  await page.screenshot({ path: out('audit-log') })
})
