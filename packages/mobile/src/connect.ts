import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { MobileConnectInfo } from './protocol.ts'
import { publicOriginReachable } from './reachability.ts'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }

/** Deployment-owned destination only: a browser cannot choose where a bearer is sent. */
export function connectInfo(connection: HostConnectionHandle, configured?: string): MobileConnectInfo {
  if (!configured) return { state: 'not-configured', origin: null }
  let url: URL
  try {
    url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('invalid')
  } catch { return { state: 'invalid-origin', origin: null } }
  if (typeof connection.authenticatedUrl !== 'function' || typeof connection.requestRejection !== 'function') {
    return { state: 'unsupported', origin: url.origin }
  }
  // Probe the public Host/Origin fence without credentials. 401 is expected;
  // accepting the destination does not authenticate this synthetic request.
  if (connection.requestRejection({ headers: { host: url.host, origin: url.origin } }) === 403) {
    return { state: 'untrusted-origin', origin: url.origin }
  }
  return { state: 'ready', origin: url.origin }
}

/** Called only behind the official authenticated Fetch registry. */
export function connectResponse(connection: HostConnectionHandle, configured?: string, reachable: (origin: string) => Promise<boolean> = publicOriginReachable) {
  return async (request: Request): Promise<Response> => {
    const info = connectInfo(connection, configured)
    const checked = async (): Promise<MobileConnectInfo> => info.state === 'ready' && info.origin && !await reachable(info.origin)
      ? { ...info, state: 'unreachable' } : info
    if (request.method === 'GET') return Response.json(await checked(), { headers })
    // Explicit same-origin action; a navigation/form must never reveal a login URL.
    // The official HTTP bridge uses an internal Request URL. Compare the
    // preserved Host/Origin headers, as the official trust fence does, so an
    // HTTPS reverse proxy does not turn a valid action into a false 403.
    let sameOrigin = false
    try {
      const origin = new URL(request.headers.get('origin') ?? '')
      const host = request.headers.get('host')
      sameOrigin = !!host && ['http:', 'https:'].includes(origin.protocol)
        && origin.host === new URL(`http://${host}`).host
    } catch { /* opaque or absent origin */ }
    if (!sameOrigin || request.headers.get('content-type') !== 'application/json') {
      return Response.json({ error: 'forbidden' }, { status: 403, headers })
    }
    if (info.state !== 'ready' || !info.origin) return Response.json(info, { status: 409, headers })
    const live = await checked()
    if (live.state !== 'ready') return Response.json(live, { status: 503, headers })
    try {
      const login = new URL(connection.authenticatedUrl(info.origin))
      if (login.origin !== info.origin || login.pathname !== '/' || login.username || login.password || login.hash
        || !login.searchParams.get('token') || [...login.searchParams].length !== 1) throw new Error('unsupported')
      return Response.json({ origin: info.origin, loginUrl: login.href }, { headers })
    } catch {
      // Never echo a provider error that might contain the launch credential.
      return Response.json({ error: 'unavailable' }, { status: 503, headers })
    }
  }
}
