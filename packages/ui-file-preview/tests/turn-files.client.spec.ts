import { describe, expect, it } from 'vitest'
import {
  basename, mutationsForClosing, pathFromToolCall, selectTurnFiles, turnFilesDefinition, type TurnFilesData,
} from '../src/client/turn-files.ts'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

function callEvent(seq: number, turn: number, name: string, args: string) {
  return { seq, type: 'tool/call', data: { turn, name, arguments: args } } as never
}

/** A tool/call update match carrying a diff call view (or none). */
function callMatch(
  seq: number, name: string, args: string,
  diffs?: readonly { path: string; oldText: string | null; newText: string }[],
) {
  return {
    event: callEvent(seq, 1, name, args),
    view: diffs === undefined
      ? undefined
      : { for: 'call', view: { card: 'diff', title: '', diffs } },
  } as never
}

function turnStart(seq: number, turn: number) {
  return { seq, type: 'turn/start', data: { turn } } as never
}

describe('pathFromToolCall', () => {
  it('reads the file_path argument for write and edit', () => {
    expect(pathFromToolCall('write', '{"file_path":"notes.md","content":"x"}')).toBe('notes.md')
    expect(pathFromToolCall('edit', '{"file_path":"src/a.ts"}')).toBe('src/a.ts')
  })

  it('ignores reads, non-file tools, and malformed or empty paths', () => {
    expect(pathFromToolCall('read', '{"file_path":"notes.md"}')).toBeUndefined()
    expect(pathFromToolCall('bash', '{"command":"echo hi"}')).toBeUndefined()
    expect(pathFromToolCall('write', 'not json')).toBeUndefined()
    expect(pathFromToolCall('write', '{"file_path":""}')).toBeUndefined()
    expect(pathFromToolCall('write', '{"file_path":42}')).toBeUndefined()
  })
})

describe('mutationsForClosing', () => {
  const data: TurnFilesData = {
    files: [
      { seq: 3, path: 'a.md', added: 4, removed: 1 },
      { seq: 5, path: 'b.ts', added: 2, removed: undefined },
      { seq: 7, path: 'a.md', added: 1, removed: 0 },
    ],
  }

  it('returns entries in first-seen order', () => {
    expect(mutationsForClosing(data).map(file => file.path)).toEqual(['a.md', 'b.ts', 'a.md'])
  })

  it('excludes entries past the closing seq', () => {
    expect(mutationsForClosing(data, 4).map(file => file.path)).toEqual(['a.md'])
  })

  it('handles undefined data and empty files', () => {
    expect(mutationsForClosing(undefined)).toEqual([])
    expect(mutationsForClosing({ files: [] })).toEqual([])
  })
})

describe('selectTurnFiles', () => {
  const owner = (data: Record<string, unknown>, seq = 100) => ({
    turn: { data: { get: (key: string) => data[key] } },
    seq,
  }) as unknown as TurnTailOwnerProps

  it('declines when the turn neither mutated nor produced files', () => {
    expect(selectTurnFiles(owner({}))).toBeNull()
    expect(selectTurnFiles(owner({
      filePreviewMutations: { files: [] },
      deliverables: { produced: [] },
    }))).toBeNull()
  })

  it('returns the mutated entries with their deltas when present', () => {
    expect(selectTurnFiles(owner({
      filePreviewMutations: { files: [{ seq: 1, path: 'a.md', added: 3, removed: 1 }] },
    }))).toEqual([{ seq: 1, path: 'a.md', added: 3, removed: 1 }])
  })

  it('unions produced files after mutated ones, deduplicating overlaps', () => {
    expect(selectTurnFiles(owner({
      filePreviewMutations: { files: [{ seq: 1, path: 'a.md', added: 1, removed: 0 }] },
      deliverables: { produced: [{ seq: 1, path: 'a.md' }, { seq: 2, path: 'c.ts' }] },
    }))).toEqual([
      { seq: 1, path: 'a.md', added: 1, removed: 0 },
      { seq: 100, path: 'c.ts', added: undefined, removed: undefined },
    ])
  })

  it('lists produced files a mutation outside the file tools generated', () => {
    expect(selectTurnFiles(owner({
      deliverables: { produced: [{ seq: 1, path: '/w/gen.ts' }] },
    }))).toEqual([{ seq: 100, path: '/w/gen.ts', added: undefined, removed: undefined }])
  })

  it('excludes entries past the closing seq in both vocabularies', () => {
    expect(selectTurnFiles(owner({
      filePreviewMutations: { files: [{ seq: 1, path: 'a.md', added: 1, removed: 0 }, { seq: 9, path: 'late.md', added: 1, removed: 0 }] },
      deliverables: { produced: [{ seq: 9, path: 'late.ts' }] },
    }, 5))).toEqual([{ seq: 1, path: 'a.md', added: 1, removed: 0 }])
  })
})

