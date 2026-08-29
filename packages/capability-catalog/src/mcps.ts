/**
 * MCP server management: parse a pasted mcp.json snippet into a normalized
 * `CatalogMcpServerConfig`, keep the configured servers (this process — the
 * first version carries them in memory; persistence to the settings namespace
 * + credential store lands with the connection layer), and extract declared
 * credentials so the UI can ask for them once and never show the plaintext.
 *
 * The actual connection + tool discovery is a pluggable seam: `connect` is a
 * stub in v1 (tools list fills once we bind the dsh-mcp-client connection or
 * the catalog's own thin client).
 * @module @khorsheed/dsh-capability-catalog/mcps
 */

import type { CatalogJsonValue, CatalogMcpCredentialDecl, CatalogMcpServerConfig, CatalogMcpTool, McpTransport } from './types.ts'

/** Secret marker put in a config field whose value lives in the credential store. */
export const SECRET_REF_PREFIX = 'secretRef:'

/** Values that look like a credential to prompt for (env/header/query key). */
const CREDENTIALISH = /(KEY|TOKEN|SECRET|PASSWORD|API_KEY|ACCESS?_?KEY|AUTH)/i

/** Find every `secretRef:<token>` marker in a config value (scheme-prefixed or bare). */
const SECRET_REF_RE = /secretRef:([A-Za-z0-9_.-]+)/g

/** A parsed server from a pasted mcp.json server entry. */
export interface ParsedMcpServer {
  readonly serverName: string
  readonly config: CatalogMcpServerConfig
  /** Credential declarations to prompt for (label → config reference path). */
  readonly credentials: readonly { readonly ref: string; readonly label: string }[]
}

/** Detect transport from a raw server entry shape. */
export function detectTransport(entry: Record<string, unknown>): McpTransport {
  if (typeof entry['command'] === 'string') return 'stdio'
  return 'streamable-http'
}

/**
 * Parse one MCP server entry (a `mcpServers` value) into a normalized config,
 * extracting credential references. The pasted payload may be the whole
 * `mcpServers` object (we take a single entry — the Add-MCP flow is one server
 * per add) or a bare server entry.
 * @param serverName - the server key.
 * @param entry - the server's raw config value.
 */
export function parseServerEntry(serverName: string, entry: Record<string, unknown>): ParsedMcpServer {
  const transport = detectTransport(entry)
  const credentials: { ref: string; label: string }[] = []
  const env: [string, string][] = []
  const headers: [string, string][] = []

  const extract = (value: unknown, ref: string, label: string): string => {
    if (typeof value !== 'string' || value === '') return value as string ?? ''
    if (CREDENTIALISH.test(label)) {
      credentials.push({ ref, label })
      // Preserve a scheme prefix (Bearer/Basic/Token) so the header stays valid;
      // only the token is replaced by the secret marker.
      const scheme = /^(Bearer|Basic|Token)\s+/i.exec(value)
      return scheme !== null ? `${scheme[0]}${SECRET_REF_PREFIX}${ref}` : `${SECRET_REF_PREFIX}${ref}`
    }
    return value
  }

  if (transport === 'stdio') {
    const cmd = typeof entry['command'] === 'string' ? entry['command'] : undefined
    const args = Array.isArray(entry['args'])
      ? entry['args'].filter((a): a is string => typeof a === 'string')
      : undefined
    const cwd = typeof entry['cwd'] === 'string' ? entry['cwd'] : undefined
    const rawEnv = (entry['env'] ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(rawEnv)) env.push([k, extract(v, k, k)])
    return {
      serverName,
      config: { serverName, transport, ...(cmd !== undefined ? { command: cmd } : {}), ...(args !== undefined ? { args } : {}), ...(cwd !== undefined ? { cwd } : {}), ...(env.length > 0 ? { env } : {}), enabled: false },
      credentials,
    }
  }

  const url = typeof entry['url'] === 'string' ? entry['url'] : ''
  const rawHeaders = (entry['headers'] ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(rawHeaders)) headers.push([k, extract(v, k, k)])
  // Query-string secret (e.g. `?key=`). Keep a ref marker in the URL.
  return {
    serverName,
    config: { serverName, transport, url, ...(headers.length > 0 ? { headers } : {}), enabled: false },
    credentials,
  }
}

