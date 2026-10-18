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
  return {
    ...config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl },
    ...config.apiKey === undefined ? {} : { apiKey: config.apiKey },
    ...config.authToken === undefined ? {} : { authToken: config.authToken },
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
