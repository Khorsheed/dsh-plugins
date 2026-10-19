/**
 * Endpoint-key authentication — the claude-code harness's ONLY auth mode.
 * There is no OAuth anywhere in this package: a delegation round reaches its
 * endpoint with `ANTHROPIC_BASE_URL` plus `ANTHROPIC_API_KEY` (x-api-key) or
 * `ANTHROPIC_AUTH_TOKEN` (Authorization: Bearer), exactly the environment a
 * shell would export for a proxy relay, and `claude -p` needs nothing else
 * (verified against claude 2.1.296: a fresh scoped home with only these
 * variables runs a round and scaffolds `.claude.json` itself — no onboarding
 * or key-approval gate in headless mode).
 *
 * Two layers, merged per field, file over config:
 *
 * - `<scopedHome>/endpoint-auth.json` (mode 0600) — the per-scope credential.
 *   Its name deliberately matches the eval contract hash's credential denylist
 *   (`auth`), so the key material never enters an evaluation's condition
 *   fingerprint; the file's mtime serves as the credential stamp, which makes
 *   "edit the file" the recovery gesture for a `rejected` grade.
 * - The plugin config's `baseUrl` / `apiKey` / `authToken` — the deployment
 *   default every scope without a file shares. Read PER ROUND from the
 *   apply-time snapshot, so a profile edit applies to the next round (and a
 *   host restart clears the in-memory `rejected` mark).
 *
 * The env layer this module emits rides the family's existing plumbing:
 * `delegationEnv` on the host, and `containerExecSpawn`'s name-only `-e`
 * forwarding into a container (the value travels in the docker client's
 * environment, never on an argv). A containerized round therefore
 * authenticates with the same credential as the host — nothing is authorized
 * inside the unit, which is the point.
 * @module @khorsheed/dsh-local-agent-claude-code/endpoint-auth
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The scoped-home credential file's name. Chosen to match the eval contract
 * hash's credential-shaped denylist (`/token|key|credential|secret|password|auth|\.env/i`),
 * so the file is excluded from condition fingerprints by name.
 */
export const ENDPOINT_AUTH_FILE = 'endpoint-auth.json'

/**
 * One scope's endpoint credential. `baseUrl` is optional (absent means the
 * CLI's own default endpoint — an official console key needs no relay); at
 * least one of `apiKey` / `authToken` must be non-empty for the scope to
 * count as authenticated. When both are set the CLI's own precedence rules
 * apply — the package passes both through untouched.
 */
export interface ClaudeEndpointAuth {
  readonly baseUrl?: string
  /** Sent as `ANTHROPIC_API_KEY` (the `x-api-key` header). */
  readonly apiKey?: string
  /** Sent as `ANTHROPIC_AUTH_TOKEN` (the `Authorization: Bearer` header). */
  readonly authToken?: string
}

