import { describe, expect, it } from 'vitest'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  diffsFromResultMeta, foldFilePreview, foldFilePreviewByTurn, pathFromToolCall,
} from '@khorsheed/dsh-file-preview/src/fold.ts'

/** Build one tool/call event with JSON-serialized arguments. */
function toolCall(seq: number, name: string, args: unknown, turn = 1, step = 1): SessionEvent<'tool/call'> {
  return {
    seq,
    time: seq,
    type: 'tool/call',
    data: { turn, step, callId: `call-${seq}` as ToolCallId, name, arguments: JSON.stringify(args) },
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
      message: createToolResultMessage({ callId: `call-${seq}` as ToolCallId, content: [{ type: 'text', text: 'ok' }], isError: false }),
      meta: diffs,
    },
  }
}

/**
 * Build the result of a `write` call: the real message carries the
 * `tool-result` block with the CALL's callId, and a create's write tool
 * attaches no diff meta (`{ diffs: [] }`).
 */
function writeResult(seq: number, callSeq: number, turn = 1, step = 2): SessionEvent<'tool/result'> {
  return {
    seq,
    time: seq,
    type: 'tool/result',
    data: {
      turn,
      step,
      message: createToolResultMessage({
        callId: `call-${callSeq}` as ToolCallId,
        content: [{ type: 'text', text: 'Created' }],
        isError: false,
      }),
      meta: { diffs: [] },
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

  it('registers render-intent paths from result diff meta even without a call', () => {
    const events: SessionEvent[] = [
      toolCall(0, 'write', { file_path: 'a.md' }),
      toolResult(1, { diffs: [{ path: 'ghost.md', oldText: 'x', newText: 'y' }] }),
    ]
    expect(foldFilePreview(events, 500).entries.map(entry => entry.path)).toEqual(['a.md', 'ghost.md'])
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

/** Build one settled nested PTC dispatch event (arguments already parsed). */
function ptcDispatch(
  seq: number, name: string, args: unknown, rootSeq: number, isError = false,
): SessionEvent<'tool/ptc-dispatch'> {
  return {
    seq,
    time: seq,
    type: 'tool/ptc-dispatch',
    data: {
      rootCallId: `call-${rootSeq}` as ToolCallId,
      parentCallId: `call-${rootSeq}` as ToolCallId,
      subCallId: `call-${rootSeq}:ptc:1` as ToolCallId,
      name,
      arguments: args,
      isError,
      content: [],
    },
  }
}

describe('foldFilePreview ptc dispatches', () => {
  it('records nested PTC file dispatches with the root call location', () => {    const events = [
      toolCall(0, 'run_code', { code: '…' }, 3, 2),
      ptcDispatch(1, 'write', { file_path: 'a.md' }, 0),
      ptcDispatch(2, 'edit', { file_path: 'b.ts' }, 0),
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
      ptcDispatch(1, 'write', { file_path: 'a.md' }, 0, true),
      ptcDispatch(2, 'bash', { command: 'echo hi' }, 0),
      ptcDispatch(3, 'write', { nope: 1 }, 0),
      ptcDispatch(4, 'write', { file_path: 'b.md' }, 0),
    ]
    expect(foldFilePreview(events, 500).entries.map(entry => entry.path)).toEqual(['b.md'])
  })

  it('falls back to a zero location when the root call is outside the window', () => {
    const events = [ptcDispatch(1, 'write', { file_path: 'a.md' }, 99)]
    expect(foldFilePreview(events, 500).entries[0]).toMatchObject({ path: 'a.md', turn: 0, step: 0 })
  })

  it('refreshes a top-level entry in place when a dispatch repeats the path', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }, 1, 1),
      toolCall(1, 'run_code', { code: '…' }, 2, 1),
      ptcDispatch(2, 'edit', { file_path: 'a.md' }, 1),
    ]
    const result = foldFilePreview(events, 500)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ path: 'a.md', op: 'edit', seq: 2, turn: 2, step: 1 })
  })
})

