import { challengeFor, randomString } from './pkce'

const TRUSTPASS_URL: string = import.meta.env.VITE_TRUSTPASS_URL ?? 'http://localhost:8080'
const CLIENT_ID = 'partner-demo'
const REDIRECT_URI = `${window.location.origin}/callback`
const SCOPES = 'openid profile email verified_age_over_21'

interface UserInfo {
  sub: string
  name?: string
  email?: string
  verified_age_over_21?: boolean
}

const app = document.getElementById('app') as HTMLElement

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function show(...nodes: Node[]) {
  app.replaceChildren(...nodes)
}

async function startLogin() {
  const verifier = randomString(48)
  const state = randomString(16)
  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('oauth_state', state)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`${TRUSTPASS_URL}/oauth2/authorize?${params}`)
}

async function finishLogin(params: URLSearchParams): Promise<UserInfo> {
  const verifier = sessionStorage.getItem('pkce_verifier')
  const expectedState = sessionStorage.getItem('oauth_state')
  sessionStorage.removeItem('pkce_verifier')
  sessionStorage.removeItem('oauth_state')
  if (!verifier || params.get('state') !== expectedState) {
    throw new Error('The sign-in response did not match the request that started it.')
  }
  const tokenResponse = await fetch(`${TRUSTPASS_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code') ?? '',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  })
  if (!tokenResponse.ok) {
    throw new Error('TrustPass refused to issue a token for this sign-in.')
  }
  const tokens = (await tokenResponse.json()) as { access_token: string }
  const infoResponse = await fetch(`${TRUSTPASS_URL}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!infoResponse.ok) {
    throw new Error('Could not read the profile shared by TrustPass.')
  }
  return (await infoResponse.json()) as UserInfo
}

function renderHome() {
  const button = el('button', { type: 'button', className: 'trustpass-button', id: 'signin' }, 'Sign in with TrustPass')
  button.addEventListener('click', () => void startLogin())
  show(
    el('h1', {}, 'Northwind Spirits'),
    el('p', {}, 'Online ordering for adults only. Prove you are over 21 without sharing your birth date.'),
    button,
  )
}

function renderResult(info: UserInfo) {
  const adult = info.verified_age_over_21 === true
  const logout = el('button', { type: 'button', id: 'signout', className: 'secondary' }, 'Sign out')
  logout.addEventListener('click', () => window.location.assign('/'))
  show(
    el('h1', {}, adult ? `Welcome, ${info.name ?? 'friend'}` : 'We could not confirm your age'),
    el(
      'p',
      { id: 'verdict', className: adult ? 'ok' : 'no' },
      adult ? 'TrustPass confirmed you are a verified adult over 21.' : 'TrustPass could not confirm that you are over 21, so this store stays closed.',
    ),
    el('dl', {}, el('dt', {}, 'Name'), el('dd', {}, info.name ?? 'Not shared'), el('dt', {}, 'Email'), el('dd', {}, info.email ?? 'Not shared'),
      el('dt', {}, 'Over 21'), el('dd', { id: 'claim' }, String(adult)),
      el('dt', {}, 'Date of birth'), el('dd', {}, 'Never shared')),
    logout,
  )
}

function renderError(message: string) {
  const retry = el('button', { type: 'button', className: 'secondary' }, 'Back')
  retry.addEventListener('click', () => window.location.assign('/'))
  show(el('h1', {}, 'Sign-in did not finish'), el('p', { role: 'alert', className: 'no' }, message), retry)
}

async function main() {
  if (window.location.pathname !== '/callback') {
    renderHome()
    return
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('error')) {
    renderError(params.get('error') === 'access_denied' ? 'You chose not to share your TrustPass details.' : 'TrustPass reported an error.')
    return
  }
  try {
    show(el('p', {}, 'Finishing sign-in…'))
    renderResult(await finishLogin(params))
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Unexpected error')
  }
}

void main()
