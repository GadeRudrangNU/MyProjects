import { AxiosError } from 'axios'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API, server } from '@/test/server'
import { customInstance, errorCode, errorMessage, refreshAccessToken, tokenStore } from './client'

function apiError(status: number, body: unknown) {
  return new AxiosError('failed', 'ERR', undefined, undefined, {
    status,
    data: body,
    statusText: '',
    headers: {},
    config: { headers: {} } as never,
  })
}

describe('api client', () => {
  beforeEach(() => tokenStore.set(null))

  it('sends the bearer token once it has one', async () => {
    let header: string | null = null
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        header = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    tokenStore.set('abc')
    await customInstance({ url: '/me', method: 'GET' })
    expect(header).toBe('Bearer abc')
  })

  it('refreshes once and replays the request when the access token expired', async () => {
    let refreshes = 0
    server.use(
      http.get(`${API}/me`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer fresh' ? HttpResponse.json({ name: 'Mia' }) : HttpResponse.json({}, { status: 401 }),
      ),
      http.post(`${API}/auth/refresh`, () => {
        refreshes++
        return HttpResponse.json({ accessToken: 'fresh', expiresIn: 900 })
      }),
    )
    tokenStore.set('stale')
    const result = await customInstance<{ name: string }>({ url: '/me', method: 'GET' })
    expect(result.name).toBe('Mia')
    expect(refreshes).toBe(1)
    expect(tokenStore.get()).toBe('fresh')
  })

  it('shares a single refresh between concurrent callers', async () => {
    let refreshes = 0
    server.use(
      http.post(`${API}/auth/refresh`, async () => {
        refreshes++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ accessToken: 'shared', expiresIn: 900 })
      }),
    )
    const tokens = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])
    expect(tokens).toEqual(['shared', 'shared', 'shared'])
    expect(refreshes).toBe(1)
  })

  it('reports a lost session when the refresh fails', async () => {
    let lost = false
    tokenStore.onSessionLost(() => {
      lost = true
    })
    server.use(http.get(`${API}/me`, () => HttpResponse.json({}, { status: 401 })))
    tokenStore.set('stale')
    await expect(customInstance({ url: '/me', method: 'GET' })).rejects.toBeTruthy()
    expect(lost).toBe(true)
    expect(tokenStore.get()).toBeNull()
    tokenStore.onSessionLost(null)
  })

  it('turns server errors into readable messages', () => {
    expect(errorMessage(apiError(400, { code: 'VALIDATION_FAILED', message: 'Request validation failed', fieldErrors: { email: 'must be a valid email' } }))).toBe('must be a valid email')
    expect(errorMessage(apiError(409, { code: 'SLOT_FULL', message: 'This slot is full' }))).toBe('This slot is full')
    expect(errorCode(apiError(409, { code: 'SLOT_FULL' }))).toBe('SLOT_FULL')
    expect(errorMessage(new Error('x'), 'fallback')).toBe('fallback')
    expect(errorCode(new Error('x'))).toBeUndefined()
  })
})