describe('turnFilesDefinition', () => {
  it('matches turn/start and tool/call but not other events', () => {
    expect(turnFilesDefinition.match(turnStart(0, 1))).toEqual({ id: '1', role: 'start' })
    expect(turnFilesDefinition.match(callEvent(1, 1, 'write', '{"file_path":"a.md"}'))).toEqual({ id: '1', role: 'update' })
    expect(turnFilesDefinition.match({ seq: 2, type: 'tool/result', data: {} } as never)).toBeNull()
  })

  it('accumulates mutation paths with line deltas from the diff call view', () => {
    const started = turnFilesDefinition.start({} as never, { event: turnStart(0, 1) } as never, {} as never)
    const afterWrite = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'write', '{"file_path":"a.md"}', [{ path: 'a.md', oldText: null, newText: 'one\ntwo\n' }]),
    )
    expect(afterWrite.files).toEqual([{ seq: 1, path: 'a.md', added: 2, removed: undefined }])
    const afterEdit = turnFilesDefinition.update(
      { state: afterWrite } as never,
      callMatch(2, 'edit', '{"file_path":"a.md"}', [{ path: 'a.md', oldText: 'one\n', newText: 'uno\ndos\n' }]),
    )
    // Second mutation of the same path sums the known deltas; the unknown
    // removed side stays unknown.
    expect(afterEdit.files).toEqual([{ seq: 1, path: 'a.md', added: 4, removed: undefined }])
  })

  it('records mutations without a diff view as delta-less entries', () => {
    const started = turnFilesDefinition.start({} as never, { event: turnStart(0, 1) } as never, {} as never)
    const afterWrite = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'write', '{"file_path":"a.md"}'),
    )
    expect(afterWrite.files).toEqual([{ seq: 1, path: 'a.md', added: undefined, removed: undefined }])
  })

  it('counts deletions, unterminated tails, and skips diffs of other paths', () => {
    const started = turnFilesDefinition.start({} as never, { event: turnStart(0, 1) } as never, {} as never)
    const afterDelete = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'edit', '{"file_path":"a.md"}', [{ path: 'a.md', oldText: 'gone\ngone2', newText: '' }]),
    )
    expect(afterDelete.files).toEqual([{ seq: 1, path: 'a.md', added: 0, removed: 2 }])
    const noMatch = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'write', '{"file_path":"a.md"}', [{ path: 'other.md', oldText: null, newText: 'x' }]),
    )
    expect(noMatch.files).toEqual([{ seq: 1, path: 'a.md', added: undefined, removed: undefined }])
  })

  it('keeps sibling entries untouched when merging a repeated mutation', () => {
    const started = turnFilesDefinition.start({} as never, { event: turnStart(0, 1) } as never, {} as never)
    let state = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'write', '{"file_path":"a.md"}', [{ path: 'a.md', oldText: null, newText: 'x\n' }]),
    )
    state = turnFilesDefinition.update(
      { state } as never,
      callMatch(2, 'write', '{"file_path":"b.ts"}', [{ path: 'b.ts', oldText: null, newText: 'y\n' }]),
    )
    state = turnFilesDefinition.update(
      { state } as never,
      callMatch(3, 'edit', '{"file_path":"a.md"}', [{ path: 'a.md', oldText: 'x\n', newText: 'z\n' }]),
    )
    expect(state.files).toEqual([
      { seq: 1, path: 'a.md', added: 2, removed: undefined },
      { seq: 2, path: 'b.ts', added: 1, removed: undefined },
    ])
  })

  it('ignores reads and non-file calls and publishes turn location data', () => {
    const started = turnFilesDefinition.start({} as never, { event: turnStart(0, 1) } as never, {} as never)
    const afterRead = turnFilesDefinition.update(
      { state: started } as never,
      callMatch(1, 'read', '{"file_path":"a.md"}'),
    )
    const afterBash = turnFilesDefinition.update(
      { state: afterRead } as never,
      callMatch(2, 'bash', '{"command":"echo hi"}'),
    )
    expect(afterBash.files).toEqual([])
    const location = turnFilesDefinition.buildLocationData?.({ state: afterBash } as never, 'turn')
    expect(location).toMatchObject({ kind: 'turn', turn: 1, key: 'filePreviewMutations', value: { files: [] } })
    expect(turnFilesDefinition.buildLocationData?.({ state: afterBash } as never, 'step')).toBeNull()
  })
})

describe('basename', () => {
  it('returns the final path segment', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts')
    expect(basename('a\\b\\c.ts')).toBe('c.ts')
    expect(basename('notes.md')).toBe('notes.md')
  })
})
