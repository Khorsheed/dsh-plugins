/**
 * The codex round's tool-call accounting: counted out of the SAME
 * `item.completed` branches the transcript fold already walks, keyed by
 * codex's own item type rather than the display name the transcript line
 * carries, and absent — never zero — when the stream named no call.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCodexJsonStream, toolCallsOf } from '../src/codex-cli-provider.ts'

/** An NDJSON stream from the given events. */
function stream(...events: unknown[]): string {
  return events.map(event => JSON.stringify(event)).join('\n')
}

const command = (id: string): unknown => ({
  type: 'item.completed',
  item: { id, type: 'command_execution', command: 'ls', aggregated_output: 'a.txt' },
})

describe('codex tool-call accounting', () => {
  it('counts the real fixture: one command_execution, under codex\'s own item type', () => {
    const fixture = readFileSync(
      fileURLToPath(new URL('./fixtures/command-execution.sample.ndjson', import.meta.url)),
      'utf8',
    )
    // The fixture carries item.started AND item.completed for the same call;
    // only the completed item folds, so the call counts exactly once.
    expect(parseCodexJsonStream(fixture).toolCalls).toEqual({
      count: 1,
      byName: { command_execution: 1 },
    })
  })

  it('reports no accounting at all when the stream named no tool call', () => {
    const parsed = parseCodexJsonStream(stream(
      { type: 'thread.started', thread_id: 't1' },
      { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: '好了' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ))
    // Absent, not `{count: 0}`: "the stream named none" is not the same fact
    // as "the round ran none", and only absence can say the first honestly.
    expect(parsed.toolCalls).toBeUndefined()
  })

  it('tallies repeats and web search under their own names, summing to count', () => {
    const parsed = parseCodexJsonStream(stream(
      command('i0'),
      command('i1'),
      { type: 'item.completed', item: { id: 'i2', type: 'web_search_call' } },
      { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: '好了' } },
    ))
    expect(parsed.toolCalls).toEqual({
      count: 3,
      byName: { command_execution: 2, web_search_call: 1 },
    })
    const byName = parsed.toolCalls!.byName!
    expect(Object.values(byName).reduce((sum, n) => sum + n, 0)).toBe(parsed.toolCalls!.count)
  })

  it('does not count function_call_output — a result is not a second call', () => {
    const parsed = parseCodexJsonStream(stream(
      command('i0'),
      { type: 'item.completed', item: { id: 'i1', type: 'function_call_output', output: 'a.txt' } },
    ))
    expect(parsed.toolCalls).toEqual({ count: 1, byName: { command_execution: 1 } })
  })

  it('counts a command_execution the transcript fold shows nothing for', () => {
    // No command text and no output: the fold pushes no transcript line, but
    // the CLI still made the call, so the accounting must not lose it.
    const parsed = parseCodexJsonStream(stream(
      { type: 'item.completed', item: { id: 'i0', type: 'command_execution' } },
    ))
    expect(parsed.lines).toEqual([])
    expect(parsed.toolCalls).toEqual({ count: 1, byName: { command_execution: 1 } })
  })

  it('the counter fold: an empty tally is undefined, a filled one sums', () => {
    expect(toolCallsOf(new Map())).toBeUndefined()
    expect(toolCallsOf(new Map([['a', 2], ['b', 1]]))).toEqual({ count: 3, byName: { a: 2, b: 1 } })
  })
})