/** Trim and normalize one credential field; blank reads as absent. */
function field(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Whether a resolved endpoint carries a usable credential. */
export function hasEndpointCredential(auth: ClaudeEndpointAuth | undefined): auth is ClaudeEndpointAuth & { apiKey: string } | ClaudeEndpointAuth & { authToken: string } {
  return auth !== undefined && (field(auth.apiKey) !== undefined || field(auth.authToken) !== undefined)
}

/**
 * Read the scope's endpoint-auth.json. Absent or unreadable yields undefined
 * (the caller falls back to the plugin config); malformed JSON or a non-object
 * payload also yields undefined — a torn file must not fail a status read.
 * Non-string fields are dropped, never carried through.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the file's endpoint credential, or undefined.
 */
export async function readEndpointAuthFile(homeDir: string): Promise<ClaudeEndpointAuth | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, ENDPOINT_AUTH_FILE), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const baseUrl = field(parsed['baseUrl'])
    const apiKey = field(parsed['apiKey'])
    const authToken = field(parsed['authToken'])
    return {
      ...baseUrl === undefined ? {} : { baseUrl },
      ...apiKey === undefined ? {} : { apiKey },
      ...authToken === undefined ? {} : { authToken },
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve one scope's effective endpoint credential: the scope's
 * endpoint-auth.json merged FIELD BY FIELD over the plugin config's
 * `baseUrl` / `apiKey` / `authToken` (a file that names only a key rotates
 * the key while keeping the deployment's relay URL). The result may carry no
 * credential at all — {@link hasEndpointCredential} is the judgment, kept
 * separate so the caller can still route/log the resolved baseUrl.
 * @param homeDir - the scope's scoped home.
 * @param config - the plugin config's deployment-level endpoint triple.
 * @returns the merged endpoint auth.
 */
export async function resolveEndpointAuth(
  homeDir: string,
  config: ClaudeEndpointAuth,
): Promise<ClaudeEndpointAuth> {
  const file = await readEndpointAuthFile(homeDir)
  const configBaseUrl = field(config.baseUrl)
  const configApiKey = field(config.apiKey)
  const configAuthToken = field(config.authToken)
  return {
    ...configBaseUrl === undefined ? {} : { baseUrl: configBaseUrl },
    ...configApiKey === undefined ? {} : { apiKey: configApiKey },
    ...configAuthToken === undefined ? {} : { authToken: configAuthToken },
    ...file,
  }
}

/**
 * The spawn-env layer for a resolved endpoint: one entry per defined field,
 * nothing else. Undefined yields an empty layer — the spread then adds no
 * keys at all, byte-identical to the pre-endpoint env.
 * @param auth - the resolved endpoint auth, or undefined.
 * @returns the explicit env entries for the delegation spawn.
 */
export function endpointAuthEnv(auth: ClaudeEndpointAuth | undefined): NodeJS.ProcessEnv {
  if (auth === undefined) return {}
  const baseUrl = field(auth.baseUrl)
  const apiKey = field(auth.apiKey)
  const authToken = field(auth.authToken)
  return {
    ...baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: baseUrl },
    ...apiKey === undefined ? {} : { ANTHROPIC_API_KEY: apiKey },
    ...authToken === undefined ? {} : { ANTHROPIC_AUTH_TOKEN: authToken },
  }
}

/**
 * The credential marker's modification stamp (epoch ms): the endpoint file's
 * mtime, or undefined when the scope has no file (a config-sourced credential
 * has no marker — rotating it pairs with the profile edit and instance
 * restart that clear the in-memory grade marks). A fresh file write is a
 * fresh stamp, which is how an edited-in key recovers a `rejected` grade.
 * @param homeDir - the scope's scoped home.
 * @returns the stamp, or undefined.
 */
export async function endpointAuthStamp(homeDir: string): Promise<number | undefined> {
  try {
    return (await stat(join(homeDir, ENDPOINT_AUTH_FILE))).mtimeMs
  } catch {
    return undefined
  }
}

/** Whether the scope carries its own endpoint file at all. */
export async function endpointAuthFileExists(homeDir: string): Promise<boolean> {
  return (await endpointAuthStamp(homeDir)) !== undefined
}

/**
 * Write the scope's endpoint-auth.json (mode 0600, mkdir -p first), the
 * per-scope provisioning path an evaluation's `conditions provision` (or a
 * person) uses to give one scope its own credential. Whole-file write: the
 * payload is exactly what {@link readEndpointAuthFile} parses back.
 * @param homeDir - the scope's scoped home.
 * @param auth - the endpoint credential to persist.
 */
export async function writeEndpointAuth(homeDir: string, auth: ClaudeEndpointAuth): Promise<void> {
  await mkdir(homeDir, { recursive: true })
  const baseUrl = field(auth.baseUrl)
  const apiKey = field(auth.apiKey)
  const authToken = field(auth.authToken)
  const payload: Record<string, string> = {
    ...baseUrl === undefined ? {} : { baseUrl },
    ...apiKey === undefined ? {} : { apiKey },
    ...authToken === undefined ? {} : { authToken },
  }
  await writeFile(join(homeDir, ENDPOINT_AUTH_FILE), JSON.stringify(payload, undefined, 2) + '\n', { mode: 0o600 })
}

/**
 * Clear the scope's OWN endpoint credential (the endpoint-auth.json file).
 * A deployment-level credential from the plugin config is untouched — the
 * core's logout reply then names the profile row as the place to edit.
 * @param homeDir - the scope's scoped home.
 */
export async function clearEndpointAuth(homeDir: string): Promise<void> {
  await rm(join(homeDir, ENDPOINT_AUTH_FILE), { force: true })
}

/** The official endpoint used when no baseUrl is configured anywhere. */
export const OFFICIAL_BASE_URL = 'https://api.anthropic.com'

/** How many served model ids the check reply lists before truncating. */
const CHECK_MODEL_LIST_LIMIT = 8

/** Bound on the error-body excerpt a failed check reports. */
const CHECK_ERROR_BODY_LIMIT = 200

/** The subcommand's fetch shape (injected in tests). */
export type EndpointCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** One model the endpoint serves, from `GET <baseUrl>/v1/models`. */
export interface EndpointServedModel {
  readonly id: string
  readonly displayName?: string
  /** Reasoning effort levels the endpoint advertises for this model, in ascending order. */
  readonly efforts?: readonly string[]
}

/**
 * The outcome of one `GET <baseUrl>/v1/models`: the parsed model list, the
 * HTTP status when the endpoint answered, or the transport error's message.
 * Callers fold it their own way (the check's verdict text, the catalog's
 * directory); no case throws.
 */
export type EndpointModelsResult =
  | { readonly kind: 'models'; readonly models: readonly EndpointServedModel[] }
  | { readonly kind: 'http'; readonly status: number; readonly body: string }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'malformed' }

