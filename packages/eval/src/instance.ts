/**
 * The CLI's client for a RUNNING instance: start a run over the orchestrator's
 * Remote face and follow its log to the end.
 *
 * This is the CI door. A run needs three things the CLI process does not have
 * — the datasets/mission/localAgent services, a live parent agent, and the
 * instance's own scoped homes — so `dsh-eval run` outside an instance stays
 * dry-run-only. With `--instance` the CLI stops pretending to be an
 * orchestrator and becomes what a pipeline actually needs: a caller.
 *
 * The transport is the instance's ordinary Remote RPC — `POST
 * <base>/api/<namespace>/<method>` carrying the connection's own request
 * envelope (`{ type: 'client-request', rpcId, method, payload: { args } }`,
 * where `method` must equal the endpoint the path names) and answering with
 * `{ type: 'server-response', rpcId, result: { ok, value } }`. Authentication is the instance's own browser
 * scheme and it takes two steps, because the launch token is only accepted at
 * ONE door: `GET /?token=…` mints an authority-bound signed cookie and
 * redirects, and every later request — `/api` included — carries that cookie.
 * So this client exchanges the token once and reuses the cookie, which is
 * exactly what a browser does. Nothing here is eval-specific except the four
 * method names.
 * @module @khorsheed/dsh-eval/instance
 */
import type { EvalRunOutputView, EvalRunRequest, EvalRunStarted } from './types.ts'

/** The Remote namespace the orchestrator registers. */
const NAMESPACE = 'dshEval'

/** How long to wait between output polls while a run is live. */
export const DEFAULT_POLL_MS = 5_000

/** Thrown when the instance answers something other than a result. */
export class InstanceCallError extends Error {}

/** One instance's Remote endpoint, with its token. */
export interface InstanceTarget {
  /** Base URL of the running instance (`http://127.0.0.1:3171`). */
  baseUrl: string
  /** The instance's launch token, when it requires one. */
  token?: string
  /**
   * The session cookie, once {@link authenticateInstance} exchanged the token
   * for one. Passing a cookie directly skips the exchange.
   */
  cookie?: string
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch
}

/**
 * Exchange the launch token for the instance's signed browser cookie — the
 * ONE door that accepts a token (`GET /?token=…`, which redirects and sets
 * the cookie). Without a token there is nothing to exchange and the caller
 * must already be authenticated some other way (a cookie it was handed, or
 * an instance that requires none).
 * @param target - the instance and its token.
 * @returns the `Cookie` header value, or undefined when no token was given.
 * @throws {@link InstanceCallError} when the instance refused the token.
 */
export async function authenticateInstance(target: InstanceTarget): Promise<string | undefined> {
  if (target.cookie !== undefined) return target.cookie
  if (target.token === undefined || target.token === '') return undefined
  const base = target.baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}/`)
  url.searchParams.set('token', target.token)
  const doFetch = target.fetch ?? fetch
  let response: Response
  try {
    // `manual`: the instance answers 303 and the cookie rides THAT response;
    // following the redirect would drop it.
    response = await doFetch(url, { method: 'GET', redirect: 'manual' })
  } catch (error) {
    throw new InstanceCallError(`${base}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) {
    throw new InstanceCallError(
      `${base}: the instance did not accept the token (HTTP ${response.status}) — check --token against the URL it printed at startup`,
    )
  }
  // One cookie, and only its name=value pair travels back.
  return setCookie.split(';')[0] as string
}

/**
 * Call one Remote method on an instance.
 * @param target - the instance and its token.
 * @param method - the method name on the `dshEval` namespace.
 * @param args - the method's arguments, BY NAME (the wire's own shape).
 * @returns the method's result.
 * @throws {@link InstanceCallError} on a transport failure or an `ok: false`
 *   envelope — with the instance's own message, which is the thing a CI log
 *   should carry.
 */
export async function callInstance<T>(
  target: InstanceTarget,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const base = target.baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}/api/${NAMESPACE}/${method}`)
  if (target.token !== undefined && target.token !== '') url.searchParams.set('token', target.token)
  const doFetch = target.fetch ?? fetch
  const endpoint = `${NAMESPACE}/${method}`
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(target.cookie === undefined ? {} : { cookie: target.cookie }),
      },
      // The connection's envelope, not a bare payload: `method` must equal
      // the endpoint the URL names (the host checks), and `rpcId` correlates
      // the answer — one call per request here, so any unique id will do.
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `dsh-eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        method: endpoint,
        payload: { args },
      }),
    })
  } catch (error) {
    throw new InstanceCallError(`${base}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    // 401/403 is the token; a 404 usually means the instance runs a
    // composition without this plugin. Both are worth saying plainly.
    const hint = response.status === 401 || response.status === 403
      ? ' — pass the instance launch token with --token'
      : response.status === 404
        ? ` — does that instance mount @khorsheed/dsh-eval? (no ${NAMESPACE} Remote answered)`
        : ''
    throw new InstanceCallError(`${base}: HTTP ${response.status} ${response.statusText}${hint}`)
  }
  const envelope = await response.json() as {
    result?: { ok?: boolean; value?: unknown; error?: { message?: string; details?: unknown } }
  }
  const result = envelope.result
  if (result?.ok !== true) {
    throw new InstanceCallError(`${base}: ${result?.error?.message ?? 'the instance refused the call'}`)
  }
  return result.value as T
}

/** What the CLI's follow loop reports back to its caller. */
export interface InstanceRunOutcome {
  jobId: string
  runId: string
  /** The job's terminal status, or `running` when the caller asked not to follow. */
  status: string
  detail?: string
}

/**
 * Start a run on an instance and (unless `follow` is false) print its log
 * until the job settles.
 * @param target - the instance and its token.
 * @param request - the plan path ON THE INSTANCE and the run's knobs.
 * @param io - where the lines go; `write` gets one line at a time.
 * @param options - polling interval, whether to follow, and a sleep seam.
 * @returns the job's identity and terminal status.
 */
export async function runOnInstance(
  target: InstanceTarget,
  request: EvalRunRequest,
  io: { write(line: string): void },
  options: { follow?: boolean; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<InstanceRunOutcome> {
  // One token exchange for the whole follow loop.
  const cookie = await authenticateInstance(target)
  const session: InstanceTarget = { ...target, ...(cookie === undefined ? {} : { cookie }) }
  const started = await callInstance<EvalRunStarted>(session, 'runStart', { request })
  io.write(`eval run started — job ${started.jobId} · run ${started.runId}`)
  io.write(`parent session: ${started.parentSessionId}${started.ownParentSession === true ? ' (opened for this run)' : ''}`)
  if (options.follow === false) {
    return { jobId: started.jobId, runId: started.runId, status: 'running' }
  }
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let cursor = 0
  for (;;) {
    const output = await callInstance<EvalRunOutputView>(session, 'runOutput', { jobId: started.jobId, cursor })
    for (const line of output.lines) io.write(line)
    cursor = output.cursor
    if (output.done) {
      return {
        jobId: started.jobId,
        runId: started.runId,
        status: output.status,
        ...(output.detail === undefined ? {} : { detail: output.detail }),
      }
    }
    await sleep(pollMs)
  }
}
