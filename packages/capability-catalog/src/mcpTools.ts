/**
 * MCP tool bridge: turns catalog-discovered MCP tools into harness `ToolDefinition`s
 * registered on `ctx.tools` so the model can call them. A bounded subset of the
 * official mcp-client bridge — the common text-result case (no image/attachment
 * projection, no task execution). Model-facing names follow the stable
 * `mcp__<serverName>__<rawName>` contract, normalized to the DeepSeek
 * function-name constraints; the raw name is only ever sent on the wire.
 *
 * Registration must always invoke `ctx.tools.register(definition)` as a MEMBER
 * call on the traceable service proxy (never extract `register` to a standalone
 * variable) — the proxy resolves `this.ctx` (effect/scope ownership) from the
 * calling context, which a bare function reference loses.
 * @module @khorsheed/dsh-capability-catalog/mcpTools
 */
import { createHash } from 'node:crypto'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CatalogJsonValue, CatalogMcpTool } from './types.ts'

/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Deterministic model-facing name for `(serverName, rawName)`. */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(joined).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** A tool-invocation forwarder (connects, resolves secrets, calls, closes). */
export type McpToolCallFn = (
  serverName: string,
  rawName: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/** Coerce a raw MCP inputSchema into a JSON Schema object the registry accepts. */
function sanitizeParameters(parameters: CatalogJsonValue | undefined): Record<string, unknown> {
  if (parameters !== null && typeof parameters === 'object' && !Array.isArray(parameters)) {
    return parameters as Record<string, unknown>
  }
  return { type: 'object', properties: {} }
}

/** The canonical MCP result shape the `render` maps to model text. */
interface McpCanonicalResult {
  readonly content: readonly unknown[]
  readonly structuredContent?: unknown
}

/** Map the SDK `callTool` result to the canonical `{ content, structuredContent }`. */
function normalizeResult(result: unknown): McpCanonicalResult {
  const r = (result ?? {}) as { content?: unknown; structuredContent?: unknown; isError?: boolean; error?: string }
  if (r.isError === true) throw new Error(r.error ?? 'MCP tool reported an error')
  return {
    content: Array.isArray(r.content) ? r.content : [],
    ...(r.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}),
  }
}

/** Extract human-readable text from MCP content blocks (text blocks joined). */
export function extractText(content: readonly unknown[] | undefined): string {
  const blocks = Array.isArray(content) ? content : []
  const texts = blocks
    .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text' && typeof (b as { text?: string }).text === 'string')
    .map((b) => b.text)
  return texts.length > 0 ? texts.join('\n') : JSON.stringify(blocks)
}

/** Build a harness `ToolDefinition` for one discovered MCP tool. */
export function mcpToolDefinition(opts: {
  publicName: string
  serverName: string
  rawName: string
  description: string
  parameters: CatalogJsonValue | undefined
  callTool: McpToolCallFn
}): ToolDefinition {
  const { publicName, rawName, serverName, description, parameters, callTool } = opts
  return {
    name: publicName,
    description,
    parameters: sanitizeParameters(parameters),
    output: {
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} } },
        required: ['content'],
        additionalProperties: true,
      },
      render: (_args, value) => {
        const result = value as unknown as McpCanonicalResult
        return [{ type: 'text', text: extractText(result.content) }]
      },
    },
    execute: async (args) => {
      const result = await callTool(serverName, rawName, (args ?? {}) as Record<string, unknown>)
      return normalizeResult(result)
    },
  }
}

/** One desired registration during reconcile. */
export interface DesiredMcpTool {
  readonly publicName: string
  readonly serverName: string
  readonly rawName: string
  readonly description: string
  readonly parameters: CatalogJsonValue | undefined
}

/**
 * The tools registry seam. IMPORTANT: `register` must be invoked as a MEMBER
 * call on `tools` (the traceable proxy) — never extracted to a standalone
 * variable — so `this.ctx` (effect/scope ownership) resolves correctly.
 */
export interface McpToolRegistry {
  register(definition: ToolDefinition): () => void
  onRegisterError?: (error: unknown) => void
}

/**
 * Reconcile registered MCP tools: dispose every previously-registered tool, then
 * register the desired set. Registration failures are contained per tool.
 */
export function reconcileRegisteredMcpTools(
  desired: readonly DesiredMcpTool[],
  registry: McpToolRegistry,
  current: Map<string, () => void>,
  callTool: McpToolCallFn,
): void {
  for (const dispose of [...current.values()]) dispose()
  current.clear()
  for (const d of desired) {
    try {
      const dispose = registry.register(mcpToolDefinition({
        publicName: d.publicName,
        serverName: d.serverName,
        rawName: d.rawName,
        description: d.description,
        parameters: d.parameters,
        callTool,
      }))
      current.set(d.publicName, dispose)
    } catch (error) {
      registry.onRegisterError?.(error)
    }
  }
}

/** Compute the desired set from enabled servers + their enabled tools. */
export function desiredMcpTools(
  servers: readonly { readonly serverName: string; readonly enabled: boolean }[],
  toolsByServer: Readonly<Record<string, readonly CatalogMcpTool[]>>,
): DesiredMcpTool[] {
  const desired: DesiredMcpTool[] = []
  for (const server of servers) {
    if (!server.enabled) continue
    for (const tool of toolsByServer[server.serverName] ?? []) {
      if (!tool.enabled) continue
      desired.push({
        publicName: publicToolName(server.serverName, tool.name),
        serverName: server.serverName,
        rawName: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })
    }
  }
  return desired
}
