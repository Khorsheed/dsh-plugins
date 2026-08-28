/**
 * Codex scoped-home provisioning: pin file-based credential storage so the
 * device-code login writes `auth.json` inside the scoped home. Codex's
 * `cli_auth_credentials_store` defaults to `auto` — on macOS that resolves
 * to the keychain, which would both leak credentials outside the scoped
 * home and defeat the `auth.json` presence check this package's records
 * adapter uses for authentication. An existing config is respected
 * untouched; sign-out removes the credential file.
 * @module @khorsheed/dsh-local-agent-codex/provision
 */

import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Credential file inside the scoped home; its presence marks auth. */
const AUTH_FILE = 'auth.json'

/** Minimal scoped config: keep credentials in the scoped home. */
const SCOPED_CONFIG = `# Written by dsh-local-agent-codex: keep the device-code
# credentials inside the scoped home (auth.json) instead of the OS keychain.
cli_auth_credentials_store = "file"
`

/**
 * Provision `<homeDir>/config.toml` unless one already exists. A present
 * config is respected untouched (a person may have edited it); otherwise a
 * minimal config pinning file-based credential storage is written so login
 * lands in the scoped home's `auth.json`.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns true when a config was written, false when one already existed.
 */
export async function provisionCodexConfig(homeDir: string): Promise<boolean> {
  try {
    await readFile(join(homeDir, 'config.toml'))
    return false
  } catch (error) {
    // No config yet: fall through to provisioning.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // `wx` refuses to overwrite a config that appeared since the read check.
  await writeFile(join(homeDir, 'config.toml'), SCOPED_CONFIG, { flag: 'wx' })
  return true
}

/**
 * Read the scoped config's effective custom endpoint: the base_url of the
 * `model_providers` entry named by `model_provider`, or the first custom
 * provider's base_url when no selection exists (a user manually editing the
 * config to route through a custom endpoint typically sets both). Only used
 * for diagnostics — the config is authoritative and a user-edited value is
 * respected untouched.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the configured custom base URL, or undefined when none is set.
 */
export async function readCodexBaseUrl(homeDir: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
  // Section-aware line scan: key order inside a provider table is the
  // writer's choice, so a base_url that does not immediately follow its
  // header must still be found — a diagnostic that silently reports the
  // default would mislead. model_provider is a top-level key, so it only
  // counts before the first table header.
  let section = ''
  let selected: string | undefined
  const providers = new Map<string, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    const key = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line)
    if (key === null) continue
    if (section === '' && key[1] === 'model_provider') selected = key[2]
    const provider = /^model_providers\.(".*"|[\w-]+)$/.exec(section)
    if (provider !== null && key[1] === 'base_url') {
      providers.set(provider[1]!.replace(/^"(.*)"$/, '$1'), key[2]!)
    }
  }
  if (selected !== undefined && providers.has(selected)) return providers.get(selected)
  // No selection: any single custom provider is the endpoint in effect.
  if (providers.size === 1) return [...providers.values()][0]
  return undefined
}

/**
 * The credential file's modification stamp (epoch ms), undefined when absent.
 * A completed device-code login rewrites `auth.json`, so the stamp
 * distinguishes a fresh login from a leftover (possibly revoked) credential.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the marker's mtime, or undefined when no credential exists.
 */
export async function codexCredentialStamp(homeDir: string): Promise<number | undefined> {
  try {
    return (await stat(join(homeDir, AUTH_FILE))).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * Sign out of the scoped account: remove the credential file, so `/<name>
 * status` reports not authenticated and the next login authorizes a fresh
 * account. With `cli_auth_credentials_store = "file"` the credentials live
 * solely in `auth.json`, so removing it is the logout path.
 * @param homeDir - the `codex` harness's scoped home.
 */
export async function codexLogout(homeDir: string): Promise<void> {
  await rm(join(homeDir, AUTH_FILE), { force: true })
}
