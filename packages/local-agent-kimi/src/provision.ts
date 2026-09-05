/**
 * Kimi Code scoped-home provisioning: a working `config.toml` (provider and
 * model definitions) is required for the ACP server to authenticate. The
 * scoped home is provisioned once — from the user's own config, redacted —
 * so the scoped setup mirrors the user's models while carrying no secrets.
 * Sign-out removes the credentials and OAuth cache so a later login can
 * authorize a different account. The agent preset the delegation tool row
 * needs is bootstrapped into the user preset root on first boot, so
 * installing the bundle needs no manual copy step.
 * @module @khorsheed/dsh-local-agent-kimi/provision
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REAL_CONFIG = join(homedir(), '.kimi-code', 'config.toml')

/** Credentials directory inside the scoped home; its presence marks auth. */
const CREDENTIALS_DIR = 'credentials'

/** OAuth token cache directory inside the scoped home. */
const OAUTH_DIR = 'oauth'

/**
 * The managed provider's endpoint, written into a fresh scoped config and the
 * baseline the eval snapshot compares against: a scoped config still pointing
 * here routes through kimi's own service, i.e. no custom endpoint is in force.
 */
export const KIMI_MANAGED_BASE_URL = 'https://api.kimi.com/coding/v1'

/**
 * The reasoning effort a fresh scoped config gets when the plugin config does
 * not override it — the value the pre-config-item provisioning hardcoded, so
 * the default is behavior-preserving.
 */
export const DEFAULT_THINKING_EFFORT = 'high'

/** Minimal managed config for a fresh home with no user config to mirror. */
function minimalConfig(model: string, thinkingEffort: string): string {
  return `default_model = "${model}"

[thinking]
enabled = true
effort = "${thinkingEffort}"

[providers."managed:kimi-code"]
base_url = "${KIMI_MANAGED_BASE_URL}"
type = "kimi"
api_key = ""

[providers."managed:kimi-code".oauth]
storage = "file"
key = "oauth/kimi-code"

[models."${model}"]
provider = "managed:kimi-code"
model = "${model.split('/').pop()}"
max_context_size = 1048576
capabilities = [ "thinking", "always_thinking", "image_in", "video_in", "tool_use" ]
display_name = "${model}"
support_efforts = [ "low", "high", "max" ]
default_effort = "${thinkingEffort}"
`
}

/**
 * Redact every api_key value so the scoped copy carries no secrets. The
 * kimi-managed provider keeps an empty api_key (its auth routes through
 * oauth), which is exactly what an empty value means here.
 * @param config - the user's config text.
 * @returns the same config with all api_key values blanked.
 */
export function redactApiKeys(config: string): string {
  return config.replace(/api_key\s*=\s*"[^"]*"/gu, 'api_key = ""')
}

/**
 * Provision `<homeDir>/config.toml` unless one already exists. A present
 * config is respected untouched (a person may have edited it); otherwise the
 * user's own real config is copied redacted so the scoped home mirrors the
 * user's models; with no real config, a minimal kimi-managed config is
 * written. `thinkingEffort` feeds the minimal config's `[thinking] effort`
 * (and the model's `default_effort`) — it applies at provision time only,
 * never retroactively to an existing config.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param model - the kimi-managed model id for a fresh minimal config.
 * @param thinkingEffort - the reasoning effort a fresh minimal config pins.
 * @returns true when a config was written, false when one already existed.
 */
export async function provisionKimiConfig(homeDir: string, model: string, thinkingEffort: string): Promise<boolean> {
  try {
    await readFile(join(homeDir, 'config.toml'))
    return false
  } catch (error) {
    // No config yet: fall through to provisioning.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let config = minimalConfig(model, thinkingEffort)
  try {
    config = redactApiKeys(await readFile(REAL_CONFIG, 'utf8'))
  } catch (error) {
    // No user config to mirror; the minimal managed config stands.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // `wx` refuses to overwrite a config that appeared since the read check.
  await writeFile(join(homeDir, 'config.toml'), config, { flag: 'wx' })
  return true
}

/** The managed-service provider section provisioned into the scoped config. */
const MANAGED_PROVIDER_SECTION = 'providers."managed:kimi-code"'

/**
 * Read the scoped config's effective LLM endpoint: the
 * `[providers."managed:kimi-code"].base_url` key, if present. A missing or
 * malformed config yields undefined (the CLI falls back to its default
 * endpoint). Used only for diagnostics — the config itself is authoritative,
 * and a user-edited value is respected untouched.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the configured base URL, or undefined when absent/unreadable.
 */
export async function readKimiBaseUrl(homeDir: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
  // Section-aware line scan: key order inside the provider table is the
  // writer's choice, so base_url must be found wherever it sits in the
  // section — a diagnostic that silently reports the default would mislead.
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    if (section === MANAGED_PROVIDER_SECTION) {
      const match = /^base_url\s*=\s*"([^"]*)"$/.exec(line)
      if (match !== null) return match[1]
    }
  }
  return undefined
}

