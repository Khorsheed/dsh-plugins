/**
 * The image rescue fetch: one picture, host-side, for a browser that cannot
 * have it.
 *
 * Why this exists: the extractor emits absolute image URLs with
 * `referrerpolicy="no-referrer"`, which covers referer-gated CDNs — but a
 * response headed `Cross-Origin-Resource-Policy: same-origin` (measured on
 * claude.dev's `/media/*`, 2026-09-29: every figure of the eval-hillclimbing
 * post answers 200 to curl and is still withheld from any cross-origin page)
 * is blocked by the BROWSER no matter what the tag asks for, so the reader
 * pane shows the broken-image icon over the full alt text. A no-cors browser
 * fetch cannot read those bytes either; the host process can, because CORP is
 * an embedder-side check. The pane therefore re-points only the images that
 * already failed at this one verb.
 *
 * Why not `ctx.web.fetch`: the seam's decoded body is a closed html|text union
 * and its provider refuses binary content types outright. The hardening the
 * seam exists for is re-implemented here at image scope: a syntax gate (http
 * or https, no credentials), public-address resolution with EVERY answer
 * required public (the address classifier mirrors `@khorsheed/dsh-capture`'s
 * url-policy.ts — keep the two in step; a shared home is the follow-up), a
 * transport pinned to exactly the validated answers so DNS cannot re-resolve
 * to a private address mid-flight, the same validation re-run on every
 * redirect hop, a byte cap, a timeout, and an `image/*` content-type gate
 * applied before the body is read.
 *
 * @module @khorsheed/dsh-reader/image-fetch
 */
import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'

/** The outcome of one image fetch: the bytes and their type, or the reason not. */
export type ImageFetchOutcome =
  | { readonly ok: true; readonly url: string; readonly mime: string; readonly base64: string }
  | { readonly ok: false; readonly url: string; readonly error: string }

/** One resolved host address (the `dns.lookup` all-mode shape). */
export interface ImageResolvedAddress {
  readonly address: string
  readonly family: number
}

/** Injectable resolver seam — the POLICY half's DNS (defaults to the system resolver). */
export type ImageHostResolver = (hostname: string) => Promise<readonly ImageResolvedAddress[]>

/** The transport half's address supply — node's own `lookup` callback contract. */
export type ImageTransportLookup = LookupFunction

/**
 * The two seams a test injects: `resolve` answers what the POLICY validates
 * (a public address), `lookup` answers what the CONNECTION dials (the fixture
 * server's loopback). In production both default to the system resolver and
 * the lookup is the validated answer set — that identity IS the pin.
 */
export interface ImageFetchSeams {
  readonly resolve?: ImageHostResolver
  readonly lookup?: ImageTransportLookup
}

/** Numeric limits, overridable in tests. */
export interface ImageFetchLimits {
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
}

/** An article figure is a few hundred KB; 8 MiB leaves room for print-resolution PNGs. */
export const IMAGE_FETCH_MAX_BYTES = 8 * 1024 * 1024

/** One image fetch never hangs the rescue: the pane's picture stays broken instead. */
export const IMAGE_FETCH_TIMEOUT_MS = 15_000

/** Redirect hops per image, each re-validated end to end (the classic SSRF hop). */
export const IMAGE_FETCH_MAX_REDIRECTS = 3

/** An honest agent line — bot walls are reported, never impersonated around. */
const IMAGE_FETCH_USER_AGENT = 'dsh-reader image rescue (+https://github.com/Khorsheed/dsh-plugins)'

/**
 * The raster/vector types a rescued image may declare. The pane re-points the
 * failed `<img>` at these bytes, so an SVG rides an image context (which never
 * scripts); anything else the origin answers — HTML above all — is refused
 * before the body is read.
 */
const IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)$/i

/**
 * The byte budget of the in-memory rescue cache (wire size — base64 is what
 * the map actually holds). A figure-heavy article is a few MB; the budget
 * covers several of them, and the oldest entry leaves first.
 */
