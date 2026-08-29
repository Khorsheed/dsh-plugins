/**
 * MCP connector backed by the official `@modelcontextprotocol/sdk` (the same
 * library `@deepseek-ai/dsh-mcp-client` uses). Kept as a thin, swappable seam:
 * the catalog owns the connection lifecycle (connect → list → register tools →
 * call → close) and registers discovered tools on `ctx.tools`. If upstream later
 * exposes a stable dynamic `connect(ctx, config)`, swap this adapter for it.
 *
 * v1 scope: stdio + streamable-http connect, paginated `tools/list`,
 * `tools/call` passthrough, and close. Reconnect/atomic-replace/tool-filter are
 * follow-ups.
 * @module @khorsheed/dsh-capability-catalog/mcpConnector
 */

// The SDK is a third-party host dep the gen-typert overlay cannot resolve
// (only @deepseek-ai/* + harness node_modules). @ts-ignore keeps generation
// green; at runtime the host resolves these from node_modules.
// @ts-ignore
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
// @ts-ignore
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
// @ts-ignore
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CatalogMcpServerConfig, CatalogMcpTool, CatalogJsonValue } from './types.ts'

/** One live MCP connection. */
export interface McpConnection {
  readonly tools: readonly CatalogMcpTool[]
  call: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
  close: () => Promise<void>
}

/** Resolve a secretRef marker to its stored value (the catalog's ctx.credentials). */
export type ResolveSecret = (ref: string) => Promise<string | undefined>

/** Build the transport for a config (secrets already resolved to plaintext). */
function makeTransport(config: CatalogMcpServerConfig): any {
  if (config.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const [k, v] of config.env ?? []) env[k] = v
    return new StdioClientTransport({
      command: config.command ?? 'npx',
      args: [...(config.args ?? [])],
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
    })
  }
  // streamable-http: the SDK transport takes headers via `requestInit` — without
  // them an auth-bearing server (e.g. `Authorization`, `x-api-key`) is never
  // authenticated. Plaintext header values arrive here after secret resolution.
  const headers = config.headers ?? []
  if (headers.length > 0) {
    return new StreamableHTTPClientTransport(new URL(config.url ?? ''), {
      requestInit: { headers: Object.fromEntries(headers) },
    })
  }
  return new StreamableHTTPClientTransport(new URL(config.url ?? ''))
}

/** Map an SDK tool to the catalog's tool row (enabled by default). */
function toCatalogTool(sdkTool: any): CatalogMcpTool {
  return {
    name: sdkTool.name,
    description: sdkTool.description ?? '',
    ...(sdkTool.inputSchema !== undefined ? { parameters: sdkTool.inputSchema as CatalogJsonValue } : {}),
    enabled: true,
  }
}

/** Connect, discover all tools (follow pagination), and return a live handle. */
export async function connectMcpServer(config: CatalogMcpServerConfig): Promise<McpConnection> {
  const client: any = new Client({ name: 'dsh-capability-catalog', version: '0.1.0' })
  const transport = makeTransport(config)
  await client.connect(transport)

  const tools: CatalogMcpTool[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor })
    for (const t of page.tools) tools.push(toCatalogTool(t))
    cursor = page.nextCursor
  } while (cursor !== undefined)

  return {
    tools,
    call: async (toolName, args) => client.callTool({ name: toolName, arguments: args }),
    close: async () => { await client.close().catch(() => {}) },
  }
}
