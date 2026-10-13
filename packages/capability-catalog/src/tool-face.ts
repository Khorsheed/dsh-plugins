/**
 * Reading the tools side of the capability face: the visible schemas in a
 * scope, the author-declared origin tags behind them, and the MCP server
 * names the `mcp__` prefixes imply.
 *
 * Extracted from the service so the Remote verbs and the pure-data evidence
 * producer (`evidence.ts`) read the tools registry through ONE
 * implementation — the digest parity between them is by construction, not by
 * two copies agreeing today. Nothing here catches a `schemas()` failure:
 * whether a failed read rejects the call (the Remote verbs' choice) or is
 * recorded as an unavailable section (the evidence producer's choice) is the
 * caller's policy.
 * @module @khorsheed/dsh-capability-catalog/tool-face
 */

import { MCP_TOOL_PREFIX } from './channels.ts'
import { toolOrigin, isValidOrigin, type ToolOrigin } from './tool-origin.ts'
import type { CatalogJsonValue } from './types.ts'

/** The slice of the tools registry the catalog reads (optional). */
export interface CatalogToolsSlice {
  schemas: (scope?: unknown) => readonly ToolSchemaLike[]
  get?: (name: string, scope?: unknown) => object | undefined
}

/** Minimal ToolSchema shape (model-facing name/description/parameters). */
export interface ToolSchemaLike {
  readonly name: string
  readonly description?: string
  readonly parameters?: CatalogJsonValue
}

/** The tools side of one reading position, collected once. */
export interface ToolFaceCollection {
  /** The visible tool schemas in the scope (the set the model sees). */
  readonly schemas: readonly ToolSchemaLike[]
  /** tool name → author-declared origin, where the tag could be read and validated. */
  readonly origins: ReadonlyMap<string, ToolOrigin>
  /** MCP server names derived from the `mcp__`-prefixed visible tools. */
  readonly mcpServerNames: readonly string[]
  /**
   * Visible tools whose origin tag could not be read (`get` absent from the
   * slice, returned undefined, or carried an invalid tag) and which therefore
   * fall back to heuristic channel attribution. Tool NAMES only — never error
   * text, which may carry paths.
   */
  readonly untaggedOrigins: readonly string[]
}

/**
 * The visible tool schemas in a scope, or the global layer when no scope is
 * given; an empty list when the registry is absent.
 */
export function toolSchemasFacing(tools: CatalogToolsSlice | undefined, scope: unknown): readonly ToolSchemaLike[] {
  if (tools?.schemas === undefined) return []
  return scope === undefined ? tools.schemas() : tools.schemas(scope)
}

/**
 * The origin tags behind the given schemas, read via `tools.get(name)` so the
 * `Symbol.for('dsh.tool.origin')` tag on the retained definition survives
 * (the system-prompt assembly strips it, but `get()` returns the full
 * definition). A schema the registry cannot hand back contributes no tag —
 * the tool falls back to heuristics and is named in `untaggedOrigins`.
 */
export function toolOriginsFacing(
  tools: CatalogToolsSlice | undefined,
  schemas: readonly ToolSchemaLike[],
  scope: unknown,
  warn: (message: string) => void,
): { readonly origins: ReadonlyMap<string, ToolOrigin>; readonly untaggedOrigins: readonly string[] } {
  const out = new Map<string, ToolOrigin>()
  const untagged: string[] = []
  if (tools?.get === undefined) return { origins: out, untaggedOrigins: untagged }
  for (const schema of schemas) {
    const def = scope === undefined ? tools.get(schema.name) : tools.get(schema.name, scope)
    if (def === undefined) {
      // `schemas()` and `get()` disagree for this scope — the author's origin
      // tag (if any) cannot be read, so the tool falls back to heuristics.
      warn(`capability-catalog: tool "${schema.name}" is visible but ctx.tools.get() is undefined in this scope — its origin tag cannot be read; it will be classified by heuristics`)
      untagged.push(schema.name)
      continue
    }
    const origin = toolOrigin(def)
    if (origin !== undefined) {
      if (!isValidOrigin(origin)) {
        warn(`capability-catalog: tool "${schema.name}" origin channel "${String(origin.channel)}" is not a known channel (plugin/builtin/mcp) — ignoring the tag, falling back to heuristics`)
        untagged.push(schema.name)
        continue
      }
      out.set(schema.name, origin)
    }
  }
  return { origins: out, untaggedOrigins: untagged }
}

/** MCP server names from live `mcp__`-prefixed tools (prefix-derived baseline). */
export function mcpServerNamesFacing(schemas: readonly ToolSchemaLike[]): readonly string[] {
  const names: string[] = []
  for (const schema of schemas) {
    if (!schema.name.startsWith(MCP_TOOL_PREFIX)) continue
    const rest = schema.name.slice(MCP_TOOL_PREFIX.length)
    const sep = rest.indexOf('__')
    const server = sep > 0 ? rest.slice(0, sep) : rest
    if (server.length > 0 && !names.includes(server)) names.push(server)
  }
  return names
}

/**
 * Collect the whole tools side of one reading position with ONE `schemas()`
 * call, so the rows, the origin tags and the MCP names cannot disagree about
 * which registry state they read.
 */
export function collectToolFace(
  tools: CatalogToolsSlice | undefined,
  scope: unknown,
  warn: (message: string) => void,
): ToolFaceCollection {
  const schemas = toolSchemasFacing(tools, scope)
  const { origins, untaggedOrigins } = toolOriginsFacing(tools, schemas, scope, warn)
  return { schemas, origins, mcpServerNames: mcpServerNamesFacing(schemas), untaggedOrigins }
}
