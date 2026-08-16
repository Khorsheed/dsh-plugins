import { describe, expect, it } from 'vitest'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import {
  diffsFromResultMeta, foldFilePreview, pathFromToolCall,
} from '@deepseek-ai/dsh-file-preview/src/fold.ts'

/** Build one tool/call event with JSON-serialized arguments. */
function toolCall(seq: number, name: string, args: unknown, turn = 1, step = 1): SessionEvent<'tool/call'> {
  return {
    seq,
    time: seq,
    type: 'tool/call',
    data: { turn, step, callId: `call-${seq}` as CallId, name, arguments: JSON.stringify(args) },
  }
}

/** Build one write/edit tool result carrying a presentation diff. */
function toolResult(seq: number, diffs: JsonValue, turn = 1, step = 2): SessionEvent<'tool/result'> {
  return {
    seq,
    time: seq,
    type: 'tool/result',
    data: {
      turn,
      step,
      message: createToolResultMessage({ callId: `call-${seq}` as CallId, content: [{ type: 'text', text: 'ok' }], isError: false }),
      meta: diffs,
    },
  }
}

describe('pathFromToolCall', () => {
  it('reads the file_path argument for read, write, and edit', () => {
    expect(pathFromToolCall('write', '{"file_path":"notes.md","content":"x"}')).toEqual({ op: 'write', path: 'notes.md' })
    expect(pathFromToolCall('edit', '{"file_path":"src/a.ts","old_string":"a","new_string":"b"}')).toEqual({ op: 'edit', path: 'src/a.ts' })
    expect(pathFromToolCall('read', '{"file_path":"notes.md"}')).toEqual({ op: 'read', path: 'notes.md' })
  })

  it('ignores tools that do not touch files', () => {
    expect(pathFromToolCall('bash', '{"command":"echo hi"}')).toBeUndefined()
    expect(pathFromToolCall('glob', '{"pattern":"**/*.md"}')).toBeUndefined()
  })

  it('ignores malformed, non-object, and empty-path arguments', () => {
    expect(pathFromToolCall('write', 'not json')).toBeUndefined()
    expect(pathFromToolCall('write', '[]')).toBeUndefined()
    expect(pathFromToolCall('write', 'null')).toBeUndefined()
    expect(pathFromToolCall('write', '{"file_path":""}')).toBeUndefined()
    expect(pathFromToolCall('write', '{"file_path":42}')).toBeUndefined()
  })
})

describe('diffsFromResultMeta', () => {
  it('extracts valid diff hunks from write/edit presentation meta', () => {
    expect(diffsFromResultMeta({ diffs: [{ path: 'a.md', oldText: 'x', newText: 'y' }] })).toEqual([
      { path: 'a.md', oldText: 'x', newText: 'y' },
    ])
    expect(diffsFromResultMeta({ diffs: [{ path: 'a.md', oldText: null, newText: 'y' }] })).toEqual([
      { path: 'a.md', oldText: null, newText: 'y' },
    ])
  })

  it('ignores non-diff metas and malformed hunk shapes', () => {
    expect(diffsFromResultMeta(undefined)).toBeUndefined()
    expect(diffsFromResultMeta({ other: true })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [null] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: ['x'] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [{ path: 'a.md', newText: 42 }] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [{ path: 'a.md', oldText: 42, newText: 'y' }] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [{ path: '', oldText: 'x', newText: 'y' }] })).toBeUndefined()
    expect(diffsFromResultMeta({ diffs: [{ path: 'a.md', oldText: 'x' }] })).toBeUndefined()
  })
})

