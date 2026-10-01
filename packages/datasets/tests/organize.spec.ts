/**
 * T90 · the organizing requests: the text the 添加题集 dialog, 「交给 Agent
 * 修改」 and 「退回给 Agent」 draft into a 题集整理 session, the name rule,
 * the default repository path (decision C), and the draft retry loop.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAddRequest, buildReturnRequest, buildUpdateRequest, checkDatasetName, DRAFT_RETRIES_MS, draftWithRetries, repoPathFor,
} from '../src/client/organize.ts'
import { pickRandom } from '../src/client/ReviewPage.tsx'

const t = ((key: string, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)) as never

describe('organizing requests', () => {
  it('the name rule is the registry’s', () => {
    expect(checkDatasetName('gsm8k')).toBe(true)
    expect(checkDatasetName('swe-bench.verified_1')).toBe(true)
    expect(checkDatasetName('')).toBe(false)
    expect(checkDatasetName('-x')).toBe(false)
    expect(checkDatasetName('a b')).toBe(false)
    expect(checkDatasetName('a/b')).toBe(false)
  })

  it('a new repository defaults to <datasets home>/<name>', () => {
    expect(repoPathFor('/home/user/.dsh/datasets/', 'gsm8k')).toBe('/home/user/.dsh/datasets/gsm8k')
    expect(repoPathFor('', 'gsm8k')).toBe('')
    expect(repoPathFor('/home/user/.dsh/datasets', '')).toBe('')
  })

  it('the add request carries every field, the purpose only when given', () => {
    const full = buildAddRequest({ source: ' ~/Downloads/gsm8k ', name: 'gsm8k', purpose: 'math' }, '/h', t)
    expect(full.split('\n')[0]).toBe('organize.request')
    expect(full).toContain('organize.lineSource {"value":"~/Downloads/gsm8k"}')
    expect(full).toContain('organize.lineName {"value":"gsm8k"}')
    expect(full).toContain('organize.linePurpose {"value":"math"}')
    expect(full).toContain('organize.lineRepo {"value":"/h/gsm8k"}')
    const bare = buildAddRequest({ source: 'x', name: 'n', purpose: '  ' }, '', t)
    expect(bare).not.toContain('organize.linePurpose')
    expect(bare).not.toContain('organize.lineRepo')
  })

  it('the update request names the checkout when there is one, and leaves room for the ask', () => {
    const text = buildUpdateRequest({ name: 'lib', checkout: '/w/lib', ref: 'main' }, t)
    expect(text).toContain('organize.updateRequest {"name":"lib"}')
    expect(text).toContain('organize.lineCheckout {"value":"/w/lib"}')
    expect(text).toContain('organize.lineRef {"value":"main"}')
    expect(text.endsWith('organize.lineWant\n')).toBe(true)
    expect(buildUpdateRequest({ name: 'lib', checkout: null, ref: 'main' }, t)).not.toContain('organize.lineCheckout')
  })

  it('the return request frames the person’s note', () => {
    expect(buildReturnRequest('lib', '  split the sets  ', t)).toBe('organize.returnRequest {"name":"lib"}\n\nsplit the sets')
  })
})

describe('draftWithRetries', () => {
  it('retries until the chat box takes the text', async () => {
    const waits: number[] = []
    let calls = 0
    const ok = await draftWithRetries(() => ++calls === 3, async (ms) => { waits.push(ms) })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
    expect(waits).toEqual([DRAFT_RETRIES_MS[1], DRAFT_RETRIES_MS[2] - DRAFT_RETRIES_MS[1]])
  })

  it('gives up after the last offset, a throwing attempt counting as a miss', async () => {
    let calls = 0
    const ok = await draftWithRetries(() => { calls += 1; throw new Error('not mounted') }, async () => {})
    expect(ok).toBe(false)
    expect(calls).toBe(DRAFT_RETRIES_MS.length)
  })
})

describe('pickRandom', () => {
  it('picks distinct entries, at most the list', () => {
    const list = [1, 2, 3, 4, 5]
    const picked = pickRandom(list, 3, () => 0.5)
    expect(new Set(picked).size).toBe(3)
    expect(picked.every(entry => list.includes(entry))).toBe(true)
    expect(pickRandom([1], 3)).toEqual([1])
    expect(list).toEqual([1, 2, 3, 4, 5])
  })
})
