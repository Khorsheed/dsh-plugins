/**
 * Kimi Code scoped-home provisioning: a working `config.toml` (provider and
 * model definitions) is required for the ACP server to run. The scoped home
 * is provisioned once — from the user's own config, redacted — so the scoped
 * setup mirrors the user's models while carrying no secrets. Authentication
 * is endpoint-key only (endpoint-auth.ts): the managed provider declares
 * `api_key_env = "DSH_KIMI_ENDPOINT_KEY"` and the key rides the child
 * process's environment, so `config.toml` itself never holds a secret.
 * Provisioning also sweeps the OAuth era's leftovers (`credentials/`,
 * `oauth/`) and migrates an existing managed-provider section onto the
 * env-key shape. The agent preset the delegation tool row needs is
 * bootstrapped into the user preset root on first boot, so installing the
 * bundle needs no manual copy step.
 * @module @khorsheed/dsh-local-agent-kimi/provision
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ENDPOINT_ENV_KEY } from './endpoint-auth.ts'

const REAL_CONFIG = join(homedir(), '.kimi-code', 'config.toml')

/** Credentials directory inside the scoped home — the OAuth era's grant. */
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
api_key_env = "${ENDPOINT_ENV_KEY}"

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
 * kimi-managed provider's key comes from the `api_key_env` indirection (the
 * endpoint credential), which is exactly what an empty value means here.
 * @param config - the user's config text.
 * @returns the same config with all api_key values blanked.
 */
export function redactApiKeys(config: string): string {
  return config.replace(/api_key\s*=\s*"[^"]*"/gu, 'api_key = ""')
}

/** The managed provider's section header (the colon forces the quoted form). */
const MANAGED_PROVIDER_HEADER = '[providers."managed:kimi-code"]'

/** The OAuth sub-table the endpoint-key shape drops. */
const MANAGED_OAUTH_HEADER = '[providers."managed:kimi-code".oauth]'

/**
 * Migrate the managed provider section of a config.toml onto the endpoint-key
 * shape, as a pure text transform:
 *
 * - the section's `api_key = "…"` line (any value — a mirrored config is
 *   already redacted, and a live one must not keep a secret in a hashed
 *   file) is replaced by `api_key_env = "<ENDPOINT_ENV_KEY>"`;
 * - the `[providers."managed:kimi-code".oauth]` sub-table is dropped (the
 *   OAuth flow is gone);
 * - when `baseUrl` is given, the section's `base_url` is set to it (the
 *   endpoint credential owns the managed provider's endpoint; a hand-edit
 *   is re-pointed at the next surgery).
 *
 * Other sections — user-added providers, model tables, permission rules —
 * are byte-preserved. A config without the managed provider section is
 * returned unchanged (a hand-built config's own providers are the user's
 * business). Idempotent: an in-sync input comes back byte-identical, so the
 * caller writes only on drift.
 * @param config - the config.toml text.
 * @param baseUrl - the endpoint to pin, or undefined to keep the file's own.
 * @returns the migrated config text.
 */