describe('foldFilePreview', () => {
  it('returns an empty list with the -1 watermark for an empty log', () => {
    expect(foldFilePreview([], 500)).toEqual({ entries: [], asOfSeq: -1, truncated: false })
  })

  it('lists read, written, and edited files in first-seen order', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }, 1, 1),
      toolCall(1, 'read', { file_path: 'b.md' }, 1, 2),
      toolCall(2, 'edit', { file_path: 'c.md' }, 1, 3),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.asOfSeq).toBe(2)
    expect(result.truncated).toBe(false)
    expect(result.entries.map(entry => entry.path)).toEqual(['a.md', 'b.md', 'c.md'])
    expect(result.entries[0]!).toMatchObject({ path: 'a.md', op: 'write', seq: 0, turn: 1, step: 1 })
    expect(result.entries[1]).toMatchObject({ path: 'b.md', op: 'read', seq: 1, turn: 1, step: 2 })
    expect(result.entries[2]).toMatchObject({ path: 'c.md', op: 'edit', seq: 2, turn: 1, step: 3 })
  })

  it('refreshes a repeated path in place, keeping its first-seen position', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }, 1, 1),
      toolCall(1, 'write', { file_path: 'b.md' }, 1, 2),
      toolCall(2, 'edit', { file_path: 'a.md' }, 2, 1),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries.map(entry => entry.path)).toEqual(['a.md', 'b.md'])
    expect(result.entries[0]!).toMatchObject({ path: 'a.md', op: 'edit', seq: 2, turn: 2, step: 1 })
  })

  it('attaches the last write/edit diff from a tool result and keeps it across a later read', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'write', { file_path: 'a.md' }),
      toolCall(1, 'edit', { file_path: 'a.md' }),
      toolResult(2, { diffs: [{ path: 'a.md', oldText: 'x', newText: 'y' }] }),
      toolCall(3, 'read', { file_path: 'a.md' }),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries[0]!).toMatchObject({
      path: 'a.md',
      op: 'read',
      seq: 3,
      lastDiff: { oldText: 'x', newText: 'y' },
    })
  })

  it('accumulates every write/edit diff in event order with its location', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'write', { file_path: 'a.md' }, 1, 1),
      toolResult(1, { diffs: [{ path: 'a.md', oldText: null, newText: 'v1' }] }, 1, 2),
      toolCall(2, 'edit', { file_path: 'a.md' }, 2, 1),
      toolResult(3, { diffs: [{ path: 'a.md', oldText: 'v1', newText: 'v2' }] }, 2, 2),
      toolCall(4, 'edit', { file_path: 'a.md' }, 3, 1),
      toolResult(5, { diffs: [{ path: 'a.md', oldText: 'v2', newText: 'v3' }] }, 3, 2),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries[0]!.diffs).toEqual([
      { seq: 1, turn: 1, step: 2, oldText: null, newText: 'v1' },
      { seq: 3, turn: 2, step: 2, oldText: 'v1', newText: 'v2' },
      { seq: 5, turn: 3, step: 2, oldText: 'v2', newText: 'v3' },
    ])
    // lastDiff stays the final change of the chain.
    expect(result.entries[0]!.lastDiff).toEqual({ oldText: 'v2', newText: 'v3' })
  })

  it('keeps prior diffs when a later tool call refreshes the location', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'write', { file_path: 'a.md' }),
      toolResult(1, { diffs: [{ path: 'a.md', oldText: null, newText: 'v1' }] }),
      toolCall(2, 'read', { file_path: 'a.md' }, 2, 1),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries[0]!).toMatchObject({ path: 'a.md', op: 'read', seq: 2, turn: 2, step: 1 })
    expect(result.entries[0]!.diffs).toEqual([
      { seq: 1, turn: 1, step: 2, oldText: null, newText: 'v1' },
    ])
  })

  it('leaves diffs empty for a file that was only read', () => {
    const events = [toolCall(0, 'read', { file_path: 'a.md' })]
    expect(foldFilePreview(events, 500).entries[0]!.diffs).toEqual([])
  })

  it('ignores tool results for paths never recorded by a call', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'write', { file_path: 'a.md' }),
      toolResult(1, { diffs: [{ path: 'ghost.md', oldText: 'x', newText: 'y' }] }),
    ]
    expect(foldFilePreview(events, 500).entries.map(entry => entry.path)).toEqual(['a.md'])
  })

  it('skips non-file calls and diff-less results while advancing the watermark', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'bash', { command: 'echo hi' }),
      toolResult(1, { other: true }),
      toolCall(2, 'write', { file_path: 'a.md' }),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.asOfSeq).toBe(2)
    expect(result.entries.map(entry => entry.path)).toEqual(['a.md'])
  })

  it('caps entries at maxFiles and flags truncation', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }),
      toolCall(1, 'write', { file_path: 'b.md' }),
      toolCall(2, 'write', { file_path: 'c.md' }),
    ]
    const result = foldFilePreview(events, 2)
    expect(result.entries.map(entry => entry.path)).toEqual(['a.md', 'b.md'])
    expect(result.truncated).toBe(true)
  })

  it('flags truncation at exactly maxFiles', () => {
    const events = [toolCall(0, 'write', { file_path: 'a.md' }), toolCall(1, 'write', { file_path: 'b.md' })]
    expect(foldFilePreview(events, 2).truncated).toBe(true)
  })

  it('keeps the watermark at the last event regardless of relevance', () => {
    const events: SessionEvent[] = [
      { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } },
      toolCall(1, 'write', { file_path: 'a.md' }),
    ]
    expect(foldFilePreview(events, 500).asOfSeq).toBe(1)
  })
})

