/**
 * Codex scoped-home provisioning: a working `config.toml` (a person may edit
 * it — custom providers, model, effort) plus the one-way sweep of the web
 * login's leftover `auth.json`. The harness is endpoint-key only: a stale
 * grant sitting next to an endpoint credential would keep authenticating the
 * built-in provider while the status reads "unauthenticated", so provisioning
 * deletes it on every boot (claude-code's OAuth-remnant sweep, same idea).
 * @module @khorsheed/dsh-local-agent-codex/provision
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Minimal scoped config: keep any hand-run login's credentials in the scoped home. */
const SCOPED_CONFIG = `# Written by dsh-local-agent-codex: keep the device-code
# credentials inside the scoped home (auth.json) instead of the OS keychain.
cli_auth_credentials_store = "file"
`

/** The web login's credential file, swept on every boot (endpoint-key only now). */
const LEGACY_AUTH_FILE = 'auth.json'

/**
 * Provision the scoped home: ensure a `config.toml` exists (a minimal one —
 * codex reads it for custom providers, model, and effort; the historical
 * `cli_auth_credentials_store = "file"` pin stays so a hand-run `codex login`
 * under the scoped home can never spill into the macOS keychain), and sweep
 * the web login's leftover `auth.json` (the harness no longer consults it —
 * endpoint key or nothing).
 * @param homeDir - the `codex` harness's scoped home.
 * @returns true when a config was written, false when one already existed.
 */
export async function provisionCodexConfig(homeDir: string): Promise<boolean> {
  // The sweep runs even when the config already exists: a leftover grant from
  // the web-login era must not keep working past the upgrade.
  await rm(join(homeDir, LEGACY_AUTH_FILE), { force: true })
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
 * Read the scoped config's effective reasoning effort: the top-level
 * `model_reasoning_effort` key (codex reads it for reasoning-capable models).
 * A missing or malformed config, or no key, yields undefined — the honest
 * "unknown", never a guessed default. Read-only: the config is authoritative
 * and a user-edited value is reported as-is. The provider passes no effort
 * override on the argv, so this IS the value every round runs with.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the configured effort, or undefined when none is set.
 */
export async function readCodexReasoningEffort(homeDir: string): Promise<string | undefined> {
  return readTopLevelConfigString(homeDir, 'model_reasoning_effort')
}

/**
 * Read the scoped config's configured model: the top-level `model` key — the
 * selection a plain `codex exec` round runs with. A missing or malformed
 * config, or no key, yields undefined — the honest "unknown", never a guessed
 * default. Read-only: the config is authoritative and a user-edited value is
 * reported as-is.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the configured model identifier, or undefined when none is set.
 */
export async function readCodexModel(homeDir: string): Promise<string | undefined> {
  return readTopLevelConfigString(homeDir, 'model')
}

/**
 * One top-level string key from the scoped config.toml: counts only before
 * the first table header — the same rule the model_provider scan applies.
 * Absent file or absent key yields undefined, never a guessed default.
 */
async function readTopLevelConfigString(homeDir: string, key: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    if (section !== '') continue
    const match = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line)
    if (match !== null && match[1] === key) return match[2]
  }
  return undefined
}

/**
 * Every model identifier the scoped config.toml itself names, deduped in file
 * order: the top-level `model` key plus each `[profiles.<name>]` table's own
 * `model` (a profile is how a codex config names a second model at all).
 * `[model_providers.*]` tables are deliberately NOT collected — their keys
 * name providers (endpoint definitions), not models, so offering one as a
 * model choice would be a wrong suggestion, not a discovered one. Absent file
 * or no model keys yields an empty list, never a hardcoded catalog entry.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the model identifiers the file carries.
 */
export async function listCodexConfigModels(homeDir: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return []
  }
  const found: string[] = []
  const seen = new Set<string>()
  const collect = (value: string | undefined): void => {
    if (value === undefined || value.trim() === '' || seen.has(value)) return
    seen.add(value)
    found.push(value)
  }
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    const match = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line)
    if (match === null || match[1] !== 'model') continue
    if (section === '' || section.startsWith('profiles.')) collect(match[2])
  }
  return found
}

