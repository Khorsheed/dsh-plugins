/**
 * A Claude Code member's context occupancy, read off its stream-json events.
 *
 * Claude Code states no occupancy of its own: the closest reading is what
 * the LAST top-level request sent — its `input_tokens` plus the cached
 * prefix (`cache_read_input_tokens` + `cache_creation_input_tokens`), which
 * together are the whole prompt the model saw. A subagent's (Task) messages
 * carry `parent_tool_use_id` and their own context, so they never count.
 * The window comes from the `result` event's `modelUsage[model].contextWindow`
 * for the model that request ran on.
 * @module @khorsheed/dsh-local-agent-claude-code — context reading
 */

/** One round's occupancy, once the stream reported it. */
export interface ClaudeContextReading {
  readonly usedTokens: number
  readonly contextWindow?: number
}

type Json = Record<string, unknown>

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/** Folds one round's events into its last occupancy reading. */
export class ClaudeContextTracker {
  private used: number | undefined
  private model: string | undefined
  private window: number | undefined

  /** Feed one stream-json event (any type; only `assistant` and `result` count). */
  observe(event: Json): void {
    if (event['type'] === 'assistant') {
      // A subagent's message: its own context, not the member's.
      if (typeof event['parent_tool_use_id'] === 'string' && event['parent_tool_use_id'] !== '') return
      const message = event['message'] as Json | undefined
      const usage = message?.['usage'] as Json | undefined
      if (usage === undefined || typeof usage !== 'object' || usage === null) return
      const used = count(usage['input_tokens']) + count(usage['cache_read_input_tokens']) + count(usage['cache_creation_input_tokens'])
      if (used <= 0) return
      this.used = used
      if (typeof message?.['model'] === 'string' && message['model'] !== '') this.model = message['model']
      return
    }
    if (event['type'] !== 'result') return
    const models = event['modelUsage'] as Record<string, Json | undefined> | undefined
    if (models === undefined || typeof models !== 'object' || models === null) return
    // The request's own model; a single-model round falls back to its only
    // entry (the result keys by the canonical id, which can differ in suffix).
    const entry = (this.model === undefined ? undefined : models[this.model])
      ?? Object.entries(models).find(([id]) => this.model !== undefined && (id.startsWith(this.model) || this.model.startsWith(id)))?.[1]
      ?? (Object.keys(models).length === 1 ? Object.values(models)[0] : undefined)
    const window = count(entry?.['contextWindow'])
    if (window > 0) this.window = window
  }

  /** The round's reading; undefined when no top-level request reported usage. */
  reading(): ClaudeContextReading | undefined {
    if (this.used === undefined) return undefined
    return { usedTokens: this.used, ...this.window === undefined ? {} : { contextWindow: this.window } }
  }
}
