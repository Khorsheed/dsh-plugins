/** Probe only the operator-configured origin, anonymously and without redirects.
 * Official protected roots answer 401; unprotected roots can answer 2xx.
 * A login token must never be used as a connectivity probe. */
export async function publicOriginReachable(origin: string, request: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await request(`${origin}/`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000),
      headers: { 'cache-control': 'no-cache' } })
    await response.body?.cancel()
    return response.status === 401 || response.ok
  } catch { return false }
}
