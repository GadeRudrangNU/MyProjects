import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, server } from '@/test/server'
import { renderWithProviders } from '@/test/render'
import SignupPage, { passwordRules } from './SignupPage'

describe('SignupPage', () => {
  it('checks each password rule as the user types', async () => {
    renderWithProviders(<SignupPage />)
    const password = await screen.findByLabelText('Password')
    const item = (label: string) => screen.getByText((_, node) => node?.tagName === 'LI' && node.textContent?.includes(label) === true)

    expect(item('At least 10 characters').textContent).toContain('•')
    await userEvent.type(password, 'Abcdefghij1!')
    for (const rule of passwordRules) {
      expect(item(rule.label).textContent).toContain('✓')
    }
  })

  it('rejects a weak password without calling the API', async () => {
    let called = false
    server.use(http.post(`${API}/auth/signup`, () => ((called = true), HttpResponse.json({}, { status: 202 }))))
    renderWithProviders(<SignupPage />)
    await userEvent.type(await screen.findByLabelText('Full name'), 'Mia Member')
    await userEvent.type(screen.getByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'weak')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('The password does not meet every requirement')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('tells the user to check their email after a successful signup', async () => {
    server.use(http.post(`${API}/auth/signup`, () => HttpResponse.json({ message: 'ok' }, { status: 202 })))
    renderWithProviders(<SignupPage />)
    await userEvent.type(await screen.findByLabelText('Full name'), 'Mia Member')
    await userEvent.type(screen.getByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3r$ecret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(screen.getByText(/mia@example.test/)).toBeInTheDocument()
  })

  it('shows validation errors returned by the server', async () => {
    server.use(http.post(`${API}/auth/signup`, () => HttpResponse.json({ code: 'RATE_LIMITED', message: 'Too many attempts, try again in 30 seconds' }, { status: 429 })))
    renderWithProviders(<SignupPage />)
    await userEvent.type(await screen.findByLabelText('Full name'), 'Mia Member')
    await userEvent.type(screen.getByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3r$ecret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  })
})
