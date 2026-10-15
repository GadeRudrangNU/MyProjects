import { expect, test } from '@playwright/test'
import { STAFF_PASSWORD, expectNoSeriousA11yIssues, signInAndWait } from './helpers'

test.describe('staff console', () => {
  test('landing and sign in pages are accessible', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /One identity/ })).toBeVisible()
    await expectNoSeriousA11yIssues(page, 'landing')
    await page.goto('/login')
    await expectNoSeriousA11yIssues(page, 'login')
  })

  test('members cannot open the staff area', async ({ page }) => {
    await signInAndWait(page, 'member@trustpass.dev', STAFF_PASSWORD)
    await expect(page.getByRole('link', { name: 'Staff console' })).toHaveCount(0)
    await page.goto('/admin')
    await expect(page.getByText('Your account does not have access to this area.')).toBeVisible()
  })

  test('an admin sees metrics, users, audit entries and jobs, and can add a location with a slot', async ({ page }) => {
    await signInAndWait(page, 'admin@trustpass.dev', STAFF_PASSWORD)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Signups per day/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Failed logins per day/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Bookings per location/ })).toBeVisible()
    await expect(page.getByText('Verification pass rate')).toBeVisible()
    await expectNoSeriousA11yIssues(page, 'admin dashboard')

    await page.getByRole('link', { name: 'Users' }).click()
    await page.getByLabel('Search by name or email').fill('member@trustpass.dev')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('row', { name: /member@trustpass.dev/ })).toBeVisible()
    await expectNoSeriousA11yIssues(page, 'admin users')

    await page.getByRole('link', { name: 'Audit log' }).click()
    await expect(page.getByRole('cell', { name: 'LOGIN' }).first()).toBeVisible()
    await page.getByLabel('Filter by action').fill('login')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('cell', { name: 'LOGIN', exact: true }).first()).toBeVisible()

    await page.getByRole('link', { name: 'Jobs' }).click()
    await expect(page.getByRole('heading', { name: 'Background jobs' })).toBeVisible()
    await page.getByLabel('Status').selectOption('DONE')
    await expect(page.getByRole('cell', { name: 'EMAIL_VERIFICATION' }).first().or(page.getByText('No jobs with this status.'))).toBeVisible()

    await page.getByRole('link', { name: 'Locations' }).click()
    const name = `E2E Studio ${Date.now()}`
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Address').fill('7 Test Lane')
    await page.getByRole('button', { name: 'Add location' }).click()
    await expect(page.getByText(`Created ${name}.`)).toBeVisible()

    const start = new Date(Date.now() + 2 * 24 * 3600 * 1000)
    const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    await page.getByLabel('Starts').fill(local)
    await page.getByRole('button', { name: 'Add slot' }).click()
    await expect(page.getByText('Slot added.')).toBeVisible()
    await expect(page.getByText('0 of 4 booked')).toBeVisible()
  })
})