export function migrateManagedProviderConfig(config: string, baseUrl?: string): string {
  const lines = config.split('\n')
  const start = lines.findIndex(line => line.trim() === MANAGED_PROVIDER_HEADER)
  if (start === -1) return config
  // The provider section runs until the next table header — and the oauth
  // sub-table IS a header, so the body ends exactly there when it exists.
  // `end` (the tail's start) then extends PAST the sub-table, dropping it.
  let bodyEnd = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index]!)) { bodyEnd = index; break }
  }
  let end = bodyEnd
  if (lines[bodyEnd]?.trim() === MANAGED_OAUTH_HEADER) {
    end = lines.length
    for (let index = bodyEnd + 1; index < lines.length; index += 1) {
      if (/^\s*\[/.test(lines[index]!)) { end = index; break }
    }
  }
  const section = lines.slice(start + 1, bodyEnd)
  const tail = lines.slice(end)
  const out: string[] = []
  let sawEnvKey = false
  let sawBaseUrl = false
  for (const raw of section) {
    const trimmed = raw.trim()
    if (/^api_key\s*=/.test(trimmed)) continue
    if (/^api_key_env\s*=/.test(trimmed)) {
      if (sawEnvKey) continue
      sawEnvKey = true
      out.push(`api_key_env = "${ENDPOINT_ENV_KEY}"`)
      continue
    }
    if (baseUrl !== undefined && /^base_url\s*=/.test(trimmed)) {
      if (sawBaseUrl) continue
      sawBaseUrl = true
      out.push(`base_url = "${baseUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      continue
    }
    out.push(raw)
  }
  if (!sawEnvKey) out.push(`api_key_env = "${ENDPOINT_ENV_KEY}"`)
  if (baseUrl !== undefined && !sawBaseUrl) {
    out.unshift(`base_url = "${baseUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  }
  return [...lines.slice(0, start + 1), ...out, ...tail].join('\n')
}

/**
 * Ensure the scoped config's managed provider runs on the endpoint-key
 * shape (see {@link migrateManagedProviderConfig}); writes only on drift.
 * Called at provision, at boot, on the card's credential save, and before
 * each spawn — the last makes a hand-edited endpoint-auth.json's baseUrl
 * land without a restart.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param baseUrl - the resolved endpoint's baseUrl, when one is configured.
 * @returns true when the config was rewritten, false when already in sync
 *   (or absent — provisioning owns creation).
 */
export async function ensureKimiEndpointProvider(homeDir: string, baseUrl?: string): Promise<boolean> {
  const file = join(homeDir, 'config.toml')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return false
  }
  const migrated = migrateManagedProviderConfig(text, baseUrl)
  if (migrated === text) return false
  await writeFile(file, migrated, 'utf8')
  return true
}

/**
 * Sweep the OAuth era's leftovers (the credentials directory and the oauth
 * token cache). The harness no longer reads either; a leftover grant would
 * keep authenticating nothing (the managed provider no longer declares an
 * oauth section), and removing them keeps the scoped home honest about its
 * only credential being the endpoint key. Idempotent.
 * @param homeDir - the `kimi` harness's scoped home.
 */
export async function sweepKimiOauthLeftovers(homeDir: string): Promise<void> {
  await Promise.all([
    rm(join(homeDir, CREDENTIALS_DIR), { recursive: true, force: true }),
    rm(join(homeDir, OAUTH_DIR), { recursive: true, force: true }),
  ])
}

/**
 * Provision `<homeDir>/config.toml` unless one already exists, and always
 * sweep the OAuth era's leftovers. A present config is migrated onto the
 * endpoint-key shape (managed provider onto `api_key_env`, oauth sub-table
 * dropped) but otherwise respected; otherwise the user's own real config is
 * copied redacted AND migrated, so the scoped home mirrors the user's models
 * while carrying no secrets; with no real config, a minimal kimi-managed
 * config is written. `thinkingEffort` feeds the minimal config's
 * `[thinking] effort` (and the model's `default_effort`) — it applies at
 * provision time only, never retroactively to an existing config.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param model - the kimi-managed model id for a fresh minimal config.
 * @param thinkingEffort - the reasoning effort a fresh minimal config pins.
 * @param baseUrl - the deployment endpoint to pin on the managed provider,
 *   when the plugin config names one (the scope file's own baseUrl lands via
 *   the card save / the per-spawn surgery).
 * @returns true when a config was written, false when one already existed.
 */
export async function provisionKimiConfig(homeDir: string, model: string, thinkingEffort: string, baseUrl?: string): Promise<boolean> {
  // The sweep runs on every provision, existing config or not: the OAuth
  // grant and token cache are dead weight the harness no longer reads.
  await sweepKimiOauthLeftovers(homeDir)
  let existed = true
  try {
    await readFile(join(homeDir, 'config.toml'))
  } catch (error) {
    // No config yet: fall through to provisioning.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    existed = false
  }
  if (existed) {
    await ensureKimiEndpointProvider(homeDir, baseUrl)
    return false
  }
  let config = minimalConfig(model, thinkingEffort)
  try {
    config = migrateManagedProviderConfig(redactApiKeys(await readFile(REAL_CONFIG, 'utf8')), baseUrl)
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
 * List the model identifiers the scoped config DEFINES: every
 * `[models."…"]` table key (bare `[models.x]` keys included). This is the
 * pickable vocabulary a model surface can offer without hardcoding a catalog —
 * the same table `-m` resolves against. A missing or malformed config yields
 * an empty list. Read-only: the config is authoritative.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the defined model identifiers, in file order, deduplicated.
 */
export async function listKimiConfigModels(homeDir: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(join(homeDir, 'config.toml'), 'utf8')
  } catch {
    return []
  }
  const models: string[] = []
  for (const rawLine of text.split('\n')) {
    const header = /^\[+([^\]]+)\]+$/.exec(rawLine.trim())
    if (header === null) continue
    const table = /^models\.(?:"([^"]+)"|([\w-]+))$/.exec(header[1]!)
    const name = table?.[1] ?? table?.[2]
    if (name !== undefined && name !== '' && !models.includes(name)) models.push(name)
  }
  return models
}

/**
 * Rewrite the scoped config's top-level `default_model` to `model`, so the
 * NEXT process started under this home runs that model. This is the resident
 * path's only lever: `kimi acp` takes no model flag (verified against kimi
 * 0.39.1), while `kimi -p` takes `-m` — so the one-shot rounds pass the flag
 * and the live driver writes the file before spawning its runtime.
 *
 * The write is surgical: the first top-level `default_model` assignment is
 * replaced in place and everything else — model tables, providers, thinking
 * effort, comments, key order — is left byte-identical. A config with no
 * top-level `default_model` gains one as its first line; an absent or
 * unreadable config is left alone (provisioning owns creation, and inventing
 * a config here would hide a broken home).
 * @param homeDir - the `kimi` harness's scoped home.
 * @param model - the model identifier to pin as the default.
 * @returns true when the file now names `model`, false when there was no
 *   config to write into.
 */
export async function writeKimiDefaultModel(homeDir: string, model: string): Promise<boolean> {
  const path = join(homeDir, 'config.toml')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return false
  }
  // TOML basic strings take backslash escapes; a model id with a quote or a
  // backslash would otherwise produce a config kimi cannot parse.
  const assignment = `default_model = "${model.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`
  const lines = text.split('\n')
  let section = ''
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    const header = /^\[+([^\]]+)\]+$/.exec(line)
    if (header !== null) {
      section = header[1]!
      continue
    }
    // Top-level only, exactly as readKimiDefaultModel scans for it.
    if (section !== '') continue
    const key = /^(\w+)\s*=/.exec(line)
    if (key === null || key[1] !== 'default_model') continue
    if (line === assignment) return true
    lines[index] = assignment
    await writeFile(path, lines.join('\n'), 'utf8')
    return true
  }
  await writeFile(path, `${assignment}\n${text}`, 'utf8')
  return true
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
