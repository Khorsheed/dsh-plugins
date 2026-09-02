/**
 * Browser handoff bridge for launch cutovers.
 *
 * The old, authenticated page registers a random per-tab capability while the
 * previous process is still the proven listener. Only its SHA-256 digest is
 * durable. After the successor proves one stable listener, that same tab may
 * ask the final process for either a plain reload (its cookie is still valid)
 * or that process's authenticated URL. The URL exists only in the response
 * object and the browser's location.replace call: it never enters a state
 * file, receipt, or log.
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { activeCutover, readCutoverReceipt, type CutoverProcessOwnership, type LaunchRole } from './launch-spec.ts'
import { processIdentityMatches } from './processes.ts'
import { stateFile } from './state-files.ts'

export const BROWSER_HANDOFF_ROUTE = '/_ankh-guard/browser-handoff'

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MAX_BODY_BYTES = 4096

export type BrowserHandoffChannel = 'original-tab' | 'fallback-tab'
export type BrowserHandoffAuthentication = 'existing-cookie' | 'launch-url'

export interface BrowserHandoffRequest {
  version: 1
  cutoverId: string
  authority: string
  capabilitySha256: string
  armedAt: number
}

export interface BrowserHandoffAcknowledgement {
  version: 1
  cutoverId: string
  role: LaunchRole
  authority: string
  listenerPid: number
  listenerStartToken: string
  channel: BrowserHandoffChannel
  authentication: BrowserHandoffAuthentication
  acknowledgedAt: number
}

interface PollMessage {
  version: 1
  operation: 'poll'
  capability: string
}

interface AcknowledgeMessage {
  version: 1
  operation: 'ack'
  cutoverId: string
  channel: BrowserHandoffChannel
  authentication: BrowserHandoffAuthentication
  capability?: string
}

type BrowserMessage = PollMessage | AcknowledgeMessage

interface WebServerSlice {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface ConnectionSlice {
  requestRejection?(request: IncomingMessage): 401 | 403 | undefined
  authenticatedUrl?(baseUrl: string): string
}

interface BrowserHandoffDependencies {
  stateDir: string
  pid?: number
  now?: () => number
  identityMatches?: typeof processIdentityMatches
  connection?: ConnectionSlice
  /** Resolve lazily because WebServer can activate before the optional connection service. */
  connectionProvider?: () => ConnectionSlice | undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCapability(value: unknown): value is string {
  return typeof value === 'string' && CAPABILITY_PATTERN.test(value)
}

function capabilitySha256(capability: string): string {
  return createHash('sha256').update(capability).digest('hex')
}

function parseMessage(value: unknown): BrowserMessage | null {
  if (!isObject(value) || value.version !== 1) return null
  if (value.operation === 'poll' && isCapability(value.capability)) {
    return { version: 1, operation: 'poll', capability: value.capability }
  }
  if (value.operation !== 'ack' || typeof value.cutoverId !== 'string' || value.cutoverId === '') return null
  if (value.channel !== 'original-tab' && value.channel !== 'fallback-tab') return null
  if (value.authentication !== 'existing-cookie' && value.authentication !== 'launch-url') return null
  if (value.channel === 'original-tab' && !isCapability(value.capability)) return null
  return {
    version: 1,
    operation: 'ack',
    cutoverId: value.cutoverId,
    channel: value.channel,
    authentication: value.authentication,
    ...(typeof value.capability === 'string' ? { capability: value.capability } : {}),
  }
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return null }
}

function createJsonOnce(file: string, value: unknown): boolean {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  try {
    // Publishing a complete hard link is both atomic for readers and
    // first-writer-wins across competing tabs/processes.
    linkSync(tmp, file)
    try { chmodSync(file, 0o600) } catch { /* best effort on non-POSIX filesystems */ }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    unlinkSync(tmp)
  }
}

export function readBrowserHandoffRequest(stateDir: string): BrowserHandoffRequest | null {
  const request = readJson<Partial<BrowserHandoffRequest>>(stateFile(stateDir, 'browserHandoffRequest'))
  if (request?.version !== 1 || typeof request.cutoverId !== 'string'
    || typeof request.authority !== 'string' || request.authority === ''
    || typeof request.capabilitySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.capabilitySha256)
    || typeof request.armedAt !== 'number') return null
  return request as BrowserHandoffRequest
}

export function readBrowserHandoffAcknowledgement(stateDir: string): BrowserHandoffAcknowledgement | null {
  const ack = readJson<Partial<BrowserHandoffAcknowledgement>>(stateFile(stateDir, 'browserHandoffAck'))
  if (ack?.version !== 1 || typeof ack.cutoverId !== 'string'
    || (ack.role !== 'target' && ack.role !== 'previous')
    || typeof ack.authority !== 'string' || ack.authority === ''
    || !Number.isInteger(ack.listenerPid) || (ack.listenerPid ?? 0) <= 0
    || typeof ack.listenerStartToken !== 'string' || ack.listenerStartToken === ''
    || (ack.channel !== 'original-tab' && ack.channel !== 'fallback-tab')
    || (ack.authentication !== 'existing-cookie' && ack.authentication !== 'launch-url')
    || typeof ack.acknowledgedAt !== 'number') return null
  return ack as BrowserHandoffAcknowledgement
}

