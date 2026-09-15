/**
 * Claude Code scoped-home provisioning. Unlike codex (whose credential store
 * must be pinned to a file) and kimi (which needs a provider config),
 * claude's `CLAUDE_CONFIG_DIR` scoped home needs nothing beyond the
 * directory itself: login via `claude auth login` writes `.claude.json`
 * (with the `oauthAccount` record) into it, and the real credential lands in
 * the macOS keychain under a hashed entry or — on Linux, despite upstream
 * bug #47661 — in the default `~/.claude/.credentials.json` while the config
 * stays scoped. Sign-out removes the scoped config so `status` reports not
 * authenticated; the keychain entry on macOS persists until the CLI removes
 * it, which the framework's file-based logout cannot reach.
 * @module @khorsheed/dsh-local-agent-claude-code/provision
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The scoped config file holding the oauthAccount auth marker. */
const SCOPED_CONFIG = '.claude.json'

/** The scoped settings file carrying the CLI's env block. */
const SCOPED_SETTINGS = 'settings.json'

/**
 * Provision the scoped home directory. Claude creates it lazily on first
 * use, but creating it eagerly keeps the harness's homeDir contract uniform
 * with the other harnesses. When `proxyUrl` is configured, the scoped
 * `settings.json` gains an env block pointing the CLI's own traffic at it —
 * claude reads proxy settings from this file, so the child works even when
 * the host process environment carries no proxy (a supervisor-spawned
 * instance's env is not the user's shell env). An existing settings file is
 * merged, not overwritten; only the two proxy keys are managed.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @param proxyUrl - optional HTTP proxy URL for the child CLI's traffic.
 */
export async function provisionClaudeHome(homeDir: string, proxyUrl?: string): Promise<void> {
  await mkdir(homeDir, { recursive: true })
  if (proxyUrl === undefined) return
  const path = join(homeDir, SCOPED_SETTINGS)
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    // Absent or malformed: start fresh (a malformed file is replaced, not merged).
  }
  const env = (settings.env ?? {}) as Record<string, string>
  if (env.https_proxy === proxyUrl && env.http_proxy === proxyUrl) return
  env.https_proxy = proxyUrl
  env.http_proxy = proxyUrl
  settings.env = env
  await writeFile(path, JSON.stringify(settings, undefined, 2) + '\n')
}

/**
 * Read the scoped settings' configured model: the `model` key of
 * `<homeDir>/settings.json` — the model a delegation round pins when the
 * scoped settings name one at all. Claude's own default model is decided by
 * the CLI and is deliberately NOT guessed here. Only the scoped file is
 * consulted (never the host's `~/.claude`); absent or malformed content
 * yields undefined.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the configured model identifier, or undefined when none is set.
 */
export async function readClaudeConfiguredModel(homeDir: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(homeDir, SCOPED_SETTINGS), 'utf8')
  } catch {
    return undefined
  }
  try {
    const settings = JSON.parse(text) as { model?: unknown }
    return typeof settings.model === 'string' && settings.model !== '' ? settings.model : undefined
  } catch {
    return undefined
  }
}

/** Read the scoped native effort setting without changing the settings file. */
export async function readClaudeConfiguredEffort(homeDir: string): Promise<string | undefined> {
  try {
    const settings = JSON.parse(await readFile(join(homeDir, SCOPED_SETTINGS), 'utf8')) as { effortLevel?: unknown }
    return typeof settings.effortLevel === 'string' && settings.effortLevel.trim() !== '' ? settings.effortLevel.trim() : undefined
  } catch { return undefined }
}

/**
 * Write (or, with undefined, remove) the scoped settings.json `model` key,
 * merging the rest of the file exactly as {@link provisionClaudeHome} merges
 * its env block. Only the live driver calls this: a resident runtime needs
 * its member's effective model IN THE FILE, because a `--resume` respawn
 * restores the session's own stored model over the `--model` flag. The exec
 * path never calls it — its `--model` flag always applies, and the file
 * stays exactly as the person edited it.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @param model - the model to scratch in, or undefined to remove the key.
 */
export async function writeClaudeScopedModel(homeDir: string, model: string | undefined): Promise<void> {
  const path = join(homeDir, SCOPED_SETTINGS)
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    // Absent or malformed: start fresh (a malformed file is replaced, not merged).
  }
  if (model === undefined) {
    if (!('model' in settings)) return
    delete settings['model']
  } else {
    if (settings['model'] === model) return
    settings['model'] = model
  }
  await writeFile(path, JSON.stringify(settings, undefined, 2) + '\n')
}

/**
 * Sign out of the scoped account: remove the scoped config file, so
 * `/<name> status` reports not authenticated and the next login authorizes
 * a fresh account. The macOS keychain entry (a hashed
 * `Claude Code-credentials-<sha256(path)[:8]>` record keyed to the scoped
 * home path) is NOT removed — the CLI's `claude auth logout` owns that, and
 * the harness logout contract is file-based; the stale entry is harmless
 * because a fresh login rewrites the same hashed slot.
 * @param homeDir - the `claude-code` harness's scoped home.
 */
export async function claudeLogout(homeDir: string): Promise<void> {
  await rm(join(homeDir, SCOPED_CONFIG), { force: true })
}
