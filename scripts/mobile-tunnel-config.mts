/** A Quick Tunnel rotation changes only the two explicitly bound authorities.
 * No wildcard trust, command interpolation, or unrelated environment changes. */
export function quickTunnelOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a clean Quick Tunnel HTTPS origin')
  return url.origin
}
export function rotateMobileCommand(command: string, next: string): string {
  const origin = quickTunnelOrigin(next)
  const env = /(?:^|\s)DSH_MOBILE_PUBLIC_ORIGIN=(['"]?)(https:\/\/[a-z0-9.-]+)\1(?=\s|$)/g
  const matches = [...command.matchAll(env)]
  if (matches.length !== 1) throw new Error('Launch command must bind exactly one mobile public origin')
  const previous = quickTunnelOrigin(matches[0][2])
  const host = new URL(previous).host.replaceAll('.', '\\.')
  const trusted = new RegExp(`(--trusted-host(?:=|\\s+))(['"]?)${host}\\2(?=\\s|$)`, 'g')
  if ([...command.matchAll(trusted)].length !== 1) throw new Error('Launch command must trust exactly the current mobile domain')
  return command.replace(env, match => match.replace(previous, origin))
    .replace(trusted, (_match, flag, quote) => `${flag}${quote}${new URL(origin).host}${quote}`)
}

/** Candidate probes only dump configuration and may not have a trust flag. */
export function rotateMobileProbe(probe: string, command: string, next: string): string {
  const previous = /DSH_MOBILE_PUBLIC_ORIGIN=['"]?(https:\/\/[a-z0-9.-]+)/.exec(command)?.[1]
  if (!previous) throw new Error('Mobile origin binding missing')
  return probe.replaceAll(quickTunnelOrigin(previous), quickTunnelOrigin(next))
}

/** Retire a static Quick Tunnel binding (the mobile plugin now manages its own
 * tunnel): drop exactly the bound origin variable and its one trust flag. */
export function clearMobileCommand(command: string): string {
  const env = /(?:^|\s)DSH_MOBILE_PUBLIC_ORIGIN=(['"]?)(https:\/\/[a-z0-9.-]+)\1(?=\s|$)/g
  const matches = [...command.matchAll(env)]
  if (matches.length !== 1) throw new Error('Launch command must bind exactly one mobile public origin')
  const host = new URL(quickTunnelOrigin(matches[0][2])).host.replaceAll('.', '\\.')
  const trusted = new RegExp(`\\s+--trusted-host(?:=|\\s+)(['"]?)${host}\\1(?=\\s|$)`, 'g')
  if ([...command.matchAll(trusted)].length !== 1) throw new Error('Launch command must trust exactly the current mobile domain')
  return command.replace(env, '').replace(trusted, '').replace(/^\s+/, '')
}

/** Candidate probes carry the origin variable but may lack the trust flag. */
export function clearMobileProbe(probe: string): string {
  return probe.replace(/(^|\s)DSH_MOBILE_PUBLIC_ORIGIN=(['"]?)https:\/\/[a-z0-9.-]+\2(?=\s|$)/g, (_match, lead) => lead)
    .replace(/\s+--trusted-host(?:=|\s+)(['"]?)[a-z0-9-]+(?:-[a-z0-9]+)*\.trycloudflare\.com\1(?=\s|$)/g, '')
    .replace(/^\s+/, '').replace(/ {2,}/g, ' ')
}
