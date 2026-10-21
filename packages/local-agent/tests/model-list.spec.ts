import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstModelOf, MODEL_LIST_FILE, normalizeModelList, readModelList, readModelListSync, writeModelList } from '../src/model-list.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'claude-models-'))
}

describe('normalizeModelList', () => {
  it('trims, drops blanks and non-strings, and dedupes keeping first occurrence', () => {
    expect(normalizeModelList(['  a  ', '', ' ', 1, 'b', 'a', null, 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(normalizeModelList([])).toEqual([])
  })
})

describe('model list file', () => {
  it('round-trips an ordered list and reads it both ways', async () => {
    const home = tempHome()
    await expect(writeModelList(home, [' claude-opus-5-5 ', 'claude-haiku-5-5', 'claude-opus-5-5'])).resolves.toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    await expect(readModelList(home)).resolves.toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(readModelListSync(home)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
  })

  it('reads absent, malformed, and wrongly-shaped files as an empty list', async () => {
    const home = tempHome()
    await expect(readModelList(home)).resolves.toEqual([])
    expect(readModelListSync(home)).toEqual([])
    writeFileSync(join(home, MODEL_LIST_FILE), 'not json')
    await expect(readModelList(home)).resolves.toEqual([])
    writeFileSync(join(home, MODEL_LIST_FILE), '{"models":"opus"}')
    await expect(readModelList(home)).resolves.toEqual([])
    // The bare-array form reads too (hand-edited files are input).
    writeFileSync(join(home, MODEL_LIST_FILE), '["a","b"]')
    await expect(readModelList(home)).resolves.toEqual(['a', 'b'])
  })

  it('an empty write deletes the file instead of shadowing the fallback chain', async () => {
    const home = tempHome()
    await writeModelList(home, ['a'])
    expect(existsSync(join(home, MODEL_LIST_FILE))).toBe(true)
    await expect(writeModelList(home, [])).resolves.toEqual([])
    expect(existsSync(join(home, MODEL_LIST_FILE))).toBe(false)
  })
})

describe('firstModelOf', () => {
  it('answers the first entry, or undefined when empty', () => {
    expect(firstModelOf(['a', 'b'])).toBe('a')
    expect(firstModelOf([])).toBeUndefined()
  })
})
