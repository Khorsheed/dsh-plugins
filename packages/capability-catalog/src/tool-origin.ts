/**
 * Community tool-origin convention: a host-side tag a plugin attaches to a tool
 * definition BEFORE `ctx.tools.register`, so the catalog can attribute the tool
 * to `plugin` (and any channel) instead of relying on heuristics.
 *
 * The harness `ToolSchema` carries no source/owner field and the system-prompt
 * assembly projects tools to `{ name, description, parameters }`, so the tag must
 * live on the retained `ToolDefinition` and be read via `ctx.tools.get(name)`
 * (the registry keeps the definition by reference, so the symbol survives).
 * The key is `Symbol.for('dsh.tool.origin')` (global symbol registry) — a plugin
 * may tag without importing anything, using `def[Symbol.for('dsh.tool.origin')]`.
 * `setToolOrigin` is the convenience form exported for the catalog's own plugins.
 * @module @khorsheed/dsh-capability-catalog/tool-origin
 */

/** The global origin-tag key. `Symbol.for` returns the same symbol everywhere. */
export const TOOL_ORIGIN = Symbol.for('dsh.tool.origin')

/** The origin a tool author declares: which channel it belongs to (often 'plugin'). */
export interface ToolOrigin {
  readonly channel: 'plugin' | 'builtin' | 'mcp'
  /** The declaring package/module, e.g. '@khorsheed/dsh-my-plugin'. */
  readonly owner?: string
}

/** Convenience: attach an origin tag to a tool definition (before `register`). */
export function setToolOrigin<T extends object>(definition: T, origin: ToolOrigin): T {
  ;(definition as { [TOOL_ORIGIN]?: ToolOrigin })[TOOL_ORIGIN] = origin
  return definition
}

/** Read the origin tag off a tool definition (host-side; never on the model wire). */
export function toolOrigin(definition: object): ToolOrigin | undefined {
  return (definition as { [TOOL_ORIGIN]?: ToolOrigin })[TOOL_ORIGIN]
}
