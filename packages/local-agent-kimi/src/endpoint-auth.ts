/**
 * Endpoint-key authentication — the kimi harness's ONLY auth mode. There is
 * no OAuth anywhere in this package: the scoped config's managed provider
 * (`managed:kimi-code`) declares `api_key_env = "DSH_KIMI_ENDPOINT_KEY"`
 * (kimi-cli ≥2.1 reads the key from that environment variable — verified by
 * the CLI's own "declares api_key_env but the environment variable is not
 * set" diagnostic), the key itself lives only here and in the child process's
 * environment, and `config.toml` carries no secret, so it stays a legitimate
 * evaluation-condition input.
 *
 * Two layers, merged per field, file over config:
 *
 * - `<scopedHome>/endpoint-auth.json` (mode 0600) — the per-scope credential.
 *   Its name deliberately matches the eval contract hash's credential denylist
 *   (`auth`), so the key material never enters an evaluation's condition
 *   fingerprint; the file's mtime serves as the credential stamp, which makes
 *   "edit the file" the recovery gesture for a `rejected` grade.
 * - The plugin config's `baseUrl` / `apiKey` — the deployment default every
 *   scope without a file shares. Read PER ROUND from the apply-time snapshot,
 *   so a profile edit applies to the next round (and a host restart clears
 *   the in-memory `rejected` mark).
 *
 * `baseUrl` is optional: absent means kimi's own coding service
 * ({@link KIMI_MANAGED_BASE_URL} — an official platform key needs no relay).
 * A present baseUrl is written into the managed provider's `base_url` by the
 * config surgery (provision.ts), which is also what keeps the two layers'
 * merge honest: the file the CLI reads always shows the effective endpoint.
 *
 * The env layer rides the family's existing plumbing: `delegationEnv` on the
 * host, `containerExecSpawn`'s name-only `-e` forwarding into a container —
 * a containerized round authenticates with the same credential as the host,
 * nothing is authorized inside the unit.
 * @module @khorsheed/dsh-local-agent-kimi/endpoint-auth
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
 * The environment variable the managed provider's `api_key_env` names. The
 * key material only ever lives in endpoint-auth.json and in the child
 * process's environment under this name.
 */
export const ENDPOINT_ENV_KEY = 'DSH_KIMI_ENDPOINT_KEY'

/**
 * One scope's endpoint credential. `baseUrl` is optional (absent = kimi's
 * own coding service); a non-empty `apiKey` is what makes the scope
 * authenticated.
 */
export interface KimiEndpointAuth {
  readonly baseUrl?: string
  /** Read by the CLI through the provider's `api_key_env` indirection. */
  readonly apiKey?: string
}

