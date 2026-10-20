/**
 * Endpoint-key authentication — one of the codex harness's TWO auth modes,
 * alongside the device-code/browser login (auth.json). Both stay available;
 * the resolved endpoint credential simply WINS at spawn when it carries a
 * key: the round's argv then names a custom `model_providers` entry pointing
 * at the relay and the key travels as `OPENAI_API_KEY` in the process
 * environment, so codex never consults auth.json for that round. With no
 * endpoint credential the spawn is byte-identical to the pre-endpoint shape
 * and the web login serves exactly as before.
 *
 * Verified against codex-cli 0.163.0 (2026-10-20): a fresh scoped home with
 * only `OPENAI_API_KEY` plus the two `-c` overrides below runs
 * `codex exec -m <model>` end-to-end through an OpenAI-compatible relay
 * (openproxy, `wire_api = "responses"`) — no login, no auth.json, no
 * onboarding gate.
 *
 * Two layers, merged per field, file over config:
 *
 * - `<scopedHome>/endpoint-auth.json` (mode 0600) — the per-scope credential.
 *   Its name deliberately matches the eval contract hash's credential denylist
 *   (`auth`), so the key material never enters an evaluation's condition
 *   fingerprint; the file's mtime serves as the credential stamp, which makes
 *   "edit the file" the recovery gesture for a `rejected` grade.
 * - The plugin config's `baseUrl` / `apiKey` — the deployment default every
 *   scope without a file shares. Read PER ROUND, so a profile edit applies to
 *   the next round (and a host restart clears the in-memory `rejected` mark).
 *
 * `wireApi` is a file-only escape hatch: the settings card never edits it,
 * the default `responses` is codex's native wire (relay-verified), and a
 * hand-edit to `"chat"` survives the card's whole-file writes because the
 * read merges it back. The env layer rides the family's existing plumbing:
 * `delegationEnv` on the host, `containerExecSpawn`'s name-only `-e`
 * forwarding into a container — a containerized round authenticates with the
 * same credential as the host, nothing is authorized inside the unit.
 * @module @khorsheed/dsh-local-agent-codex/endpoint-auth
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The scoped-home credential file's name. Chosen to match the eval contract
 * hash's credential-shaped denylist (`/token|key|credential|secret|password|auth|\.env/i`),
 * so the file is excluded from condition fingerprints by name.
 */
export const ENDPOINT_AUTH_FILE = 'endpoint-auth.json'

/** The custom provider's TOML key in the `-c` overrides (bare-key safe). */
export const ENDPOINT_PROVIDER_NAME = 'dsh-endpoint'

/** The env var the custom provider reads the key from (`env_key`). */
export const ENDPOINT_ENV_KEY = 'OPENAI_API_KEY'

/**
 * One scope's endpoint credential. `baseUrl` is optional (absent means the
 * CLI's own default OpenAI endpoint — an official platform key needs no
 * relay); a non-empty `apiKey` is what makes the scope endpoint-authenticated.
 * `wireApi` selects the custom provider's wire protocol; absent defaults to
 * `responses` (codex's native wire, relay-verified).
 */
export interface CodexEndpointAuth {
  readonly baseUrl?: string
  /** Sent as the custom provider's `env_key` environment value (Bearer). */
  readonly apiKey?: string
  /** `responses` (default) or `chat`; file-only, never card-edited. */
  readonly wireApi?: string
}