/** Build one settled nested Code Mode dispatch event (arguments already parsed). */
function codeDispatch(
  seq: number, name: string, args: unknown, rootSeq: number, isError = false,
): SessionEvent<'tool/code-dispatch'> {
  return {
    seq,
    time: seq,
    type: 'tool/code-dispatch',
    data: {
      rootCallId: `call-${rootSeq}` as CallId,
      parentCallId: `call-${rootSeq}` as CallId,
      subCallId: `call-${rootSeq}:code:1` as CallId,
      name,
      arguments: args,
      isError,
      content: [],
    },
  }
}

describe('foldFilePreview code dispatches', () => {
  it('records nested Code Mode file dispatches with the root call location', () => {
    const events = [
      toolCall(0, 'run_code', { code: '…' }, 3, 2),
      codeDispatch(1, 'write', { file_path: 'a.md' }, 0),
      codeDispatch(2, 'edit', { file_path: 'b.ts' }, 0),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries).toMatchObject([
      { path: 'a.md', op: 'write', seq: 1, turn: 3, step: 2 },
      { path: 'b.ts', op: 'edit', seq: 2, turn: 3, step: 2 },
    ])
  })

  it('skips failed, non-file, and malformed dispatches', () => {
    const events = [
      toolCall(0, 'run_code', { code: '…' }),
      codeDispatch(1, 'write', { file_path: 'a.md' }, 0, true),
      codeDispatch(2, 'bash', { command: 'echo hi' }, 0),
      codeDispatch(3, 'write', { nope: 1 }, 0),
      codeDispatch(4, 'write', { file_path: 'b.md' }, 0),
    ]
    expect(foldFilePreview(events, 500).entries.map(entry => entry.path)).toEqual(['b.md'])
  })

  it('falls back to a zero location when the root call is outside the window', () => {
    const events = [codeDispatch(1, 'write', { file_path: 'a.md' }, 99)]
    expect(foldFilePreview(events, 500).entries[0]).toMatchObject({ path: 'a.md', turn: 0, step: 0 })
  })

  it('refreshes a top-level entry in place when a dispatch repeats the path', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }, 1, 1),
      toolCall(1, 'run_code', { code: '…' }, 2, 1),
      codeDispatch(2, 'edit', { file_path: 'a.md' }, 1),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ path: 'a.md', op: 'edit', seq: 2, turn: 2, step: 1 })
  })
})
