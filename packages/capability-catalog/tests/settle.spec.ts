import { describe, expect, it } from 'vitest'
import { installedNames, refreshUntilSettled } from '../src/client/settle.ts'

/** A snapshot face minimal enough for the predicates under test. */
interface Face {
  readonly skills: readonly { readonly name: string }[]
}

describe('refreshUntilSettled', () => {
  it('refreshes once and stops when the change is already visible', async () => {
    const slept: number[] = []
    let calls = 0
    const settled = await refreshUntilSettled<Face>(
      () => ({ skills: [{ name: 'a' }] }),
      async () => { calls += 1 },
      (s) => s.skills.some(k => k.name === 'a'),
      { delaysMs: [250, 500], sleep: async (ms) => { slept.push(ms) } },
    )
    expect(settled).toBe(true)
    // The immediate attempt is kept even when the predicate already holds, so an
    // overwrite still picks up the new content instead of skipping the query.
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('keeps re-querying while the host watcher has not caught up', async () => {
    let face: Face = { skills: [] }
    const slept: number[] = []
    let calls = 0
    const settled = await refreshUntilSettled<Face>(
      () => face,
      async () => {
        calls += 1
        // The installed skill appears on the third query: the first two read the
        // pre-install snapshot, which is exactly what the single refresh did.
        if (calls === 3) face = { skills: [{ name: 'typesafe-ai' }] }
      },
      (s) => s.skills.some(k => k.name === 'typesafe-ai'),
      { delaysMs: [250, 500, 1000], sleep: async (ms) => { slept.push(ms) } },
    )
    expect(settled).toBe(true)
    expect(calls).toBe(3)
    expect(slept).toEqual([250, 500])
  })

  it('gives up after the schedule instead of spinning', async () => {
    const slept: number[] = []
    let calls = 0
    const settled = await refreshUntilSettled<Face>(
      () => ({ skills: [] }),
      async () => { calls += 1 },
      (s) => s.skills.length > 0,
      { delaysMs: [250, 500, 1000, 1500], sleep: async (ms) => { slept.push(ms) } },
    )
    expect(settled).toBe(false)
    // One immediate attempt plus one per delay, then it stops asking.
    expect(calls).toBe(5)
    expect(slept).toEqual([250, 500, 1000, 1500])
  })

  it('treats a snapshot that never landed as unsettled', async () => {
    let calls = 0
    const settled = await refreshUntilSettled<Face>(
      () => undefined,
      async () => { calls += 1 },
      () => true,
      { delaysMs: [1], sleep: async () => {} },
    )
    expect(settled).toBe(false)
    expect(calls).toBe(2)
  })
})

describe('installedNames', () => {
  it('splits the multi-skill form the host joins with a comma', () => {
    expect(installedNames('wechat-reading, typesafe-ai')).toEqual(['wechat-reading', 'typesafe-ai'])
  })

  it('reads a single name as-is', () => {
    expect(installedNames('typesafe-ai')).toEqual(['typesafe-ai'])
  })

  it('returns nothing when the result carried no name', () => {
    expect(installedNames(undefined)).toEqual([])
    expect(installedNames('')).toEqual([])
  })
})
