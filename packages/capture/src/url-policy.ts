/**
 * The capture URL policy: what the managed browser may navigate to.
 *
 * Two stages, both re-run on EVERY redirect hop (a public URL that redirects
 * into the private network is the classic SSRF escape):
 *
 * 1. {@link checkUrlSyntax} — parse-level refusal: the URL must parse, be
 *    http(s), carry no credentials (`user:pass@host` is login state in the
 *    address bar — this plugin never carries one), and name a non-empty host.
 * 2. {@link checkResolvedTarget} — address-level refusal: every IP the host
 *    resolves to (or the literal IP it already is) must be public. The WHATWG
 *    parser normalizes exotic IPv4 spellings (`http://2130706433/`,
 *    `http://0x7f.1/`) into canonical dotted form before this sees them, and
 *    IPv4-in-IPv6 transition forms (mapped, NAT64, 6to4) are unwrapped and
 *    classified by their embedded address.
 *
 * DNS is resolved with the system resolver (`dns.lookup`, injectable for
 * tests). A resolution failure refuses with `capture/navigation-failed`
 * semantics upstream — an unresolvable host cannot be validated, and an
 * unvalidated host is never navigated to.
 *
 * @module @khorsheed/dsh-capture/url-policy
 */

/** The policy verdict for one candidate URL. */
export type CaptureUrlVerdict =
  | { readonly ok: true; readonly url: URL }
  | {
    readonly ok: false
    readonly code: 'capture/invalid-url' | 'capture/private-target'
    /** One-line reason, safe to surface to the caller. */
    readonly message: string
    /** The offending URL (truncated), for the wire failure's details. */
    readonly url?: string
    /** The refused hostname, when the refusal is address-level. */
    readonly hostname?: string
  }

/** The network class of one resolved address; anything but `public` refuses. */
export type CaptureAddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unspecified'
  | 'multicast'
  | 'reserved'

/** Injectable resolver seam (`dns.lookup`'s `all` mode). */
export type CaptureHostLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>

