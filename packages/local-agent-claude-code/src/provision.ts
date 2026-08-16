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

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** The scoped config file holding the oauthAccount auth marker. */
const SCOPED_CONFIG = '.claude.json'

/**
 * Provision the scoped home directory. Claude creates it lazily on first
 * use, but creating it eagerly keeps the harness's homeDir contract uniform
 * with the other harnesses.
 * @param homeDir - the `claude-code` harness's scoped home.
 */
export async function provisionClaudeHome(homeDir: string): Promise<void> {
  await mkdir(homeDir, { recursive: true })
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
