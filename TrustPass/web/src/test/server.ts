import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const API = 'http://localhost:8080'

export const memberUser = {
  id: '11111111-aaaa-bbbb-cccc-111111111111',
  email: 'mia@example.test',
  name: 'Mia Member',
  role: 'MEMBER',
  emailVerified: true,
  mfaEnabled: false,
  identityVerified: false,
  ageOver21: false,
  locked: false,
  createdAt: '2026-01-01T00:00:00Z',
}

export const handlers = [
  http.get(`${API}/auth/providers`, () => HttpResponse.json([])),
  http.post(`${API}/auth/refresh`, () => HttpResponse.json({ message: 'no session' }, { status: 401 })),
]

export const server = setupServer(...handlers)
