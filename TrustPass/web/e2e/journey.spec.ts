import { expect, test } from '@playwright/test'
import { API, MAIL, PARTNER, PNG_BYTES, STAFF_PASSWORD, expectNoSeriousA11yIssues, signIn, signInAndWait } from './helpers'
import { totp } from './totp'

const stamp = Date.now()
const member = { name: 'Eve Tester', email: `eve.${stamp}@example.test`, password: 'Sup3r$ecret-pass' }

test('a member enrolls, secures the account, subscribes, books, gets verified and signs in to a partner', async ({ page, browser, request }) => {
  let secret = ''

  await test.step('sign up and verify the email through the development mailbox', async () => {
    await page.goto('/signup')
    await expectNoSeriousA11yIssues(page, 'signup')
    await page.getByLabel('Full name').fill(member.name)
    await page.getByLabel('Email').fill(member.email)
    await page.getByLabel('Password').fill(member.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Check your email')).toBeVisible()

    await page.getByRole('link', { name: 'Open the development mailbox' }).click()
    const mail = page.getByTestId('mail').filter({ hasText: 'Verify your TrustPass email' })
    await expect(mail).toBeVisible({ timeout: 45_000 })
    await mail.getByRole('link').click()
    await expect(page.getByText('Your email address is verified')).toBeVisible()
  })

  await test.step('cannot sign in with the wrong password', async () => {
    await signIn(page, member.email, 'Not-The-Password-1!')
    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
  })

  await test.step('sign in and see the overview', async () => {
    await signInAndWait(page, member.email, member.password)
    await expect(page.getByRole('heading', { name: 'Hello, Eve' })).toBeVisible()
    await expectNoSeriousA11yIssues(page, 'member overview')
  })

  await test.step('turn on two-factor with an authenticator code', async () => {
    await page.getByRole('link', { name: 'Account' }).click()
    await expect(page.getByText('Active sessions')).toBeVisible()
    await page.getByRole('button', { name: 'Set up two-factor' }).click()
    await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible()
    secret = (await page.locator('code').first().innerText()).trim()
    await page.getByLabel('Code from your app').fill(totp(secret))
    await page.getByRole('button', { name: 'Turn on' }).click()
    await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(8)
    await expectNoSeriousA11yIssues(page, 'account')
  })

  await test.step('signing in now asks for the second factor', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await signIn(page, member.email, member.password)
    await expect(page.getByText('Two-factor code')).toBeVisible()
    await page.getByLabel('Code').fill('000000')
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByLabel('Code').fill(totp(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByRole('heading', { name: 'Hello, Eve' })).toBeVisible()
  })

  await test.step('subscribe, retrying safely through the flaky payment provider', async () => {
    await page.getByRole('link', { name: 'Membership' }).click()
    const paid = page.getByText('Payment received. Your membership is active.')
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.getByRole('button', { name: 'Subscribe to Basic' }).click()
      await expect(paid.or(page.getByRole('alert'))).toBeVisible({ timeout: 30_000 })
      if (await paid.isVisible()) break
    }
    await expect(paid).toBeVisible()
    await expect(page.getByRole('table')).toContainText('SUCCEEDED'.toLowerCase())
  })

  await test.step('book a slot', async () => {
    await page.getByRole('link', { name: 'Book', exact: true }).click()
    const slot = page.getByTestId('slot').filter({ has: page.getByRole('button', { name: 'Book', exact: true }) }).first()
    await expect(slot).toBeVisible()
    await slot.getByRole('button', { name: 'Book', exact: true }).click()
    await expect(page.getByText('You are booked.')).toBeVisible()
    await expectNoSeriousA11yIssues(page, 'booking')
    await page.getByRole('link', { name: 'My bookings' }).click()
    await expect(page.getByText('confirmed')).toBeVisible()
  })

  await test.step('submit an identity document and wait for the worker checks', async () => {
    await page.getByRole('link', { name: 'Identity' }).click()
    await page.getByLabel('Date of birth').fill('1990-04-02')
    await page.getByLabel('ID number').fill(`E${String(stamp).slice(-8)}`)
    await page.getByLabel('Expiry date').fill('2034-01-01')
    await page.getByLabel('Document image').setInputFiles({ name: 'passport.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_BYTES, Buffer.from(String(stamp))]) })
    await page.getByRole('button', { name: 'Submit for verification' }).click()
    await expect(page.getByText('Submitted. We will email you')).toBeVisible()
    await expect(page.getByText('in review', { exact: true })).toBeVisible({ timeout: 60_000 })
  })

  await test.step('a reviewer approves it', async () => {
    const context = await browser.newContext()
    const reviewer = await context.newPage()
    await signInAndWait(reviewer, 'reviewer@trustpass.dev', STAFF_PASSWORD)
    await reviewer.goto('/admin')
    await expect(reviewer).toHaveURL(/\/admin\/verifications/)
    await reviewer.getByRole('button', { name: new RegExp(member.email) }).click()
    await expect(reviewer.getByText('All checks passed')).toBeVisible()
    await expectNoSeriousA11yIssues(reviewer, 'verification review')
    await reviewer.getByRole('button', { name: 'Approve' }).click()
    await expect(reviewer.getByText('Select a submission to review it.')).toBeVisible()
    await context.close()
  })

  await test.step('the member sees the result and gets an email', async () => {
    await page.reload()
    await expect(page.getByText('Your identity is verified.')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => JSON.stringify(await (await request.get(`${MAIL}/dev/mail`, { params: { to: member.email } })).json()), { timeout: 60_000 })
      .toContain('Your identity is verified')
  })

  await test.step('sign in to the partner app with TrustPass', async () => {
    const context = await browser.newContext()
    const partner = await context.newPage()
    await partner.goto(PARTNER)
    await expectNoSeriousA11yIssues(partner, 'partner home')
    await partner.getByRole('button', { name: 'Sign in with TrustPass' }).click()

    await expect(partner).toHaveURL(new RegExp(`${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sso/login`))
    await partner.getByLabel('Email').fill(member.email)
    await partner.getByLabel('Password').fill(member.password)
    await partner.getByLabel(/Authenticator code/).fill(totp(secret))
    await partner.getByRole('button', { name: 'Sign in' }).click()

    await expect(partner.getByText('is asking to use your TrustPass identity')).toBeVisible()
    await expect(partner.getByText('Your date of birth is never shared')).toBeVisible()
    await partner.getByRole('button', { name: 'Allow' }).click()

    await expect(partner).toHaveURL(new RegExp(`${PARTNER}/callback`))
    await expect(partner.locator('#verdict')).toContainText('verified adult over 21')
    await expect(partner.locator('#claim')).toHaveText('true')
    await expect(partner.getByText('Never shared')).toBeVisible()
    await context.close()
  })
})
