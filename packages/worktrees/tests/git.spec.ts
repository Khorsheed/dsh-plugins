/**
 * Parser unit tests for the git.ts data plane — pure functions, no git
 * binary needed.
 */
import { describe, expect, it } from 'vitest'
import {
  mergeCounts, parseLog, parseNameStatus, parsePorcelain, parseWorktreeList,
} from '../src/git.ts'

describe('parseWorktreeList', () => {
  it('parses the main checkout first and linked worktrees after', () => {
    const output = [
      'worktree /home/user/code/dsh-plugins',
      'HEAD 1e6430d0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d',
      'branch refs/heads/main',
      '',
      'worktree /home/user/code/dsh-plugins-wt-room',
      'HEAD 2e6430d0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d',
      'branch refs/heads/room',
      '',
      'worktree /home/user/code/dsh-plugins-wt-detached',
      'HEAD 3e6430d0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d',
      'detached',
      '',
    ].join('\n')
    const entries = parseWorktreeList(output)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ path: '/home/user/code/dsh-plugins', branch: 'refs/heads/main', isMain: true })
    expect(entries[1]).toMatchObject({ path: '/home/user/code/dsh-plugins-wt-room', branch: 'refs/heads/room', isMain: false })
    expect(entries[2]).toMatchObject({ path: '/home/user/code/dsh-plugins-wt-detached', branch: null, isMain: false })
  })

  it('handles an empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('parsePorcelain', () => {
  it('parses modified, added, deleted, and untracked rows', () => {
    const output = [
      ' M src/service.ts',
      'A  src/new.ts',
      ' D src/old.ts',
      '?? untracked.txt',
    ].join('\n')
    const files = parsePorcelain(output)
    expect(files.map(f => [f.path, f.status])).toEqual([
      ['src/service.ts', 'M'],
      ['src/new.ts', 'A'],
      ['src/old.ts', 'D'],
      ['untracked.txt', '??'],
    ])
    expect(files[3]?.additions).toBeNull()
  })

  it('parses renames and reports the destination path', () => {
    const files = parsePorcelain('R  src/old.ts -> src/new.ts')
    expect(files[0]).toMatchObject({ path: 'src/new.ts', status: 'R' })
  })

  it('ignores blank lines', () => {
    expect(parsePorcelain('  \n M a.ts\n\n')).toHaveLength(1)
  })
})

describe('parseNameStatus', () => {
  it('parses add/modify/delete and rename destinations', () => {
    const output = [
      'M\tsrc/service.ts',
      'A\tpackages/x/src/index.ts',
      'D\told.txt',
      'R100\tfrom.ts\tto.ts',
    ].join('\n')
    const files = parseNameStatus(output)
    expect(files.map(f => [f.path, f.status])).toEqual([
      ['src/service.ts', 'M'],
      ['packages/x/src/index.ts', 'A'],
      ['old.txt', 'D'],
      ['to.ts', 'R'],
    ])
  })

  it('handles an empty output', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('mergeCounts', () => {
  it('attaches numstat counts to status rows by path', () => {
    const files = [
      { path: 'a.ts', status: 'M' as const, additions: null, deletions: null },
      { path: 'b.ts', status: '??' as const, additions: null, deletions: null },
    ]
    const numstat = '12\t4\ta.ts\n3\t0\tc.ts\n'
    const merged = mergeCounts(files, numstat)
    expect(merged[0]).toMatchObject({ path: 'a.ts', additions: 12, deletions: 4 })
    // Untracked files have no numstat row — counts stay null.
    expect(merged[1]).toMatchObject({ path: 'b.ts', additions: null, deletions: null })
  })

  it('keeps rows without a numstat entry untouched', () => {
    const files = [{ path: 'x.ts', status: 'M' as const, additions: null, deletions: null }]
    expect(mergeCounts(files, '')).toEqual(files)
  })
})

describe('parseLog', () => {
  it('parses short-format rows', () => {
    const output = ['a1b2c3d\tfeat: something\tAlice\t1787567598', 'e5f6a7b\tfix: other\tBob\t1787567000'].join('\n')
    const rows = parseLog(output)
    expect(rows).toEqual([
      { sha: 'a1b2c3d', subject: 'feat: something', author: 'Alice', time: 1787567598 },
      { sha: 'e5f6a7b', subject: 'fix: other', author: 'Bob', time: 1787567000 },
    ])
  })

  it('skips malformed rows', () => {
    expect(parseLog('a1b2c3d\tno-time-here')).toEqual([])
  })
})