describe('foldFilePreviewByTurn', () => {
  it('keeps a path in EVERY turn that touched it (repeated-touch fidelity)', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'a.md' }, 2, 1),
      toolCall(1, 'edit', { file_path: 'a.md' }, 5, 3),
      toolCall(2, 'write', { file_path: 'b.md' }, 5, 4),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    expect(byTurn.get(2)?.get('a.md')?.seq).toBe(0)
    expect(byTurn.get(5)?.get('a.md')?.seq).toBe(1)
    expect(byTurn.get(5)?.get('b.md')?.seq).toBe(2)
    expect(byTurn.get(2)?.get('b.md')).toBeUndefined()
  })

  it('a pure-read call leaves no turn entry (reads are not products)', () => {
    const events = [
      toolCall(0, 'read', { file_path: 'notes.md' }, 2, 1),
      toolCall(1, 'read', { file_path: 'notes.md' }, 3, 1),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    expect(byTurn.get(2)?.get('notes.md')).toBeUndefined()
    expect(byTurn.get(3)?.get('notes.md')).toBeUndefined()
    expect(byTurn.size).toBe(0)
  })

  it('a read before a mutation does not seed the card, and does not count as first-touch', () => {
    const events = [
      toolCall(0, 'read', { file_path: 'a.md' }, 2, 1),
      toolCall(1, 'write', { file_path: 'a.md', content: 'x\n' }, 2, 2),
      writeResult(2, 1, 2, 3),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    // The write is a create (the session never wrote/edited the path before):
    // its full content counts, the prior read contributes nothing.
    expect(byTurn.get(2)?.get('a.md')).toMatchObject({ added: 1, removed: 0 })
  })

  it('a ptc read dispatch leaves no turn entry', () => {
    const events = [
      toolCall(0, 'run_code', { code: '…' }, 3, 1),
      ptcDispatch(1, 'read', { file_path: 'a.md' }, 0),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    expect(byTurn.get(3)?.get('a.md')).toBeUndefined()
    expect(byTurn.size).toBe(0)
  })

  it('registers render-intent paths from result diff meta and sums per-turn deltas', () => {
    const events = [
      toolResult(0, { diffs: [{ path: 'render.html', oldText: null, newText: 'a\nb\n' }] }, 1),
      toolResult(1, { diffs: [{ path: 'render.html', oldText: 'a\n', newText: 'a\nb\nc\n' }] }, 1),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    const fact = byTurn.get(1)?.get('render.html')
    expect(fact).toMatchObject({ added: 5 })
    expect(fact?.removed).toBeUndefined()
  })

  it('counts a create write from the call content when the result carries no diff meta', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'new.md', content: 'a\nb\nc\n' }, 3, 1),
      writeResult(1, 0, 3, 2),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    // A create removes 0 lines; the full written content is the added count.
    expect(byTurn.get(3)?.get('new.md')).toMatchObject({ added: 3, removed: 0 })
  })

  it('accumulates deltas across multiple mutations of one file (tool/call placeholders do not wipe)', () => {
    const events = [
      toolCall(0, 'edit', { file_path: 'a.md', old_string: 'x', new_string: 'x\ny\n' }, 2, 1),
      toolResult(1, { diffs: [{ path: 'a.md', oldText: 'x', newText: 'x\ny\n' }] }, 2, 2),
      toolCall(2, 'edit', { file_path: 'a.md', old_string: 'y', new_string: 'y\nz\n' }, 2, 3),
      toolResult(3, { diffs: [{ path: 'a.md', oldText: 'y\n', newText: 'y\nz\n' }] }, 2, 4),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    // First edit added 2 removed 1; second added 2 removed 1 — totals sum.
    expect(byTurn.get(2)?.get('a.md')).toMatchObject({ added: 4, removed: 2 })
  })

  it('a create followed by an edit accumulates both counts', () => {
    const events = [
      toolCall(0, 'write', { file_path: 'new.md', content: 'a\n' }, 2, 1),
      writeResult(1, 0, 2, 2),
      toolCall(2, 'edit', { file_path: 'new.md', old_string: 'a', new_string: 'a\nb\n' }, 2, 3),
      toolResult(3, { diffs: [{ path: 'new.md', oldText: 'a\n', newText: 'a\nb\n' }] }, 2, 4),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    // Create added 1 (removed 0); edit added 2 removed 1.
    expect(byTurn.get(2)?.get('new.md')).toMatchObject({ added: 3, removed: 1 })
  })

  it('a ptc dispatch to the same file poisons the deltas (unknown wins)', () => {
    const events = [
      toolCall(0, 'edit', { file_path: 'a.md', old_string: 'x', new_string: 'y\nz\n' }, 2, 1),
      toolResult(1, { diffs: [{ path: 'a.md', oldText: 'x', newText: 'y\nz\n' }] }, 2, 2),
      ptcDispatch(2, 'write', { file_path: 'a.md' }, 0),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    const fact = byTurn.get(2)?.get('a.md')
    expect(fact?.added).toBeUndefined()
    expect(fact?.removed).toBeUndefined()
  })

  it('a non-first-touch write with empty result meta contributes no count', () => {
    const events = [
      // The file was written before in this session, so the second write is an
      // overwrite whose prior content was not diffable — nothing to count.
      toolCall(0, 'write', { file_path: 'a.md', content: 'v1\n' }, 1, 1),
      writeResult(1, 0, 1, 2),
      toolCall(2, 'write', { file_path: 'a.md', content: 'v2\n' }, 2, 1),
      writeResult(3, 2, 2, 2),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    expect(byTurn.get(1)?.get('a.md')).toMatchObject({ added: 1, removed: 0 })
    expect(byTurn.get(2)?.get('a.md')?.added).toBeUndefined()
    expect(byTurn.get(2)?.get('a.md')?.removed).toBeUndefined()
  })

  it('borrows the enclosing root call turn for ptc dispatches', () => {
    const events = [
      toolCall(0, 'run_code', { code: '…' }, 3, 1),
      ptcDispatch(1, 'write', { file_path: 'a.md' }, 0),
    ]
    const byTurn = foldFilePreviewByTurn(events)
    expect(byTurn.get(3)?.get('a.md')?.step).toBe(1)
  })

  it('the list fold now registers diff-only paths (the card vocabulary)', () => {
    const events = [toolResult(0, { diffs: [{ path: 'render.html', oldText: null, newText: 'x' }] }, 1)]
    const result = foldFilePreview(events, 500)
    expect(result.entries[0]).toMatchObject({ path: 'render.html', op: 'edit' })
    expect(result.entries[0]?.diffs).toHaveLength(1)
  })
})
