import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const API = process.env.E2E_API_URL ?? 'http://localhost:8080'
export const MAIL = process.env.E2E_MAIL_URL ?? 'http://localhost:8081'
export const PARTNER = process.env.E2E_PARTNER_URL ?? 'http://localhost:5174'
export const STAFF_PASSWORD = 'TrustPass#2025'

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signInAndWait(page: Page, email: string, password: string) {
  await signIn(page, email, password)
  await page.waitForURL(/\/app$/)
}

export async function expectNoSeriousA11yIssues(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} elements)`),
    `accessibility violations on ${label}`,
  ).toEqual([])
}

export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
