/** Private environment carrying the parent's account grant to this sub-dsh only. */
export const ACCOUNT_TOKEN_ENV = 'DSH_LOCAL_AGENT_DEEPSEEK_ACCOUNT_TOKEN'
/** Non-secret inference origin the parent account service allowed to receive that grant. */
export const ACCOUNT_ORIGIN_ENV = 'DSH_LOCAL_AGENT_DEEPSEEK_ACCOUNT_ORIGIN'

/**
 * Resolve the launch grant only for the origin already admitted by the parent.
 * @param url - actual inference destination.
 * @param env - private sub-dsh launch environment.
 * @returns the grant for that origin, or undefined for any other destination.
 */
export function resolveLaunchAccountToken(url: string, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const destination = new URL(url)
  if (destination.origin !== env[ACCOUNT_ORIGIN_ENV] || destination.username || destination.password) return undefined
  const token = env[ACCOUNT_TOKEN_ENV]
  return token === undefined || token === '' ? undefined : token
}
