/**
 * The claude round's tool-call accounting: counted in the same `tool_use`
 * branch the transcript fold already walks, keyed by the block's own `name`
 * (claude's vocabulary verbatim, MCP names included), counted ahead of the
 * TodoWrite intercept, and absent — never zero — when the stream made none.
 */
import { describe, expect, it } from 'vitest'
import { parseClaudeStreamJson, toolCallsOf } from '../src/claude-cli-provider.ts'

/** A stream-json stream from the given events. */
function stream(...events: unknown[]): string {
  return events.map(event => JSON.stringify(event)).join('\n')
}

const use = (id: string, name: string, input: unknown = { command: 'ls' }): unknown => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
})

describe('claude tool-call accounting', () => {
  it('tallies each tool under the name claude gave it', () => {
    const parsed = parseClaudeStreamJson(stream(
      { type: 'system', subtype: 'init', session_id: 's1' },
      use('t1', 'Bash'),
      use('t2', 'Read', { path: '/tmp/a' }),
      use('t3', 'Bash'),
      { type: 'assistant', message: { content: [{ type: 'text', text: '好了' }] } },
      { type: 'result', is_error: false, session_id: 's1' },
    ))
    expect(parsed.toolCalls).toEqual({ count: 3, byName: { Bash: 2, Read: 1 } })
  })

  it('keeps an MCP tool\'s full name — no normalization across harnesses', () => {
    const parsed = parseClaudeStreamJson(stream(use('t1', 'mcp__member__member_message', { text: 'hi' })))
    expect(parsed.toolCalls).toEqual({ count: 1, byName: { mcp__member__member_message: 1 } })
  })

  it('counts TodoWrite even though the fold diverts it out of the transcript', () => {
    const parsed = parseClaudeStreamJson(stream(
      use('t1', 'TodoWrite', { todos: [{ content: '做事', status: 'pending', activeForm: '做事中' }] }),
      use('t2', 'Bash'),
    ))
    // The TodoWrite block becomes a todo snapshot, not a transcript line…
    expect(parsed.todos).toHaveLength(1)
    expect(parsed.lines.filter(line => line.kind === 'tool')).toHaveLength(1)
    // …but the CLI still called it, so the accounting keeps both.
    expect(parsed.toolCalls).toEqual({ count: 2, byName: { TodoWrite: 1, Bash: 1 } })
  })

  it('reports no accounting at all when the stream made no tool call', () => {
    const parsed = parseClaudeStreamJson(stream(
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '好了' }] } },
      { type: 'result', is_error: false, session_id: 's1' },
    ))
    expect(parsed.toolCalls).toBeUndefined()
  })

  it('a tool_use with no usable name still counts, under the fold\'s own fallback', () => {
    const parsed = parseClaudeStreamJson(stream({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', input: {} }] },
    }))
    expect(parsed.toolCalls).toEqual({ count: 1, byName: { tool: 1 } })
  })

  it('the counter fold: an empty tally is undefined, a filled one sums', () => {
    expect(toolCallsOf(new Map())).toBeUndefined()
    expect(toolCallsOf(new Map([['Bash', 2]]))).toEqual({ count: 2, byName: { Bash: 2 } })
  })
})