/** Trim and normalize one credential field; blank reads as absent. */
function field(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Whether a resolved endpoint carries a usable credential. */
export function hasEndpointCredential(auth: KimiEndpointAuth | undefined): auth is KimiEndpointAuth & { apiKey: string } {
  return auth !== undefined && field(auth.apiKey) !== undefined
}

/**
 * Read the scope's endpoint-auth.json. Absent or unreadable yields undefined
 * (the caller falls back to the plugin config); malformed JSON or a non-object
 * payload also yields undefined — a torn file must not fail a status read.
 * Non-string fields are dropped, never carried through.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the file's endpoint credential, or undefined.
 */
export async function readEndpointAuthFile(homeDir: string): Promise<KimiEndpointAuth | undefined> {
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
    return {
      ...baseUrl === undefined ? {} : { baseUrl },
      ...apiKey === undefined ? {} : { apiKey },
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve one scope's effective endpoint credential: the scope's
 * endpoint-auth.json merged FIELD BY FIELD over the plugin config's
 * `baseUrl` / `apiKey` (a file that names only a key rotates the key while
 * keeping the deployment's endpoint). The result may carry no credential at
 * all — {@link hasEndpointCredential} is the judgment, kept separate so the
 * caller can still route/log the resolved baseUrl.
 * @param homeDir - the scope's scoped home.
 * @param config - the plugin config's deployment-level endpoint pair.
 * @returns the merged endpoint auth.
 */
export async function resolveEndpointAuth(
  homeDir: string,
  config: KimiEndpointAuth,
): Promise<KimiEndpointAuth> {
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
 * The spawn-env layer for a resolved endpoint: the key under the managed
 * provider's `api_key_env` name, nothing else. A credential-less resolution
 * yields an empty layer — the spread then adds no keys at all, byte-identical
 * to the pre-endpoint env.
 * @param auth - the resolved endpoint auth, or undefined.
 * @returns the explicit env entries for the delegation spawn.
 */
export function endpointAuthEnv(auth: KimiEndpointAuth | undefined): NodeJS.ProcessEnv {
  const apiKey = field(auth?.apiKey)
  return apiKey === undefined ? {} : { [ENDPOINT_ENV_KEY]: apiKey }
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
 * Write the scope's endpoint-auth.json (mode 0600, mkdir -p first).
 * Whole-file write: the payload is exactly what {@link readEndpointAuthFile}
 * parses back.
 * @param homeDir - the scope's scoped home.
 * @param auth - the endpoint credential to persist.
 */
export async function writeEndpointAuth(homeDir: string, auth: KimiEndpointAuth): Promise<void> {
  await mkdir(homeDir, { recursive: true })
  const baseUrl = field(auth.baseUrl)
  const apiKey = field(auth.apiKey)
  const payload: Record<string, string> = {
    ...baseUrl === undefined ? {} : { baseUrl },
    ...apiKey === undefined ? {} : { apiKey },
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

/**
 * The managed provider's endpoint, written into a fresh scoped config and the
 * baseline the eval snapshot compares against: a scoped config still pointing
 * here routes through kimi's own service, i.e. no custom endpoint is in force.
 * It lives in THIS module (not provision.ts) because the endpoint check and
 * the model catalog need it without a cycle — provision.ts already imports
 * {@link ENDPOINT_ENV_KEY} from here.
 */
export const KIMI_MANAGED_BASE_URL = 'https://api.kimi.com/coding/v1'

/** How many served model ids the check reply lists before truncating. */
const CHECK_MODEL_LIST_LIMIT = 8

/** Bound on the error-body excerpt a failed check reports. */
const CHECK_ERROR_BODY_LIMIT = 200

/** The probe's fetch shape (injected in tests). */
export type EndpointCheckFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** One model the endpoint serves, from `GET <baseUrl>/v1/models`. */
export interface EndpointServedModel {
  readonly id: string
  readonly displayName?: string
  /** Reasoning effort levels the endpoint advertises for this model (`think_efforts.valid_efforts`). */
  readonly efforts?: readonly string[]
  /** The effort the endpoint applies when a round names none (`think_efforts.default_effort`). */
  readonly defaultEffort?: string
  /** The served context window (`context_length`). */
  readonly contextSize?: number
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

/**
 * `GET <baseUrl>/v1/models` with `Authorization: Bearer <key>` — the
 * token-free endpoint probe shared by the settings card's verify button
 * (`checkEndpoint`) and the model catalog. Kimi's own coding service answers
 * it with the managed key (verified 2026-10-22 against
 * `https://api.kimi.com/coding/v1`: 200 with Bearer — the sibling x-api-key
 * header also works, but Bearer is the one convention this package sends).
 * The reply carries kimi's own fields — `display_name`,
 * `think_efforts.valid_efforts`/`default_effort` (a sibling
 * `reasoning.effort.valid`/`default` carries the same data; `think_efforts`
 * is the field this reads), `context_length` — while a generic
 * OpenAI-shaped relay answers ids only, so every optional field tolerates
 * absence. Never throws: every failure mode folds into the result.
 * @param endpoint - the resolved endpoint auth (caller checks the credential).
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param signal - abort for the whole probe (timeout bundled by the caller).
 * @returns the folded result.
 */
export async function fetchEndpointModels(
  endpoint: KimiEndpointAuth & { readonly baseUrl: string },
  fetchImpl?: EndpointCheckFetch,
  signal?: AbortSignal,
): Promise<EndpointModelsResult> {
  const headers: Record<string, string> = {}
  if (endpoint.apiKey !== undefined) headers['authorization'] = `Bearer ${endpoint.apiKey}`
  const fetcher = fetchImpl ?? (globalThis.fetch as unknown as EndpointCheckFetch)
  // The managed base URL already ends in `/v1`; a relay base may omit it —
  // accept both instead of doubling the segment.
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
  const models: EndpointServedModel[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as {
      id?: unknown
      display_name?: unknown
      context_length?: unknown
      think_efforts?: { valid_efforts?: unknown; default_effort?: unknown }
    }
    if (typeof record.id !== 'string' || record.id === '') continue
    const thinkEfforts = typeof record.think_efforts === 'object' && record.think_efforts !== null ? record.think_efforts : undefined
    const efforts = thinkEfforts?.valid_efforts
    models.push({
      id: record.id,
      ...typeof record.display_name === 'string' && record.display_name !== '' ? { displayName: record.display_name } : {},
      ...Array.isArray(efforts) && efforts.some(effort => typeof effort === 'string' && effort !== '')
        ? { efforts: efforts.filter((effort): effort is string => typeof effort === 'string' && effort !== '') } : {},
      ...typeof thinkEfforts?.default_effort === 'string' && thinkEfforts.default_effort !== '' ? { defaultEffort: thinkEfforts.default_effort } : {},
      ...typeof record.context_length === 'number' && Number.isFinite(record.context_length) ? { contextSize: record.context_length } : {},
    })
  }
  return { kind: 'models', models }
}

/**
 * Probe the resolved endpoint with a cheap, token-free round-trip: `GET
 * <baseUrl>/v1/models` with the resolved credential's Bearer header. A 200
 * proves both reachability and credential validity — the exact evidence a
 * "verify" button needs — and the served model list rides the reply so the
 * user sees what the endpoint offers. One transport-level retry rides along:
 * a local proxy restart (a Surge/clash reload) stalls the first attempt into
 * the timeout and answers the retry immediately. Never throws: every failure
 * mode folds into the reply text, since the reply IS the diagnostic.
 * @param endpoint - the resolved endpoint auth (scope file over settings).
 * @param fetchImpl - the HTTP fetch; default the host's global fetch.
 * @param timeoutMs - one attempt's deadline (two attempts at most).
 * @returns the human-readable verdict for the check reply.
 */
export async function checkKimiEndpoint(
  endpoint: KimiEndpointAuth,
  fetchImpl?: EndpointCheckFetch,
  timeoutMs = 20_000,
): Promise<string> {
  if (!hasEndpointCredential(endpoint)) {
    return 'No endpoint credential configured — fill API Key on the settings card (or the profile row) first.'
  }
  const baseUrl = (endpoint.baseUrl ?? KIMI_MANAGED_BASE_URL).replace(/\/+$/, '')
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
  const ids = result.models.map(model => model.id)
  const listed = ids.slice(0, CHECK_MODEL_LIST_LIMIT).join(', ')
  const more = ids.length > CHECK_MODEL_LIST_LIMIT ? `, … +${String(ids.length - CHECK_MODEL_LIST_LIMIT)} more` : ''
  return `Endpoint reachable (${baseUrl}): ${String(ids.length)} model(s) served — ${listed}${more}`
}