/**
 * Read the scoped config's configured default model: the top-level
 * `default_model` key — the selection a plain `kimi -p` round runs with. A
 * missing or malformed config, or no key, yields undefined — the honest
 * "unknown", never a guessed default. Read-only: the config is authoritative
 * and a user-edited value is reported as-is.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the configured model identifier, or undefined when none is set.
 */
export async function readKimiDefaultModel(homeDir: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
  // default_model is a top-level key, so it only counts before the first
  // table header — the same rule the other readers apply.
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    if (section !== '') continue
    const key = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line)
    if (key !== null && key[1] === 'default_model') return key[2]
  }
  return undefined
}

/**
 * Read the scoped config's effective reasoning effort: the `[thinking] effort`
 * key, falling back to a `[models."…"]` section's `default_effort` when the
 * thinking table carries none (the CLI resolves effort the same way). A
 * missing or malformed config, or no effort key anywhere, yields undefined —
 * the honest "unknown", never a guessed default. Read-only: the config is
 * authoritative, a user-edited value is reported as-is.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the effective effort, or undefined when it cannot be determined.
 */
export async function readKimiReasoningEffort(homeDir: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
  // Section-aware line scan (same shape as readKimiBaseUrl): effort must be
  // found wherever it sits in its section, and only the thinking table's own
  // effort counts before any model default does.
  let section = ''
  let thinkingEffort: string | undefined
  let modelDefaultEffort: string | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    const key = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line)
    if (key === null) continue
    if (section === 'thinking' && key[1] === 'effort' && thinkingEffort === undefined) thinkingEffort = key[2]
    if (section.startsWith('models.') && key[1] === 'default_effort' && modelDefaultEffort === undefined) {
      modelDefaultEffort = key[2]
    }
  }
  return thinkingEffort ?? modelDefaultEffort
}

/**
 * Whether the scoped config's permission rules auto-approve the subagent's
 * tool use: the `Bash(*)` allow rule the provisioning gate
 * ({@link ensureKimiPermissions}) keys on, detected with the exact same
 * substring so the snapshot and the provisioning can never disagree about
 * the same file.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns whether the auto-approve rule is present.
 */
export async function readKimiAutoApprove(homeDir: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return false
  }
  return text.includes('pattern = "Bash(*)')
}

/** Permission rule block letting the kimi subagent run shell commands. */
const KIMI_PERMISSION_BLOCK = `
[[permission.rules]]
decision = "allow"
pattern = "Bash(*)"
reason = "let the kimi subagent run shell commands"
`

/**
 * Ensure the scoped config allows the subagent's tool use. The one-shot
 * `kimi -p` child uses the config's permission rules, so without a rule it
 * answers without executing tools. Idempotent; an existing rule is respected.
 * @param homeDir - the `kimi` harness's scoped home.
 */
export async function ensureKimiPermissions(homeDir: string): Promise<void> {
  const file = join(homeDir, 'config.toml')
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch (error) {
    // No config yet; provisioning will write one with the rules when it runs.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (content.includes('pattern = "Bash(*)')) return
  await writeFile(file, `${content.trimEnd()}\n${KIMI_PERMISSION_BLOCK}`)
}

/**
 * Sign out of the scoped account: remove the credentials and OAuth token
 * cache, so `/<name> status` reports not authenticated and the next login
 * authorizes a fresh account. The kimi CLI has no `logout` command, so the
 * scoped files are the logout path.
 * @param homeDir - the `kimi` harness's scoped home.
 */
export async function kimiLogout(homeDir: string): Promise<void> {
  await Promise.all([
    rm(join(homeDir, CREDENTIALS_DIR), { recursive: true, force: true }),
    rm(join(homeDir, OAUTH_DIR), { recursive: true, force: true }),
  ])
}
