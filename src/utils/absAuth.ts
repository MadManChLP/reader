// Audiobookshelf OIDC login (Authorization Code + PKCE, "mobile client" flow).
//
// ABS local accounts are disabled on the server — the only way in is OIDC via
// the identity provider (Authentik). The app behaves like the official ABS
// mobile apps:
//   1. GET {abs}/auth/openid?...&redirect_uri={APP_REDIRECT}  (redirects OFF)
//      → 302 Location = the IdP authorize URL; ABS sets state/nonce cookies.
//   2. Open the Location URL in a login window. After the IdP login, ABS
//      redirects the window to {APP_REDIRECT}?code=..&state=.. — that
//      navigation is intercepted (never loaded) and the window closes.
//   3. GET {abs}/auth/openid/callback?state=..&code=..&code_verifier=..
//      with the cookies from step 1 → ABS exchanges the code server-side
//      and returns the ABS user incl. token(s).
//
// IMPORTANT: every request here uses followRedirects: false — those requests
// share a dedicated cookie jar in the backend, and steps 1+3 must see the
// same cookies. Never make ABS auth calls outside this module.
//
// SERVER PREREQUISITE: APP_REDIRECT must be whitelisted in ABS →
// Settings → Authentication → OpenID → "Mobile app redirect URIs".

import api, { IS_IOS } from './api'
import { useSettingsStore } from '../stores/settingsStore'
import type { AbsUser } from '../types/audiobookshelf'

// Desktop: never actually loaded — navigation to it is intercepted in the
// login window before any request. iOS: a custom URL scheme (registered in
// Info.plist by the CI workflow) — Safari hands it to the app as a deep link.
// BOTH must be whitelisted in ABS → Authentication → OpenID →
// "Mobile app redirect URIs".
export const APP_REDIRECT = IS_IOS
  ? 'mediamaster://abs-oauth-callback'
  : 'http://localhost/abs-oauth-callback'
const CLIENT_ID = 'Audiobookshelf-App'

// OS credential store key for the refresh token (never in localStorage)
export const ABS_REFRESH_TOKEN_KEY = 'abs-refresh-token'

export function normalizeAbsUrl(url: string): string {
  let normalized = url.trim()
  if (!normalized) return ''
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized
  return normalized.replace(/\/+$/, '')
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

// ─── Login flow ──────────────────────────────────────────────────────────────

export interface AbsLoginResult {
  cancelled?: boolean
  user?: AbsUser
  userDefaultLibraryId?: string
}

function getHeaderCaseInsensitive(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return null
}

/**
 * Run the full OIDC login against the given ABS server. On success the
 * resulting session (access token, user info) is persisted to settings and
 * the refresh token (if any) to the OS credential store.
 *
 * Throws with a readable message on failure; resolves { cancelled: true }
 * if the user closes the login window.
 */
export async function startOidcLogin(serverUrl: string): Promise<AbsLoginResult> {
  const base = normalizeAbsUrl(serverUrl)
  if (!base) throw new Error('No server URL configured')

  const verifier = randomUrlSafeString(32)
  const challenge = await pkceChallengeS256(verifier)
  const state = randomUrlSafeString(16)

  // Step 1: ask ABS for the IdP authorize URL (302) — cookies land in the
  // shared no-redirect cookie jar
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    redirect_uri: APP_REDIRECT,
    client_id: CLIENT_ID,
    state,
  })
  const authRes = await api.request({
    method: 'GET',
    url: `${base}/auth/openid?${params.toString()}`,
    followRedirects: false,
  })

  if (authRes.status < 300 || authRes.status >= 400) {
    const detail = typeof authRes.data === 'string' ? authRes.data
      : authRes.data ? JSON.stringify(authRes.data) : authRes.error || `HTTP ${authRes.status}`
    throw new Error(
      `Server did not start the SSO flow (${detail}). ` +
      `Check that OIDC is enabled and "${APP_REDIRECT}" is whitelisted under ` +
      `"Mobile app redirect URIs" in the Audiobookshelf authentication settings.`
    )
  }

  let authorizeUrl = getHeaderCaseInsensitive(authRes.headers, 'location')
  if (!authorizeUrl) throw new Error('Server redirect is missing the Location header')
  // Resolve a relative Location against the ABS base URL
  authorizeUrl = new URL(authorizeUrl, base + '/').toString()

  // Step 2: interactive login in a separate window
  const callbackUrl = await api.openOidcWindow(authorizeUrl, APP_REDIRECT)
  if (!callbackUrl) return { cancelled: true }

  const cbParams = new URL(callbackUrl).searchParams
  const code = cbParams.get('code')
  const returnedState = cbParams.get('state')
  if (!code) {
    const err = cbParams.get('error_description') || cbParams.get('error') || 'no authorization code returned'
    throw new Error(`Login failed: ${err}`)
  }
  if (returnedState !== state) throw new Error('Login failed: state mismatch (possible replay), please try again')

  // Step 3: hand the code + PKCE verifier to ABS (with the step-1 cookies);
  // ABS exchanges it with the IdP server-side and returns the ABS user
  const exchangeParams = new URLSearchParams({ state, code, code_verifier: verifier })
  const cbRes = await api.request({
    method: 'GET',
    url: `${base}/auth/openid/callback?${exchangeParams.toString()}`,
    followRedirects: false,
  })

  if (!cbRes.success || !cbRes.data?.user) {
    const detail = typeof cbRes.data === 'string' ? cbRes.data
      : cbRes.data ? JSON.stringify(cbRes.data) : cbRes.error || `HTTP ${cbRes.status}`
    throw new Error(`Could not complete the login: ${detail}`)
  }

  const user: AbsUser = cbRes.data.user
  const userDefaultLibraryId: string | undefined = cbRes.data.userDefaultLibraryId

  await persistAbsSession(base, user, userDefaultLibraryId)
  return { user, userDefaultLibraryId }
}

