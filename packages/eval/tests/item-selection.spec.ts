/**
 * 选题's reproducible half (T90 · second segment): the draw is a pure function
 * of (pool, count, seed), pinned here to literal outputs so a refactor that
 * changed the arithmetic — and so silently re-drew every saved seed — fails.
 */
import { describe, expect, it } from 'vitest'
import {
  drawItems, hash53, ItemSelectionRefused, mintSeed, resolveSelection, SEED_MINT_CEILING, SELECTION_ALGORITHM, selectionPool,
} from '../src/contract/item-selection.ts'
import { PLAN_SCHEMA, validateJson } from '../src/contract/schema.ts'

/** seed 42, count 5 over IDS — computed once and frozen here. */
const PINNED_42 = ['item-03', 'item-04', 'item-11', 'item-12', 'item-16']

const IDS = Array.from({ length: 20 }, (_, i) => `item-${String(i + 1).padStart(2, '0')}`)

describe('hash53 (cyrb53)', () => {
  it('is the published cyrb53 — pinned values', () => {
    expect(hash53('')).toBe(3338908027751811)
    expect(hash53('a')).toBe(7929297801672961)
    expect(hash53('a', 1)).not.toBe(hash53('a'))
  })
})

describe('drawItems', () => {
  it('pins the draw for a known seed (the contract: change this and SELECTION_ALGORITHM must change)', () => {
    expect(SELECTION_ALGORITHM).toBe('hash-rank/1')
    expect(drawItems(IDS, 5, 42)).toEqual(PINNED_42)
  })

  it('same pool + count + seed ⇒ same items, whatever order or duplicates the pool came in', () => {
    const shuffled = [...IDS].reverse().concat(IDS.slice(0, 3))
    expect(drawItems(shuffled, 5, 42)).toEqual(drawItems(IDS, 5, 42))
  })

  it('returns the draw in pool (id) order, count long, without duplicates', () => {
    const drawn = drawItems(IDS, 7, 123)
    expect(drawn).toHaveLength(7)
    expect(new Set(drawn).size).toBe(7)
    expect(drawn).toEqual([...drawn].sort())
  })

  it('different seeds draw differently (over a handful of seeds)', () => {
    const draws = new Set([1, 2, 3, 4, 5, 6].map(seed => drawItems(IDS, 5, seed).join(',')))
    expect(draws.size).toBeGreaterThan(1)
  })

  it('an item\'s fate depends on its own key: adding an item never evicts more than one', () => {
    const before = drawItems(IDS, 5, 9)
    const after = drawItems([...IDS, 'item-99'], 5, 9)
    expect(after.filter(id => !before.includes(id)).length).toBeLessThanOrEqual(1)
  })

  it('a growing count only adds (the smaller draw is a prefix of the ranking)', () => {
    const small = drawItems(IDS, 3, 77)
    const large = drawItems(IDS, 8, 77)
    expect(small.every(id => large.includes(id))).toBe(true)
  })

  it('seeds above 2^32 do not collide with their low word', () => {
    expect(drawItems(IDS, 5, 2 ** 32 + 5)).not.toEqual(drawItems(IDS, 5, 5))
  })

  it('refuses a count out of range, a bad seed', () => {
    expect(() => drawItems(IDS, 0, 1)).toThrow(ItemSelectionRefused)
    expect(() => drawItems(IDS, 21, 1)).toThrow(/pool of 20/)
    expect(() => drawItems(IDS, 2.5, 1)).toThrow(/count/)
    expect(() => drawItems(IDS, 2, -1)).toThrow(/seed/)
    expect(() => drawItems(IDS, 2, 1.5)).toThrow(/seed/)
  })

  it('count = pool size draws everything', () => {
    expect(drawItems(IDS, 20, 3)).toEqual(IDS)
  })
})

describe('resolveSelection', () => {
  const items = [
    { id: 'P0', placeholder: true },
    ...IDS.map(id => ({ id, placeholder: false })),
  ]

  it('all: every real item, sorted; placeholders only when asked', () => {
    expect(resolveSelection(items, { mode: 'all' })).toEqual({ items: IDS, record: { mode: 'all', pool: 20 } })
    expect(resolveSelection(items, { mode: 'all', includePlaceholders: true }))
      .toEqual({ items: ['P0', ...IDS], record: { mode: 'all', pool: 21, placeholders: true } })
  })

  it('random: draws from the same pool and records how', () => {
    expect(resolveSelection(items, { mode: 'random', count: 5, seed: 42 })).toEqual({
      items: PINNED_42,
      record: { mode: 'random', count: 5, seed: 42, pool: 20, algorithm: 'hash-rank/1' },
    })
  })

  it('pick: the person\'s order, de-duplicated; unknown ids refused by name', () => {
    expect(resolveSelection(items, { mode: 'pick', items: ['item-03', ' item-01 ', 'item-03'] }))
      .toEqual({ items: ['item-03', 'item-01'], record: { mode: 'pick', pool: 21 } })
    expect(() => resolveSelection(items, { mode: 'pick', items: ['nope'] })).toThrow(/"nope"/)
    expect(() => resolveSelection(items, { mode: 'pick', items: [] })).toThrow(/no items picked/)
  })

  it('a set of placeholders only says so', () => {
    expect(() => resolveSelection([{ id: 'P0', placeholder: true }], { mode: 'all' })).toThrow(/only placeholder items/)
  })

  it('selectionPool sorts by code unit, not locale', () => {
    expect(selectionPool([{ id: 'b', placeholder: false }, { id: 'B', placeholder: false }, { id: 'a', placeholder: false }]))
      .toEqual(['B', 'a', 'b'])
  })
})

describe('mintSeed', () => {
  it('mints a positive integer below the ceiling, from the source it is given', () => {
    expect(mintSeed(() => 0)).toBe(1)
    expect(mintSeed(() => 0.999999)).toBeLessThan(SEED_MINT_CEILING)
    for (let i = 0; i < 50; i++) expect(Number.isSafeInteger(mintSeed())).toBe(true)
  })
})

describe('dataset.selection in the plan schema (v1-rev15)', () => {
  const dataset = (selection: unknown) => ({ registry: 'reg', set: 'ds', commit: 'c'.repeat(40), items: ['a'], selection })
  const check = (selection: unknown) => validateJson(
    (PLAN_SCHEMA['properties'] as Record<string, unknown>)['dataset'],
    dataset(selection),
  )

  it('accepts each record resolveSelection writes', () => {
    expect(check({ mode: 'all', pool: 3 })).toEqual([])
    expect(check({ mode: 'all', pool: 3, placeholders: true })).toEqual([])
    expect(check({ mode: 'random', count: 1, seed: 4, pool: 3, algorithm: 'hash-rank/1' })).toEqual([])
    expect(check({ mode: 'pick', pool: 3 })).toEqual([])
  })

  it('refuses a random record that cannot be redone, an unknown mode, an extra field', () => {
    expect(check({ mode: 'random', count: 1, pool: 3, algorithm: 'hash-rank/1' }).join('\n')).toMatch(/"seed"/)
    expect(check({ mode: 'every', pool: 3 })).not.toEqual([])
    expect(check({ mode: 'all', pool: 3, why: 'x' }).join('\n')).toMatch(/"why"/)
  })
})