/** Parse-and-scheme gate. Pure; no I/O. */
export function checkUrlSyntax(raw: string): CaptureUrlVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, code: 'capture/invalid-url', url: raw.slice(0, 500), message: `not a parseable URL: ${raw.slice(0, 200)}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'capture/invalid-url', url: raw.slice(0, 500), message: `only http(s) pages can be rendered, not ${url.protocol}` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, code: 'capture/invalid-url', url: raw.slice(0, 500), message: 'URLs with embedded credentials are never rendered' }
  }
  if (url.hostname === '') {
    return { ok: false, code: 'capture/invalid-url', url: raw.slice(0, 500), message: 'the URL names no host' }
  }
  return { ok: true, url }
}

/** Parse a canonical IPv4 string into its 32-bit value, or undefined. */
export function parseIpv4(address: string): number | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    if (part.length > 1 && part.startsWith('0')) return undefined // legacy octal-looking octets: fail closed
    const octet = Number(part)
    if (octet > 255) return undefined
    value = value * 256 + octet
  }
  return value >>> 0
}

/** Expand an IPv6 string into its eight 16-bit groups, or undefined when malformed. */
export function parseIpv6Groups(address: string): number[] | undefined {
  // Strip a zone id (link-local literals like fe80::1%eth0).
  const zoneless = address.split('%')[0]!
  if (!/^[0-9a-fA-F:.]+$/.test(zoneless)) return undefined
  const halves = zoneless.split('::')
  if (halves.length > 2) return undefined
  const parseHalf = (half: string): number[] | undefined => {
    if (half === '') return []
    const groups: number[] = []
    const parts = half.split(':')
    for (const [index, part] of parts.entries()) {
      // An embedded dotted-quad tail (deprecated compatible / mapped forms).
      if (part.includes('.')) {
        if (index !== parts.length - 1) return undefined
        const v4 = parseIpv4(part)
        if (v4 === undefined) return undefined
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff)
        continue
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined
      groups.push(parseInt(part, 16))
    }
    return groups
  }
  const head = parseHalf(halves[0]!)
  if (head === undefined) return undefined
  if (halves.length === 1) return head.length === 8 ? head : undefined
  const tail = parseHalf(halves[1]!)
  if (tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (missing === 0 && halves[1] !== '')) return undefined
  return [...head, ...Array<number>(missing).fill(0), ...tail]
}

/** The embedded IPv4 value of an IPv4-mapped, NAT64, or 6to4 IPv6 address. */
function embeddedIpv4(groups: number[]): number | undefined {
  // ::ffff:a.b.c.d (IPv4-mapped): groups 0-4 zero, group 5 0xffff.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return ((groups[6]! << 16) | groups[7]!) >>> 0
  }
  // 64:ff9b::/96 (NAT64 well-known prefix): the v4 address is the last 32 bits.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return ((groups[6]! << 16) | groups[7]!) >>> 0
  }
  // 2002::/16 (6to4): the v4 address is groups 1-2.
  if (groups[0] === 0x2002) {
    return ((groups[1]! << 16) | groups[2]!) >>> 0
  }
  return undefined
}

/** Classify a canonical dotted-quad IPv4 value. */
export function classifyIpv4(value: number): CaptureAddressClass {
  const a = (value >>> 24) & 0xff
  const b = (value >>> 16) & 0xff
  if (a === 0) return 'unspecified' // 0.0.0.0/8 "this host"
  if (a === 127) return 'loopback'
  if (a === 10) return 'private'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 169 && b === 254) return 'link-local' // incl. 169.254.169.254 cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return 'private' // CGNAT shared space
  if (a === 192 && b === 0) return 'reserved' // 192.0.0.0/24 protocol assignments, 192.0.2.0/24 documentation
  if (a === 198 && (b === 18 || b === 19)) return 'reserved' // benchmarking
  if (a === 198 && b === 51) return 'reserved' // documentation
  if (a === 203 && b === 0) return 'reserved' // documentation
  if (a >= 224 && a <= 239) return 'multicast'
  if (a >= 240) return 'reserved'
  return 'public'
}

/** Classify one resolved address (IPv4 or IPv6, canonical or transition form). */
export function classifyAddress(address: string): CaptureAddressClass {
  const v4 = parseIpv4(address)
  if (v4 !== undefined) return classifyIpv4(v4)
  const groups = parseIpv6Groups(address)
  if (groups === undefined) return 'reserved' // unparseable is never public
  const embedded = embeddedIpv4(groups)
  if (embedded !== undefined) return classifyIpv4(embedded)
  const first = groups[0]!
  if (groups.every((g) => g === 0)) return 'unspecified' // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback' // ::1
  if ((first & 0xfe00) === 0xfc00) return 'private' // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return 'link-local' // fe80::/10
  if ((first & 0xff00) === 0xff00) return 'multicast' // ff00::/8
  if (first === 0x2001 && groups[1] === 0x0db8) return 'reserved' // documentation
  return 'public'
}

/** Whether one hostname string is already an IP literal (bracketed v6 or dotted v4). */
export function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return parseIpv4(bare) !== undefined || parseIpv6Groups(bare) !== undefined
}

/**
 * The address-level gate: resolve the host and require EVERY answer to be a
 * public address. A hostname of `localhost` (or `*.localhost`) refuses before
 * DNS is even consulted.
 *
 * @param url - an already syntax-checked URL.
 * @param lookup - the resolver; defaults to the system resolver.
 * @returns the verdict; resolution failure refuses (an unvalidated host is
 *   never navigated to), with the lookup error's message attached.
 */
export async function checkResolvedTarget(url: URL, lookup?: CaptureHostLookup): Promise<CaptureUrlVerdict> {
  const hostname = url.hostname.replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, code: 'capture/private-target', url: url.href, hostname, message: 'localhost is never rendered' }
  }
  if (isIpLiteral(hostname)) {
    const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    const cls = classifyAddress(bare)
    if (cls !== 'public') {
      return { ok: false, code: 'capture/private-target', url: url.href, hostname, message: `${hostname} is a ${cls} address` }
    }
    return { ok: true, url }
  }
  const resolve = lookup ?? defaultLookup
  let addresses: readonly { address: string; family: number }[]
  try {
    addresses = await resolve(hostname)
  } catch (error) {
    return {
      ok: false,
      code: 'capture/invalid-url',
      url: url.href,
      hostname,
      message: `cannot resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (addresses.length === 0) {
    return { ok: false, code: 'capture/invalid-url', url: url.href, hostname, message: `cannot resolve ${hostname}: no addresses` }
  }
  for (const { address } of addresses) {
    const cls = classifyAddress(address)
    if (cls !== 'public') {
      return { ok: false, code: 'capture/private-target', url: url.href, hostname, message: `${hostname} resolves to a ${cls} address` }
    }
  }
  return { ok: true, url }
}

/** The system resolver, bound lazily so importing this module never touches `node:dns`. */
async function defaultLookup(hostname: string): Promise<readonly { address: string; family: number }[]> {
  const dns = await import('node:dns')
  return dns.promises.lookup(hostname, { all: true, verbatim: true })
}

/**
 * The full pre-navigation gate (syntax + resolution), in the order a caller
 * should run it. Redirect hops call this again with the new URL.
 */
export async function checkNavigationTarget(raw: string, lookup?: CaptureHostLookup): Promise<CaptureUrlVerdict> {
  const syntax = checkUrlSyntax(raw)
  if (!syntax.ok) return syntax
  return checkResolvedTarget(syntax.url, lookup)
}