export const IMAGE_CACHE_BUDGET_BYTES = 32 * 1024 * 1024

/**
 * The rescue cache: a pane remount (the sidebar unmounts wholesale when
 * another panel takes over) re-fails every CORP-blocked image, and this map is
 * what keeps that a memory read instead of a dozen outbound requests. LRU by
 * insertion refresh, bounded by bytes.
 */
export class ImageFetchCache {
  private readonly entries = new Map<string, { mime: string; base64: string }>()
  private bytes = 0

  constructor(private readonly budgetBytes: number = IMAGE_CACHE_BUDGET_BYTES) {}

  /** The cached bytes for one URL, refreshing its recency. */
  get(url: string): { mime: string; base64: string } | undefined {
    const hit = this.entries.get(url)
    if (hit === undefined) return undefined
    this.entries.delete(url)
    this.entries.set(url, hit)
    return hit
  }

  /** Cache one fetched image, evicting the oldest entries until it fits. */
  set(url: string, mime: string, base64: string): void {
    if (base64.length > this.budgetBytes) return
    const existing = this.entries.get(url)
    if (existing !== undefined) {
      this.bytes -= existing.base64.length
      this.entries.delete(url)
    }
    while (this.bytes + base64.length > this.budgetBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const dropped = this.entries.get(oldest.value)
      this.entries.delete(oldest.value)
      this.bytes -= dropped?.base64.length ?? 0
    }
    this.entries.set(url, { mime, base64 })
    this.bytes += base64.length
  }
}

/**
 * Fetch one image, policy-checked end to end.
 *
 * Errors are values: the pane's only answer to a failed rescue is leaving the
 * broken image as it was, so the reason string is for logs, not for display.
 *
 * @param rawUrl - the image URL the pane failed on.
 * @param seams - resolver/lookup overrides (tests only; production pins).
 * @param limits - byte/timeout/redirect overrides (tests only).
 * @returns the image bytes base64-encoded with their declared type, or why not.
 */
export async function fetchImageBytes(
  rawUrl: string,
  seams: ImageFetchSeams = {},
  limits: ImageFetchLimits = {},
): Promise<ImageFetchOutcome> {
  const maxBytes = limits.maxBytes ?? IMAGE_FETCH_MAX_BYTES
  const timeoutMs = limits.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS
  const maxRedirects = limits.maxRedirects ?? IMAGE_FETCH_MAX_REDIRECTS

  let current: string = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const gate = await checkImageTarget(current, seams.resolve)
    if (!gate.ok) return { ok: false, url: rawUrl, error: gate.error }
    const response = await requestOnce(gate.url, gate.addresses, timeoutMs, seams.lookup)
    if (!response.ok) return { ok: false, url: rawUrl, error: response.error }
    const { message } = response
    const status = message.statusCode ?? 0
    if (status >= 300 && status < 400) {
      message.resume()
      const location = message.headers['location']
      if (typeof location !== 'string' || location.length === 0) {
        return { ok: false, url: rawUrl, error: `HTTP ${status} without a location` }
      }
      try {
        current = new URL(location, current).toString()
      } catch {
        return { ok: false, url: rawUrl, error: `HTTP ${status} to an unparseable location` }
      }
      continue
    }
    if (status < 200 || status >= 300) {
      message.resume()
      return { ok: false, url: rawUrl, error: `HTTP ${status}` }
    }
    const mime = (message.headers['content-type'] ?? '').replace(/;.*$/s, '').trim().toLowerCase()
    if (!IMAGE_MIME.test(mime)) {
      message.resume()
      return { ok: false, url: rawUrl, error: `the response is not an image (content-type "${mime || 'unknown'}")` }
    }
    const declared = Number(message.headers['content-length'] ?? Number.NaN)
    if (Number.isFinite(declared) && declared > maxBytes) {
      message.resume()
      return { ok: false, url: rawUrl, error: `the image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB cap` }
    }
    const body = await readBody(message, maxBytes)
    if (!body.ok) return { ok: false, url: rawUrl, error: body.error }
    return { ok: true, url: rawUrl, mime, base64: body.base64 }
  }
  return { ok: false, url: rawUrl, error: `more than ${maxRedirects} redirects` }
}