function authorityOf(req: IncomingMessage): { authority: string; origin: string } | null {
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string' || typeof origin !== 'string') return null
  try {
    const parsed = new URL(origin)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.host !== host || parsed.origin !== origin) return null
    return { authority: parsed.host, origin: parsed.origin }
  } catch {
    return null
  }
}

function ownershipMatches(
  ownership: CutoverProcessOwnership | undefined,
  pid: number,
  identityMatches: typeof processIdentityMatches,
): ownership is CutoverProcessOwnership {
  return ownership !== undefined && ownership.listenerPid === pid
    && identityMatches({ pid, startToken: ownership.listenerStartToken })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(`${JSON.stringify(body)}\n`)
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function currentReadyOwnership(
  stateDir: string,
  pid: number,
  identityMatches: typeof processIdentityMatches,
): { cutoverId: string; role: LaunchRole; ownership: CutoverProcessOwnership; protected: boolean } | null {
  const active = activeCutover(stateDir)
  if (active === null || active.receipt.readiness?.retryCount !== 0) return null
  const role = active.receipt.readiness.role
  const ownership = role === 'target' ? active.receipt.ownership.target : active.receipt.ownership.restored
  if (!ownershipMatches(ownership, pid, identityMatches)
    || active.receipt.readiness.listenerPid !== ownership.listenerPid
    || active.receipt.readiness.childPid !== ownership.childPid) return null
  return {
    cutoverId: active.receipt.id,
    role,
    ownership,
    protected: active.receipt.authentication.launchUrlObserved === true,
  }
}

function acknowledgementMatchesReady(
  acknowledgement: BrowserHandoffAcknowledgement | null,
  ready: NonNullable<ReturnType<typeof currentReadyOwnership>>,
): boolean {
  return acknowledgement?.cutoverId === ready.cutoverId
    && acknowledgement.role === ready.role
    && acknowledgement.listenerPid === ready.ownership.listenerPid
    && acknowledgement.listenerStartToken === ready.ownership.listenerStartToken
}

function authenticationState(
  connection: ConnectionSlice | undefined, req: IncomingMessage,
): 'authenticated' | 'unauthenticated' | 'forbidden' | 'legacy-public' {
  if (connection?.requestRejection === undefined) return 'legacy-public'
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return 'authenticated'
  return rejection === 403 ? 'forbidden' : 'unauthenticated'
}

/** Create the exact HTTP handler; dependencies are injectable for deterministic protocol tests. */
export function createBrowserHandoffHandler(dependencies: BrowserHandoffDependencies) {
  const pid = dependencies.pid ?? process.pid
  const now = dependencies.now ?? Date.now
  const identityMatches = dependencies.identityMatches ?? processIdentityMatches
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const connection = dependencies.connectionProvider?.() ?? dependencies.connection
    if (req.method !== 'POST' || req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      json(res, 404, { state: 'unavailable' })
      return
    }
    const requestAuthority = authorityOf(req)
    if (requestAuthority === null) {
      json(res, 403, { state: 'forbidden' })
      return
    }
    let message: BrowserMessage | null
    try { message = parseMessage(await bodyOf(req)) } catch { message = null }
    if (message === null) {
      json(res, 400, { state: 'invalid' })
      return
    }

    const active = activeCutover(dependencies.stateDir)
    if (message.operation === 'poll') {
      if (active === null || active.receipt.phase === 'awaiting-user'
        || active.receipt.browserHandoff.status === 'acknowledged'
        || active.receipt.browserHandoff.status === 'off') {
        json(res, 200, { state: 'idle' })
        return
      }
      const digest = capabilitySha256(message.capability)
      const previous = active.receipt.ownership.previous
      if (ownershipMatches(previous, pid, identityMatches)) {
        const oldAuthentication = authenticationState(connection, req)
        if (oldAuthentication === 'unauthenticated' || oldAuthentication === 'forbidden') {
          json(res, 401, { state: 'unauthorized' })
          return
        }
        const handoff: BrowserHandoffRequest = {
          version: 1,
          cutoverId: active.receipt.id,
          authority: requestAuthority.authority,
          capabilitySha256: digest,
          armedAt: now(),
        }
        const file = stateFile(dependencies.stateDir, 'browserHandoffRequest')
        const created = createJsonOnce(file, handoff)
        const selected = created ? handoff : readBrowserHandoffRequest(dependencies.stateDir)
        json(res, 200, selected?.cutoverId === handoff.cutoverId
          && selected.authority === handoff.authority && selected.capabilitySha256 === digest
          ? { state: 'waiting', cutoverId: active.receipt.id }
          : { state: 'standby', cutoverId: active.receipt.id })
        return
      }

      const ready = currentReadyOwnership(dependencies.stateDir, pid, identityMatches)
      const registration = readBrowserHandoffRequest(dependencies.stateDir)
      if (ready !== null && acknowledgementMatchesReady(
        readBrowserHandoffAcknowledgement(dependencies.stateDir), ready,
      )) {
        json(res, 200, { state: 'idle' })
        return
      }
      if (ready === null || ready.cutoverId !== active.receipt.id
        || registration?.cutoverId !== active.receipt.id
        || registration.authority !== requestAuthority.authority
        || registration.capabilitySha256 !== digest) {
        json(res, 200, { state: 'waiting', cutoverId: active.receipt.id })
        return
      }
      // A protected listener may expose the route before its optional
      // connection service settles. Do not misclassify that startup window as
      // a public/valid-cookie host and strand the original tab on a bare 401.
      if (ready.protected && connection?.requestRejection === undefined) {
        json(res, 200, { state: 'waiting', cutoverId: active.receipt.id })
        return
      }
      const cookieState = authenticationState(connection, req)
      if (cookieState === 'forbidden') {
        json(res, 403, { state: 'forbidden' })
        return
      }
      if (cookieState !== 'unauthenticated') {
        json(res, 200, {
          state: 'ready', action: 'reload', cutoverId: ready.cutoverId,
          role: ready.role, authentication: 'existing-cookie',
        })
        return
      }
      if (connection?.authenticatedUrl === undefined) {
        json(res, 200, { state: 'waiting', cutoverId: active.receipt.id })
        return
      }
      let launchUrl: string
      try {
        launchUrl = connection.authenticatedUrl(requestAuthority.origin)
      } catch {
        json(res, 500, { state: 'unavailable' })
        return
      }
      let safe = false
      try {
        const parsed = new URL(launchUrl)
        safe = parsed.origin === requestAuthority.origin && parsed.pathname === '/'
          && parsed.username === '' && parsed.password === '' && parsed.search !== '' && parsed.hash === ''
      } catch { /* unsafe provider output */ }
      if (!safe) {
        json(res, 500, { state: 'unavailable' })
        return
      }
      json(res, 200, {
        state: 'ready', action: 'replace', cutoverId: ready.cutoverId,
        role: ready.role, authentication: 'launch-url', launchUrl,
      })
      return
    }

    const receipt = readCutoverReceipt(dependencies.stateDir)
    if (receipt === null || receipt.id !== message.cutoverId) {
      json(res, 409, { state: 'stale' })
      return
    }
    const ready = currentReadyOwnership(dependencies.stateDir, pid, identityMatches)
    if (ready === null || ready.cutoverId !== message.cutoverId) {
      if (receipt.browserHandoff.status === 'acknowledged') {
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
      } else {
        json(res, 409, { state: 'waiting' })
      }
      return
    }
    if (ready.protected && connection?.requestRejection === undefined) {
      json(res, 409, { state: 'waiting' })
      return
    }
    const ackAuthentication = authenticationState(connection, req)
    if (ackAuthentication === 'unauthenticated' || ackAuthentication === 'forbidden') {
      json(res, ackAuthentication === 'forbidden' ? 403 : 401, {
        state: ackAuthentication === 'forbidden' ? 'forbidden' : 'unauthorized',
      })
      return
    }
    if (message.channel === 'original-tab') {
      const registration = readBrowserHandoffRequest(dependencies.stateDir)
      if (message.capability === undefined || registration?.cutoverId !== message.cutoverId
        || registration.authority !== requestAuthority.authority
        || registration.capabilitySha256 !== capabilitySha256(message.capability)) {
        json(res, 403, { state: 'forbidden' })
        return
      }
    }
    const acknowledgement: BrowserHandoffAcknowledgement = {
      version: 1,
      cutoverId: message.cutoverId,
      role: ready.role,
      authority: requestAuthority.authority,
      listenerPid: ready.ownership.listenerPid,
      listenerStartToken: ready.ownership.listenerStartToken,
      channel: message.channel,
      authentication: message.authentication,
      acknowledgedAt: now(),
    }
    const ackFile = stateFile(dependencies.stateDir, 'browserHandoffAck')
    if (!createJsonOnce(ackFile, acknowledgement)) {
      const existing = readBrowserHandoffAcknowledgement(dependencies.stateDir)
      if (existing?.cutoverId !== acknowledgement.cutoverId
        || existing.listenerPid !== acknowledgement.listenerPid
        || existing.listenerStartToken !== acknowledgement.listenerStartToken) {
        json(res, 409, { state: 'conflict' })
        return
      }
    }
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
  }
}

/** Register the optional Web-profile bridge; headless/TUI compositions simply never activate it. */
export function registerBrowserHandoff(ctx: Context, stateDir: string): void {
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer') as WebServerSlice | undefined
    if (webServer === undefined) return
    const handler = createBrowserHandoffHandler({
      stateDir,
      connectionProvider: () => webCtx.get('connection') as ConnectionSlice | undefined,
    })
    webCtx.effect(() => webServer.register({ kind: 'exact', path: BROWSER_HANDOFF_ROUTE, handler }), 'ankh-guard: browser handoff route')
  })
}
