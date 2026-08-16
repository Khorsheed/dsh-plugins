import { describe, expect, it } from 'vitest'
import {
  basename, highlightMatch, languageFor, matchesQuery, parentPath, relativeToCwd, sortByLatest,
} from '../src/client/path-utils.ts'
import type { FilePreviewEntry } from '@khorsheed/dsh-file-preview/types'

function entry(path: string, seq: number): FilePreviewEntry {
  return { path, op: 'write', seq, turn: 1, step: 1, diffs: [] }
}

describe('basename', () => {
  it('returns the last segment for slash and backslash paths', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts')
    expect(basename('a\\b\\c.ts')).toBe('c.ts')
    expect(basename('notes.md')).toBe('notes.md')
  })
})

describe('parentPath', () => {
  it('returns everything before the last separator', () => {
    expect(parentPath('a/b/c.ts')).toBe('a/b')
    expect(parentPath('c.ts')).toBe('')
    expect(parentPath('/c.ts')).toBe('')
  })
})

describe('relativeToCwd', () => {
  it('strips a matching workspace root prefix', () => {
    expect(relativeToCwd('/work/src/a.ts', '/work')).toBe('src/a.ts')
    expect(relativeToCwd('/work', '/work')).toBe('work')
    expect(relativeToCwd('/work/x.ts', '/work/')).toBe('x.ts')
  })

  it('leaves unrelated or cwd-less paths alone', () => {
    expect(relativeToCwd('/other/a.ts', '/work')).toBe('/other/a.ts')
    expect(relativeToCwd('a.ts', undefined)).toBe('a.ts')
    expect(relativeToCwd('a.ts', '')).toBe('a.ts')
  })
})

describe('sortByLatest', () => {
  it('orders by descending last-occurrence seq without mutating the input', () => {
    const input = [entry('a.md', 3), entry('b.md', 1), entry('c.md', 2)]
    const sorted = sortByLatest(input)
    expect(sorted.map(e => e.path)).toEqual(['a.md', 'c.md', 'b.md'])
    expect(input.map(e => e.path)).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('handles an empty list', () => {
    expect(sortByLatest([])).toEqual([])
  })
})

describe('matchesQuery', () => {
  it('matches the whole path case-insensitively, including directory names', () => {
    expect(matchesQuery('/work/src/agent.ts', 'agent')).toBe(true)
    expect(matchesQuery('/work/src/agent.ts', 'SRC')).toBe(true)
    expect(matchesQuery('/work/src/agent.ts', 'work/src')).toBe(true)
  })

  it('rejects a query absent from the path and empty or whitespace queries', () => {
    expect(matchesQuery('/work/src/agent.ts', 'zzz')).toBe(false)
    expect(matchesQuery('/work/src/agent.ts', '')).toBe(false)
    expect(matchesQuery('/work/src/agent.ts', '   ')).toBe(false)
  })
})

describe('highlightMatch', () => {
  it('splits the name around the first case-insensitive match, keeping the name casing', () => {
    expect(highlightMatch('config.ts', 'CON')).toEqual(['', 'con', 'fig.ts'])
    expect(highlightMatch('MY-config.ts', 'y-c')).toEqual(['M', 'Y-c', 'onfig.ts'])
  })

  it('returns null for a missing query or a name without it', () => {
    expect(highlightMatch('config.ts', '')).toBeNull()
    expect(highlightMatch('config.ts', 'zzz')).toBeNull()
  })
})

describe('languageFor', () => {
  it('maps known extensions to prism languages', () => {
    expect(languageFor('src/a.ts')).toBe('typescript')
    expect(languageFor('pkg.json')).toBe('json')
    expect(languageFor('README.md')).toBe('markdown')
    expect(languageFor('script.sh')).toBe('bash')
    expect(languageFor('UPPER.PY')).toBe('python')
  })

  it('returns undefined for unknown or extensionless paths', () => {
    expect(languageFor('Makefile')).toBeUndefined()
    expect(languageFor('a.unknown-ext')).toBeUndefined()
  })
})