/* --------------------------------------------------------------- the gate */

/** One hop, validated: the parsed URL plus the only addresses it may dial. */
type ImageTarget =
  | { readonly ok: true; readonly url: URL; readonly addresses: readonly ImageResolvedAddress[] }
  | { readonly ok: false; readonly error: string }

/**
 * The syntax gate plus the address gate, in the order capture's navigation
 * policy runs them. The address set travels with the verdict: the transport
 * dials exactly these, so the hostname is never resolved twice.
 */
async function checkImageTarget(raw: string, resolve?: ImageHostResolver): Promise<ImageTarget> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'invalid-url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `only http(s) images can be rescued, not ${url.protocol}` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'URLs with embedded credentials are never fetched' }
  }
  const hostname = url.hostname.replace(/\.$/, '')
  if (hostname === '') return { ok: false, error: 'invalid-url' }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, error: 'localhost is never fetched' }
  }
  if (isIpLiteral(hostname)) {
    const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    const cls = classifyAddress(bare)
    if (cls !== 'public') return { ok: false, error: `${bare} is a ${cls} address` }
    return { ok: true, url, addresses: [{ address: bare, family: bare.includes(':') ? 6 : 4 }] }
  }
  const resolver = resolve ?? defaultResolve
  let addresses: readonly ImageResolvedAddress[]
  try {
    addresses = await resolver(hostname.replace(/^\[(.*)\]$/, '$1'))
  } catch (error) {
    return { ok: false, error: `cannot resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (addresses.length === 0) return { ok: false, error: `cannot resolve ${hostname}: no addresses` }
  for (const { address } of addresses) {
    const cls = classifyAddress(address)
    if (cls !== 'public') return { ok: false, error: `${hostname} resolves to a ${cls} address` }
  }
  return { ok: true, url, addresses }
}

/* ----------------------------------------------------------- the transport */

/** One raw response, or the reason the request itself failed. */
type ImageResponse =
  | { readonly ok: true; readonly message: IncomingMessage }
  | { readonly ok: false; readonly error: string }

/**
 * Issue one GET against the validated address set.
 *
 * The `lookup` handed to the transport answers with the validated addresses
 * and nothing else — DNS is consulted once, by the gate, and the connection
 * cannot re-resolve the hostname into a private network (the rebinding window
 * a plain fetch leaves open). Node still verifies TLS against the HOSTNAME;
 * the lookup only maps it to an address.
 */
function requestOnce(
  url: URL,
  addresses: readonly ImageResolvedAddress[],
  timeoutMs: number,
  lookup?: ImageTransportLookup,
): Promise<ImageResponse> {
  return new Promise((resolvePromise) => {
    void (async () => {
      const transport = url.protocol === 'https:'
        ? await import('node:https')
        : await import('node:http')
      const request = transport.request(
        {
          protocol: url.protocol,
          // Bracketed IPv6 literals are a URL spelling, not a host option.
          hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
            'accept-encoding': 'identity',
            'user-agent': IMAGE_FETCH_USER_AGENT,
          },
          lookup: lookup ?? pinnedLookup(addresses),
        },
        (message) => resolvePromise({ ok: true, message }),
      )
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`the image fetch timed out after ${timeoutMs} ms`))
      })
      request.on('error', (error: Error) => resolvePromise({ ok: false, error: error.message }))
      request.end()
    })().catch((error: unknown) => resolvePromise({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  })
}

/** The lookup that pins a request to the gate's validated answers. */
function pinnedLookup(addresses: readonly ImageResolvedAddress[]): ImageTransportLookup {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })))
      return
    }
    const first = addresses[0] as ImageResolvedAddress
    callback(null, first.address, first.family)
  }
}

/** The body, capped; over the cap is a refusal, not a truncation. */
function readBody(message: IncomingMessage, maxBytes: number): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    let received = 0
    message.on('data', (chunk: Buffer) => {
      received += chunk.byteLength
      if (received > maxBytes) {
        message.destroy()
        resolvePromise({ ok: false, error: `the image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB cap` })
        return
      }
      chunks.push(chunk)
    })
    message.on('end', () => resolvePromise({ ok: true, base64: Buffer.concat(chunks).toString('base64') }))
    message.on('error', (error: Error) => resolvePromise({ ok: false, error: error.message }))
  })
}

/** The system resolver, bound lazily so importing this module never touches `node:dns`. */
async function defaultResolve(hostname: string): Promise<readonly ImageResolvedAddress[]> {
  const dns = await import('node:dns')
  return dns.promises.lookup(hostname, { all: true, verbatim: true })
}

/* ----------------------------------------------------------- the classifier
 *
 * Mirrored from `@khorsheed/dsh-capture/src/url-policy.ts` (same author, same
 * repo): the reader must not import a sibling plugin, and an image fetch has
 * the same SSRF shape as a navigation. Keep the two in step.
 */

/** The network class of one resolved address; anything but `public` refuses. */
type ImageAddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unspecified'
  | 'multicast'
  | 'reserved'

/** Parse a canonical IPv4 string into its 32-bit value, or undefined. */
function parseIpv4(address: string): number | undefined {
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
function parseIpv6Groups(address: string): number[] | undefined {
  // Strip a zone id (link-local literals like fe80::1%eth0).
  const zoneless = address.split('%')[0] as string
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
  const head = parseHalf(halves[0] as string)
  if (head === undefined) return undefined
  if (halves.length === 1) return head.length === 8 ? head : undefined
  const tail = parseHalf(halves[1] as string)
  if (tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (missing === 0 && halves[1] !== '')) return undefined
  return [...head, ...Array<number>(missing).fill(0), ...tail]
}

/** The embedded IPv4 value of an IPv4-mapped, NAT64, or 6to4 IPv6 address. */
function embeddedIpv4(groups: number[]): number | undefined {
  // ::ffff:a.b.c.d (IPv4-mapped): groups 0-4 zero, group 5 0xffff.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return (((groups[6] as number) << 16) | (groups[7] as number)) >>> 0
  }
  // 64:ff9b::/96 (NAT64 well-known prefix): the v4 address is the last 32 bits.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return (((groups[6] as number) << 16) | (groups[7] as number)) >>> 0
  }
  // 2002::/16 (6to4): the v4 address is groups 1-2.
  if (groups[0] === 0x2002) {
    return (((groups[1] as number) << 16) | (groups[2] as number)) >>> 0
  }
  return undefined
}

/** Classify a canonical dotted-quad IPv4 value. */
function classifyIpv4(value: number): ImageAddressClass {
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
function classifyAddress(address: string): ImageAddressClass {
  const v4 = parseIpv4(address)
  if (v4 !== undefined) return classifyIpv4(v4)
  const groups = parseIpv6Groups(address)
  if (groups === undefined) return 'reserved' // unparseable is never public
  const embedded = embeddedIpv4(groups)
  if (embedded !== undefined) return classifyIpv4(embedded)
  const first = groups[0] as number
  if (groups.every((g) => g === 0)) return 'unspecified' // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback' // ::1
  if ((first & 0xfe00) === 0xfc00) return 'private' // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return 'link-local' // fe80::/10
  if ((first & 0xff00) === 0xff00) return 'multicast' // ff00::/8
  if (first === 0x2001 && groups[1] === 0x0db8) return 'reserved' // documentation
  return 'public'
}

/** Whether one hostname string is already an IP literal (bracketed v6 or dotted v4). */
function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return parseIpv4(bare) !== undefined || parseIpv6Groups(bare) !== undefined
}
