import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

const API = __ENV.API_URL || 'http://localhost:8080'
const PASSWORD = __ENV.PASSWORD || 'TrustPass#2025'
// The API needs TRUSTPASS_SEED_LOAD_USERS=true (members load1..load40) and TRUSTPASS_RATE_LIMIT_ENABLED=false.

const booked = new Counter('bookings_confirmed')
const full = new Counter('bookings_rejected_full')

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 20, duration: '30s', exec: 'browse' },
    rush: { executor: 'per-vu-iterations', vus: 25, iterations: 1, exec: 'rush', startTime: '5s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{scenario:browse}': ['p(95)<800'],
    checks: ['rate>0.98'],
  },
}

function json(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
}

export function setup() {
  const login = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: 'admin@trustpass.dev', password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  check(login, { 'admin signed in': (r) => r.status === 200 })
  const token = login.json('accessToken')

  const location = http.post(`${API}/admin/locations`, JSON.stringify({ name: `Load ${Date.now()}`, address: 'k6 test lane' }), json(token))
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000)
  const slot = http.post(
    `${API}/admin/locations/${location.json('id')}/slots`,
    JSON.stringify({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), capacity: 5 }),
    json(token),
  )
  return { token, locationId: location.json('id'), slotId: slot.json('id') }
}

export function browse(data) {
  const slots = http.get(`${API}/locations/${data.locationId}/slots`, json(data.token))
  check(slots, { 'slots listed': (r) => r.status === 200 })
  const plans = http.get(`${API}/plans`)
  check(plans, { 'plans listed': (r) => r.status === 200 })
  sleep(0.3)
}

export function rush(data) {
  const login = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: `load${exec.scenario.iterationInTest + 1}@trustpass.dev`, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  check(login, { 'member signed in': (r) => r.status === 200 })
  const response = http.post(`${API}/bookings`, JSON.stringify({ slotId: data.slotId }), json(login.json('accessToken')))
  check(response, { 'booking answered cleanly': (r) => r.status === 201 || r.status === 409 })
  if (response.status === 201) booked.add(1)
  if (response.status === 409) full.add(1)
}