/** The effort levels one served-model entry advertises, oldest-first. */
function servedEfforts(effort: unknown): readonly string[] | undefined {
  if (typeof effort !== 'object' || effort === null) return undefined
  const levels = ['low', 'medium', 'high', 'xhigh', 'max']
    .filter(level => (effort as Record<string, { supported?: unknown }>)[level]?.supported === true)
  return levels.length === 0 ? undefined : levels
}

/**
 * `GET <baseUrl>/v1/models` with the resolved credential's auth header(s) —
 * the token-free endpoint probe shared by the `/claude-code check` verdict
 * and the model catalog. Anthropic's own API serves this route with
 * `x-api-key`; relays (openproxy verified) proxy it and answer the same
 * shape. Never throws: every failure mode folds into the result.
 * @param endpoint - the resolved endpoint auth (caller checks the credential).
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param signal - abort for the whole probe (timeout bundled by the caller).
 * @returns the folded result.
 */
export async function fetchEndpointModels(
  endpoint: ClaudeEndpointAuth & { readonly baseUrl: string } ,
  fetchImpl?: EndpointCheckFetch,
  signal?: AbortSignal,
): Promise<EndpointModelsResult> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (endpoint.apiKey !== undefined) headers['x-api-key'] = endpoint.apiKey
  if (endpoint.authToken !== undefined) headers['authorization'] = `Bearer ${endpoint.authToken}`
  const fetcher = fetchImpl ?? (globalThis.fetch as unknown as EndpointCheckFetch)
  const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/v1/models`
  let response: { ok: boolean; status: number; text(): Promise<string> }
  try {
    response = await fetcher(url, { headers, signal: signal ?? AbortSignal.timeout(8_000) })
  } catch (error) {
    return { kind: 'unreachable', message: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    return { kind: 'http', status: response.status, body: (await response.text().catch(() => '')).slice(0, CHECK_ERROR_BODY_LIMIT) }
  }
  let data: unknown
  try {
    data = (JSON.parse(await response.text()) as { data?: unknown }).data
  } catch {
    return { kind: 'malformed' }
  }
  if (!Array.isArray(data)) return { kind: 'malformed' }
  const models: EndpointServedModel[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { id?: unknown; display_name?: unknown; effort?: unknown }
    if (typeof record.id !== 'string' || record.id === '') continue
    const efforts = servedEfforts(record.effort)
    models.push({
      id: record.id,
      ...typeof record.display_name === 'string' && record.display_name !== '' ? { displayName: record.display_name } : {},
      ...efforts === undefined ? {} : { efforts },
    })
  }
  return { kind: 'models', models }
}

/**
 * Probe the resolved endpoint with a cheap, token-free round-trip: `GET
 * <baseUrl>/v1/models` with the resolved credential's auth header(s). A 200
 * proves both reachability and credential validity — the exact evidence a
 * "verify" button needs — and the served model list rides the reply so the
 * user sees what the endpoint offers (any id can be typed into the model
 * field by hand). Never throws: every failure mode folds into the reply
 * text, since the reply IS the diagnostic.
 * @param endpoint - the resolved endpoint auth (scope file over settings).
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param timeoutMs - the whole probe's deadline.
 * @returns the human-readable verdict for the `/claude-code check` reply.
 */
export async function checkClaudeEndpoint(
  endpoint: ClaudeEndpointAuth,
  fetchImpl?: EndpointCheckFetch,
  timeoutMs = 8_000,
): Promise<string> {
  if (!hasEndpointCredential(endpoint)) {
    return 'No endpoint credential configured — fill API Key or Auth Token on the settings card (or the profile row) first.'
  }
  const baseUrl = (endpoint.baseUrl ?? OFFICIAL_BASE_URL).replace(/\/+$/, '')
  const result = await fetchEndpointModels({ ...endpoint, baseUrl }, fetchImpl, AbortSignal.timeout(timeoutMs))
  if (result.kind === 'unreachable') return `Endpoint unreachable (${baseUrl}): ${result.message}`
  if (result.kind === 'http') {
    return `Endpoint answered HTTP ${String(result.status)} (${baseUrl})${result.body === '' ? '' : `: ${result.body}`}`
  }
  if (result.kind === 'malformed') {
    return `Endpoint reachable (${baseUrl}) but the model list did not parse — the credential worked, the reply was not /v1/models-shaped.`
  }
  if (result.models.length === 0) return `Endpoint reachable (${baseUrl}); it serves no models.`
  const ids = result.models.map(model => model.id)
  const listed = ids.slice(0, CHECK_MODEL_LIST_LIMIT).join(', ')
  const more = ids.length > CHECK_MODEL_LIST_LIMIT ? `, … +${String(ids.length - CHECK_MODEL_LIST_LIMIT)} more` : ''
  return `Endpoint reachable (${baseUrl}): ${String(ids.length)} model(s) served — ${listed}${more}`
}
