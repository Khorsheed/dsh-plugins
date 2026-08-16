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

/** Minimal managed config for a fresh home with no user config to mirror. */
function minimalConfig(model: string): string {
  return `default_model = "${model}"

[thinking]
enabled = true
effort = "high"

[providers."managed:kimi-code"]
base_url = "https://api.kimi.com/coding/v1"
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
default_effort = "high"
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
 * written.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns true when a config was written, false when one already existed.
 */
export async function provisionKimiConfig(homeDir: string, model: string): Promise<boolean> {
  try {
    await readFile(join(homeDir, 'config.toml'))
    return false
  } catch (error) {
    // No config yet: fall through to provisioning.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let config = minimalConfig(model)
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
