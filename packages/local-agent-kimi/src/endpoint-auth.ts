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