/**
 * Store the session: access token + user info in settings, refresh token
 * (if the server issued one — ABS >= 2.26) in the OS credential store.
 */
export async function persistAbsSession(
  serverUrl: string,
  user: AbsUser,
  defaultLibraryId?: string,
): Promise<void> {
  const accessToken = user.accessToken || user.token
  if (!accessToken) throw new Error('Server response did not contain a token')

  if (user.refreshToken) {
    await api.secretSet(ABS_REFRESH_TOKEN_KEY, user.refreshToken)
  }

  useSettingsStore.getState().updateAudiobookshelf({
    url: serverUrl,
    username: user.username,
    userId: user.id,
    accessToken,
    tokenType: user.refreshToken ? 'refreshable' : 'legacy',
    ...(defaultLibraryId ? { defaultLibraryId } : {}),
  })
}

// ─── Token refresh ───────────────────────────────────────────────────────────

/**
 * Exchange the stored refresh token for a new access token
 * (POST /auth/refresh, ABS >= 2.26). Persists the rotated tokens.
 * Returns the new access token, or null if refresh is not possible.
 */
export async function refreshAbsToken(): Promise<string | null> {
  const config = useSettingsStore.getState().audiobookshelf
  if (!config.url || config.tokenType !== 'refreshable') return null

  const refreshToken = await api.secretGet(ABS_REFRESH_TOKEN_KEY)
  if (!refreshToken) return null

  const res = await api.request({
    method: 'POST',
    url: `${normalizeAbsUrl(config.url)}/auth/refresh`,
    headers: { 'x-refresh-token': refreshToken },
    followRedirects: false,
  })

  const user: AbsUser | undefined = res.success ? res.data?.user : undefined
  const newAccessToken = user?.accessToken || user?.token
  if (!newAccessToken) {
    console.warn('[AbsAuth] Token refresh failed:', res.status, res.error)
    return null
  }

  if (user?.refreshToken && user.refreshToken !== refreshToken) {
    await api.secretSet(ABS_REFRESH_TOKEN_KEY, user.refreshToken)
  }
  useSettingsStore.getState().updateAudiobookshelf({ accessToken: newAccessToken })

  return newAccessToken
}

/** Clear the stored session (settings token + keyring refresh token). */
export async function clearAbsSession(): Promise<void> {
  await api.secretDelete(ABS_REFRESH_TOKEN_KEY)
  useSettingsStore.getState().updateAudiobookshelf({
    accessToken: undefined,
    tokenType: undefined,
  })
}
