import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { tokenStore } from '@/api/client'
import { API, memberUser, server } from '@/test/server'
import { renderWithProviders } from '@/test/render'
import LoginPage from './LoginPage'
import MfaPage from './MfaPage'

function Pages() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/mfa" element={<MfaPage />} />
      <Route path="/app" element={<p>member area</p>} />
    </Routes>
  )
}

describe('LoginPage', () => {
  it('asks for both fields before calling the API', async () => {
    renderWithProviders(<Pages />, '/login')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
  })

  it('shows the server message when the credentials are wrong', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid email or password' }, { status: 401 })))
    renderWithProviders(<Pages />, '/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })

  it('offers to resend the verification email when the address is not verified', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email address before signing in' }, { status: 403 })))
    renderWithProviders(<Pages />, '/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('button', { name: /send the verification email again/i })).toBeInTheDocument()
  })

  it('stores the access token in memory and moves on after a successful sign in', async () => {
    server.use(
      http.post(`${API}/auth/login`, () => HttpResponse.json({ status: 'OK', accessToken: 'token-123', expiresIn: 900, user: memberUser })),
    )
    renderWithProviders(<Pages />, '/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3r$ecret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByText('member area')).toBeInTheDocument())
    expect(tokenStore.get()).toBe('token-123')
  })

  it('continues to the two-factor step when the account requires it', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ status: 'MFA_REQUIRED', mfaToken: 'challenge' })))
    renderWithProviders(<Pages />, '/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'mia@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3r$ecret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Two-factor code')).toBeInTheDocument()
  })

  it('lists the configured OAuth providers', async () => {
    server.use(http.get(`${API}/auth/providers`, () => HttpResponse.json([{ id: 'github', name: 'GitHub' }])))
    renderWithProviders(<Pages />, '/login')
    expect(await screen.findByRole('link', { name: 'GitHub' })).toHaveAttribute('href', `${API}/oauth2/authorization/github`)
  })
})