/** Flag a config field secret in the read-only display: `secretRef:x → ·secretRef·`,
 * preserving any scheme prefix (e.g. `Bearer ·secretRef·`). */
export function maskSecret(value: string): string {
  return value.replace(SECRET_REF_RE, '·secretRef·')
}

/** Mask a server config for the wire (the Remote DTO): replace every `secretRef:`
 * marker (bare or scheme-prefixed) with `·secretRef·`, so neither the secret key
 * name nor the marker is exposed to the browser. */
export function maskConfig(config: CatalogMcpServerConfig): CatalogMcpServerConfig {
  const env = (config.env ?? []).map(([k, v]) => [k, maskSecret(v)] as [string, string])
  const headers = (config.headers ?? []).map(([k, v]) => [k, maskSecret(v)] as [string, string])
  const url = config.url !== undefined ? maskSecret(config.url) : undefined
  return {
    ...config,
    ...(env.length > 0 ? { env } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(url !== undefined ? { url } : {}),
  }
}

/** Whether the config still has an unfilled credential (= prompts for it). */
export function hasUnconfiguredCredentials(credentials: readonly CatalogMcpCredentialDecl[]): boolean {
  return credentials.some(c => !c.configured)
}

/** Resolve `secretRef:` markers in a config into plaintext before connecting
 * (the catalog resolves via the stored credential values, then connects).
 * Replaces embedded markers too, so a scheme-prefixed value (`Bearer secretRef:a`)
 * resolves to `Bearer <value>`. */
export async function resolveConfigSecrets(
  config: CatalogMcpServerConfig,
  resolve: (ref: string) => Promise<string | undefined>,
): Promise<CatalogMcpServerConfig> {
  const resolveValue = async (value: string): Promise<string> => {
    let out = value
    for (const m of value.matchAll(SECRET_REF_RE)) {
      const ref = m[1] as string
      const resolvedValue = (await resolve(ref)) ?? ''
      out = out.replace(`secretRef:${ref}`, resolvedValue)
    }
    return out
  }
  const env: [string, string][] = []
  for (const [k, v] of config.env ?? []) env.push([k, await resolveValue(v)])
  const headers: [string, string][] = []
  for (const [k, v] of config.headers ?? []) headers.push([k, await resolveValue(v)])
  const url = config.url !== undefined ? await resolveValue(config.url) : undefined
  return {
    ...config,
    ...(env.length > 0 ? { env } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(url !== undefined ? { url } : {}),
  }
}

/** Sort tools by name and default each to enabled. */
export function finalizeTools(tools: readonly CatalogMcpTool[]): CatalogMcpTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Map each bare secret config key (env/header name, or a query param) to its
 * catalog-stored, namespaced credential ref (`mcp.<server>.<kind>.<key>`). The
 * host store namespaces refs by server so multiple servers with the same env
 * key don't collide. Mirrors the store's `credentialRefsOf` scan — the client
 * needs the same mapping to write values for a freshly-added server before the
 * next snapshot round-trips the namespaced refs.
 */
export function credentialStoredRefs(serverName: string, config: CatalogMcpServerConfig): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  const isSecret = (v: string): boolean => /secretRef:/.test(v)
  for (const [k, v] of config.env ?? []) {
    if (isSecret(v)) out[k] = `mcp.${serverName}.env.${k}`
  }
  for (const [k, v] of config.headers ?? []) {
    if (isSecret(v)) out[k] = `mcp.${serverName}.header.${k}`
  }
  if (config.url !== undefined) {
    for (const m of config.url.matchAll(/secretRef:([A-Za-z0-9_.-]+)/g)) {
      out[m[1] as string] = `mcp.${serverName}.query.${m[1] as string}`
    }
  }
  return out
}

export { SECRET_REF_PREFIX as _SECRET_REF_PREFIX } // re-export for tests if needed
export type { CatalogJsonValue }
