/** Temporary delivery-only adapter for the 0.1.5-rc.1 Safari JSON validator defect. */
import { createHash } from 'node:crypto'
import { gzip } from 'node:zlib'

export const MAX_COMPAT_BYTES = 16 * 1024 * 1024
const KNOWN_FUNCTION = '32fbc1fc74b60872560e2eac834fa77d3cd3df3ce4a842827df0d2e1fafe7fcd'
const OLD_INTRINSIC = '`function ${name}() { [native code] }`'
const NEW_INTRINSIC = 'Function.prototype.toString.call(globalThis[name])'

/** Restrict adaptation to WebKit clients requesting official client bundles. */
export function isSafariBundleRequest(req) {
  const ua = req.headers['user-agent'] ?? ''
  const webkit = /AppleWebKit\//.test(ua)
    && (/iPhone|iPad|iPod/.test(ua) || !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua))
  try { return req.method === 'GET' && webkit && new URL(req.url, 'http://localhost').pathname === '/plugins/' }
  catch { return false }
}

/** Match the entire known function, tolerating only indentation and bundler suffixes. */
export function adaptSafariBundle(source) {
  if (!source.includes(OLD_INTRINSIC)) return { source, status: 'not-needed', patched: 0 }
  const pattern = /^([\t ]*)function (hasIntrinsicConstructor(?:\$\d+)?)\(prototype, name\) \{[\s\S]*?^\1\}/gm
  const matches = [...source.matchAll(pattern)].filter(match => match[0].includes(OLD_INTRINSIC))
  if (!matches.length || matches.some(match => {
    const normalized = match[0].split('\n').map(line => line.trim()).join('\n').replace(match[2], 'hasIntrinsicConstructor')
    return createHash('sha256').update(normalized).digest('hex') !== KNOWN_FUNCTION
  })) return { source, status: 'unrecognized', patched: 0 }
  // All-or-nothing for the matched validators. Unrelated script bytes are retained.
  let result = source
  for (const match of matches.reverse()) {
    result = result.slice(0, match.index) + match[0].replace(OLD_INTRINSIC, NEW_INTRINSIC) + result.slice(match.index + match[0].length)
  }
  return { source: result, status: 'patched', patched: matches.length }
}

/** Buffer only bounded, successful JS assets; all application streams bypass this path. */
function acceptsGzip(value = '') {
  const encodings = new Map(String(value).split(',').map(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(';')
    const q = parameters.map(p => p.trim()).find(p => p.startsWith('q='))
    const quality = q === undefined ? 1 : Number(q.slice(2))
    return [name, Number.isFinite(quality) && quality > 0 && quality <= 1]
  }))
  return encodings.get('gzip') ?? encodings.get('*') ?? false
}

export function serveSafariBundle(response, res, headers, report = () => {}, acceptEncoding = '') {
  const encoding = response.headers['content-encoding']
  if (response.statusCode !== 200
    || !/^(?:text|application)\/javascript\b/i.test(String(response.headers['content-type'] ?? ''))
    || encoding && encoding !== 'identity') {
    res.writeHead(response.statusCode ?? 502, headers)
    response.pipe(res)
    return
  }
  let chunks = [], size = 0, bypass = false
  response.on('data', chunk => {
    if (bypass) return
    size += chunk.length
    chunks.push(chunk)
    if (size <= MAX_COMPAT_BYTES) return
    bypass = true
    report({ status: 'too-large', patched: 0 })
    res.writeHead(200, headers)
    for (const buffered of chunks) res.write(buffered)
    chunks = []
    response.pipe(res)
  })
  response.on('end', () => {
    if (bypass || res.destroyed) return
    const original = Buffer.concat(chunks)
    const result = adaptSafariBundle(original.toString('utf8'))
    const body = result.patched ? Buffer.from(result.source) : original
    const send = (wire, compressed) => {
      if (res.destroyed) return
      const outgoing = { ...headers, 'x-dsh-mobile-compat': `safari-json-v1; ${result.status}; count=${result.patched}` }
      const vary = String(outgoing.vary ?? '').split(',').map(v => v.trim()).filter(Boolean)
      if (!vary.some(v => v === '*' || v.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding')
      outgoing.vary = vary.join(', ')
      if (result.patched || compressed) {
        for (const name of ['etag', 'content-md5', 'digest', 'content-digest', 'repr-digest', 'transfer-encoding', 'accept-ranges']) delete outgoing[name]
        outgoing['content-length'] = String(wire.length)
      }
      if (compressed) outgoing['content-encoding'] = 'gzip'
      report({ status: result.status, patched: result.patched })
      res.writeHead(200, outgoing)
      res.end(wire)
    }
    // Identity is needed for inspection, not for the slow phone/tunnel hop.
    // Compress untouched bundles too; the main UI bundle can exceed 12 MB.
    if (body.length >= 1024 && acceptsGzip(acceptEncoding)) {
      gzip(body, { level: 6 }, (error, zipped) => {
        const smaller = !error && zipped.length < body.length
        send(smaller ? zipped : body, smaller)
      })
    } else send(body, false)
  })
}
