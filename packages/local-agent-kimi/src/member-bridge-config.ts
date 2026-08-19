/**
 * Kimi scoped-home MCP config injection for the member bridge. Kimi declares
 * stdio MCP servers in `$KIMI_CODE_HOME/mcp.json` (`mcpServers` map); the file
 * is read once per CLI session start, and edits never interrupt an open
 * session — so the family writes one entry PER RUN (keyed by the run's token
 * suffix, keeping concurrent delegations of the same scoped home race-free),
 * prunes it when the run settles, and drops stale family entries (crashed
 * host) on every write. User-declared servers are preserved verbatim.
 * @module @khorsheed/dsh-local-agent-kimi/member-bridge-config
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Kimi's user-level MCP config filename inside the scoped home. */
const MCP_CONFIG_FILENAME = 'mcp.json'

/** Server-key prefix marking the family's per-run bridge entries. */
export const MEMBER_BRIDGE_SERVER_PREFIX = 'dsh-member-'

/**
 * The per-run MCP server key. The run's token suffix keeps concurrent runs
 * distinct; each `kimi -p` round is a fresh CLI session, so per-run (rather
 * than per-member) naming costs nothing.
 * @param token - the run's member-channel token.
 * @returns the mcp.json server key.
 */
export function memberBridgeServerKey(token: string): string {
  return `${MEMBER_BRIDGE_SERVER_PREFIX}${token.slice(0, 8)}`
}

interface McpConfig {
  mcpServers?: Record<string, unknown>
}

/** Read the scoped mcp.json; a missing or malformed file reads as empty. */
function readMcpConfig(file: string): McpConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as McpConfig
}

/** Write the config back, preserving every non-family key. */
function writeMcpConfig(file: string, config: McpConfig): void {
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Declare the member bridge for one run: set the per-run server entry and
 * prune other family entries (settled or crashed runs — an open session's
 * already-registered server is unaffected, per kimi's mid-session semantics).
 * Synchronous read-modify-write: single-process callers race-free by event
 * loop; the file is small and written once per run.
 * @param homeDir - the kimi scoped home.
 * @param key - this run's server key ({@link memberBridgeServerKey}).
 * @param command - the bridge spawn command (`node` + entry path).
 * @param env - the bridge environment (socket path + per-run token).
 */
export function injectMemberBridge(
  homeDir: string,
  key: string,
  command: { command: string; args: string[] },
  env: Record<string, string>,
): void {
  const file = join(homeDir, MCP_CONFIG_FILENAME)
  const config = readMcpConfig(file)
  const servers = { ...(config.mcpServers ?? {}) }
  for (const name of Object.keys(servers)) {
    if (name.startsWith(MEMBER_BRIDGE_SERVER_PREFIX) && name !== key) delete servers[name]
  }
  servers[key] = { command: command.command, args: command.args, env }
  writeMcpConfig(file, { ...config, mcpServers: servers })
}

/**
 * Remove one run's bridge entry (settle path). Absent entries and a missing
 * config are no-ops.
 * @param homeDir - the kimi scoped home.
 * @param key - the run's server key.
 */
export function removeMemberBridge(homeDir: string, key: string): void {
  const file = join(homeDir, MCP_CONFIG_FILENAME)
  const config = readMcpConfig(file)
  if (config.mcpServers === undefined || !(key in config.mcpServers)) return
  const servers = { ...config.mcpServers }
  delete servers[key]
  writeMcpConfig(file, { ...config, mcpServers: servers })
}