/** Trim and normalize one credential field; blank reads as absent. */
function field(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Whether a resolved endpoint carries a usable credential. */
export function hasEndpointCredential(auth: CodexEndpointAuth | undefined): auth is CodexEndpointAuth & { apiKey: string } {
  return auth !== undefined && field(auth.apiKey) !== undefined
}

/**
 * Read the scope's endpoint-auth.json. Absent or unreadable yields undefined
 * (the caller falls back to the plugin config); malformed JSON or a non-object
 * payload also yields undefined — a torn file must not fail a status read.
 * Non-string fields are dropped, never carried through.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the file's endpoint credential, or undefined.
 */
export async function readEndpointAuthFile(homeDir: string): Promise<CodexEndpointAuth | undefined> {
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
    const wireApi = field(parsed['wireApi'])
    return {
      ...baseUrl === undefined ? {} : { baseUrl },
      ...apiKey === undefined ? {} : { apiKey },
      ...wireApi === undefined ? {} : { wireApi },
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve one scope's effective endpoint credential: the scope's
 * endpoint-auth.json merged FIELD BY FIELD over the plugin config's
 * `baseUrl` / `apiKey` (a file that names only a key rotates the key while
 * keeping the deployment's relay URL). The result may carry no credential at
 * all — {@link hasEndpointCredential} is the judgment, kept separate so the
 * caller can still route/log the resolved baseUrl.
 * @param homeDir - the scope's scoped home.
 * @param config - the plugin config's deployment-level endpoint pair.
 * @returns the merged endpoint auth.
 */
export async function resolveEndpointAuth(
  homeDir: string,
  config: CodexEndpointAuth,
): Promise<CodexEndpointAuth> {
  const file = await readEndpointAuthFile(homeDir)
  const configBaseUrl = field(config.baseUrl)
  const configApiKey = field(config.apiKey)
  return {
    ...configBaseUrl === undefined ? {} : { baseUrl: configBaseUrl },
    ...configApiKey === undefined ? {} : { apiKey: configApiKey },
    ...file,
  }
}

/**
 * The spawn-env layer for a resolved endpoint: the key under the custom
 * provider's `env_key` name, nothing else. A credential-less resolution
 * yields an empty layer — the spread then adds no keys at all, byte-identical
 * to the pre-endpoint env. With no baseUrl the CLI's built-in OpenAI provider
 * reads the same variable, so an official platform key needs no `-c`
 * override either.
 * @param auth - the resolved endpoint auth, or undefined.
 * @returns the explicit env entries for the delegation spawn.
 */
export function endpointAuthEnv(auth: CodexEndpointAuth | undefined): NodeJS.ProcessEnv {
  const apiKey = field(auth?.apiKey)
  return apiKey === undefined ? {} : { [ENDPOINT_ENV_KEY]: apiKey }
}

/** Quote one TOML basic string for the `-c` config override. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The `-c` config overrides routing the CLI at the resolved relay: a custom
 * `model_providers` entry plus the `model_provider` selection, as a flat argv
 * fragment (`-c <override>` pairs). Empty unless BOTH a key and a baseUrl are
 * present — a key without a relay URL is served by the built-in provider
 * through the env layer alone, and a relay URL without a key would route
 * every round into a 401. Verified end-to-end against codex-cli 0.163.0.
 * @param auth - the resolved endpoint auth, or undefined.
 * @returns the argv fragment, possibly empty.
 */
export function endpointConfigOverrides(auth: CodexEndpointAuth | undefined): string[] {
  const baseUrl = field(auth?.baseUrl)
  const apiKey = field(auth?.apiKey)
  if (baseUrl === undefined || apiKey === undefined) return []
  const wireApi = field(auth?.wireApi) ?? 'responses'
  return [
    '-c', `model_provider=${tomlString(ENDPOINT_PROVIDER_NAME)}`,
    '-c', `model_providers.${ENDPOINT_PROVIDER_NAME}={`
      + `name=${tomlString(ENDPOINT_PROVIDER_NAME)},`
      + `base_url=${tomlString(baseUrl)},`
      + `env_key=${tomlString(ENDPOINT_ENV_KEY)},`
      + `wire_api=${tomlString(wireApi)}`
      + `}`,
  ]
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
 * Write the scope's endpoint-auth.json (mode 0600, mkdir -p first). The
 * payload preserves the file-only `wireApi` across card writes: callers pass
 * the merged object (current file + edits), never a bare card payload.
 * @param homeDir - the scope's scoped home.
 * @param auth - the endpoint credential to persist.
 */
export async function writeEndpointAuth(homeDir: string, auth: CodexEndpointAuth): Promise<void> {
  await mkdir(homeDir, { recursive: true })
  const baseUrl = field(auth.baseUrl)
  const apiKey = field(auth.apiKey)
  const wireApi = field(auth.wireApi)
  const payload: Record<string, string> = {
    ...baseUrl === undefined ? {} : { baseUrl },
    ...apiKey === undefined ? {} : { apiKey },
    ...wireApi === undefined ? {} : { wireApi },
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
export const OFFICIAL_BASE_URL = 'https://api.openai.com'

/** How many served model ids the check reply lists before truncating. */
const CHECK_MODEL_LIST_LIMIT = 8

/** Bound on the error-body excerpt a failed check reports. */
const CHECK_ERROR_BODY_LIMIT = 200

/** The probe's fetch shape (injected in tests). */
export type EndpointCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/**
 * The outcome of one `GET <baseUrl>/v1/models`: the parsed id list, the HTTP
 * status when the endpoint answered, or the transport error's message. No
 * case throws.
 */
export type EndpointModelsResult =
  | { readonly kind: 'models'; readonly models: readonly string[] }
  | { readonly kind: 'http'; readonly status: number; readonly body: string }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'malformed' }

/**
 * `GET <baseUrl>/v1/models` with `Authorization: Bearer <key>` — the
 * token-free endpoint probe shared by the `/codex check` verdict and any
 * future catalog. OpenAI's own API serves this route with the platform key;
 * relays (openproxy verified 2026-10-20, 139 models) proxy it and answer the
 * same OpenAI-list shape. Never throws: every failure mode folds into the
 * result.
 * @param endpoint - the resolved endpoint auth with a decided baseUrl.
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param signal - abort for the whole probe (timeout bundled by the caller).
 * @returns the folded result.
 */
export async function fetchEndpointModels(
  endpoint: CodexEndpointAuth & { readonly baseUrl: string },
  fetchImpl?: EndpointCheckFetch,
  signal?: AbortSignal,
): Promise<EndpointModelsResult> {
  const headers: Record<string, string> = {}
  if (endpoint.apiKey !== undefined) headers['authorization'] = `Bearer ${endpoint.apiKey}`
  const fetcher = fetchImpl ?? (globalThis.fetch as unknown as EndpointCheckFetch)
  // The OpenAI convention names the base WITH `/v1` (codex's own
  // `model_providers.*.base_url` does), the relay convention sometimes omits
  // it — accept both instead of doubling the segment.
  const root = endpoint.baseUrl.replace(/\/+$/, '')
  const url = `${root}${root.endsWith('/v1') ? '' : '/v1'}/models`
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
  const models: string[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') models.push(id)
  }
  return { kind: 'models', models }
}

/**
 * Probe the resolved endpoint with a cheap, token-free round-trip: `GET
 * <baseUrl>/v1/models` with the resolved credential's Bearer header. A 200
 * proves both reachability and credential validity — the exact evidence a
 * "verify" button needs — and the served model list rides the reply. One
 * transport-level retry rides along: a local proxy restart (a Surge/clash
 * reload) stalls the first attempt into the timeout and answers the retry
 * immediately. Never throws: every failure mode folds into the reply text,
 * since the reply IS the diagnostic.
 * @param endpoint - the resolved endpoint auth (scope file over settings).
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param timeoutMs - one attempt's deadline (two attempts at most).
 * @returns the human-readable verdict for the check reply.
 */
export async function checkCodexEndpoint(
  endpoint: CodexEndpointAuth,
  fetchImpl?: EndpointCheckFetch,
  timeoutMs = 20_000,
): Promise<string> {
  if (!hasEndpointCredential(endpoint)) {
    return 'No endpoint credential configured — fill Base URL and API Key on the settings card (or the profile row) first.'
  }
  const baseUrl = (endpoint.baseUrl ?? OFFICIAL_BASE_URL).replace(/\/+$/, '')
  let result = await fetchEndpointModels({ ...endpoint, baseUrl }, fetchImpl, AbortSignal.timeout(timeoutMs))
  if (result.kind === 'unreachable') {
    result = await fetchEndpointModels({ ...endpoint, baseUrl }, fetchImpl, AbortSignal.timeout(timeoutMs))
  }
  if (result.kind === 'unreachable') return `Endpoint unreachable (${baseUrl}): ${result.message}`
  if (result.kind === 'http') {
    return `Endpoint answered HTTP ${String(result.status)} (${baseUrl})${result.body === '' ? '' : `: ${result.body}`}`
  }
  if (result.kind === 'malformed') {
    return `Endpoint reachable (${baseUrl}) but the model list did not parse — the credential worked, the reply was not /v1/models-shaped.`
  }
  if (result.models.length === 0) return `Endpoint reachable (${baseUrl}); it serves no models.`
  const listed = result.models.slice(0, CHECK_MODEL_LIST_LIMIT).join(', ')
  const more = result.models.length > CHECK_MODEL_LIST_LIMIT ? `, … +${String(result.models.length - CHECK_MODEL_LIST_LIMIT)} more` : ''
  return `Endpoint reachable (${baseUrl}): ${String(result.models.length)} model(s) served — ${listed}${more}`
}
