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

import { readFile, rm, writeFile } from 'node:fs/promises'
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
 * Sign out of the scoped account: remove the credential file, so `/<name>
 * status` reports not authenticated and the next login authorizes a fresh
 * account. With `cli_auth_credentials_store = "file"` the credentials live
 * solely in `auth.json`, so removing it is the logout path.
 * @param homeDir - the `codex` harness's scoped home.
 */
export async function codexLogout(homeDir: string): Promise<void> {
  await rm(join(homeDir, AUTH_FILE), { force: true })
}
