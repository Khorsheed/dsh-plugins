import { createHash } from 'node:crypto'
import type { CatalogMcpServerConfig } from './types.ts'

export type McpCredentialKind = 'env' | 'header' | 'query'

/** User configuration owned by the official manager, not a plugin registration. */
export interface OfficialMcpEntry {
  transport: 'stdio' | 'streamable-http'
  command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  cwd: string
  url: string
  readonly headers: Readonly<Record<string, string>>
  enabled: boolean
}

/** A credential reference accepted by the host provider, stable across restarts. */
export function officialCredentialRef(kind: McpCredentialKind, storedRef: string): string {
  const digest = createHash('sha256').update(storedRef).digest('hex').slice(0, 12)
  return `MCP_${kind.toUpperCase()}_${digest}`
}

/** Translate catalog secretRef markers without losing surrounding URL or auth text. */
function officialValue(value: string, kind: McpCredentialKind, serverName: string): string {
  return value.replace(/secretRef:([A-Za-z0-9_.-]+)/g, (_match, ref: string) => {
    return `\${credential:${officialCredentialRef(kind, `mcp.${serverName}.${kind}.${ref}`)}}`
  })
}

/** Map one catalog server to the flat entry accepted by mcp-manager. */
export function officialMcpEntry(config: CatalogMcpServerConfig): OfficialMcpEntry {
  const name = config.serverName
  const stdio = config.transport === 'stdio'
  return {
    transport: config.transport,
    command: stdio ? config.command ?? '' : '',
    args: stdio ? [...config.args ?? []] : [],
    env: stdio ? Object.fromEntries((config.env ?? []).map(([key, value]) => [key, officialValue(value, 'env', name)])) : {},
    cwd: stdio ? config.cwd ?? '' : '',
    url: stdio ? '' : (config.url ?? '').replace(/secretRef:([A-Za-z0-9_.-]+)/g, (_match, ref: string) => `\${credential:${officialCredentialRef('query', `mcp.${name}.query.${ref}`)}}`),
    headers: stdio ? {} : Object.fromEntries((config.headers ?? []).map(([key, value]) => [key, officialValue(value, 'header', name)])),
    enabled: config.enabled,
  }
}

/** Compare only fields the migration owns; the manager adds lifecycle defaults. */
export function sameOfficialEntry(actual: OfficialMcpEntry | undefined, expected: OfficialMcpEntry): boolean {
  if (actual === undefined) return false
  return actual.transport === expected.transport
    && actual.command === expected.command
    && actual.cwd === expected.cwd
    && actual.url === expected.url
    && actual.enabled === expected.enabled
    && JSON.stringify(actual.args) === JSON.stringify(expected.args)
    && JSON.stringify(actual.env) === JSON.stringify(expected.env)
    && JSON.stringify(actual.headers) === JSON.stringify(expected.headers)
}

/** Match the official rc.2 bridge, including its distinct long-name hash input. */
export function officialPublicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 51)}_${hash}`
}
