import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createHistoryLoader } from '../src/client/history-loader.ts'

const SESSION = 's1' as SessionId

const ROW = { type: 'user/message', seq: 2, time: 1_000, data: { content: [{ type: 'text', text: 'hi' }] } }

/** Alpha-arm remote double: follow answers one snapshot, page records its args. */
function alphaRemote(overrides: { readonly snapshot?: object; readonly pageResult?: object } = {}) {
  const snapshot = {
    type: 'snapshot',
    cursor: 7,
    records: [{ type: 'event', event: ROW }],
    hasMore: true,
    ...overrides.snapshot,
  }
  const follow = vi.fn(async function* () { yield snapshot })
  const page = vi.fn(async () => ({
    ok: true,
    value: { records: [{ type: 'event', event: { ...ROW, seq: 0 } }], hasMore: false },
    ...overrides.pageResult,
  }))
  return { session: { follow, page }, follow, page }
}

describe('createHistoryLoader', () => {
  it('alpha arm: tail page rides the follow snapshot and unwraps records', async () => {
    const { session, follow, page } = alphaRemote()
    const load = createHistoryLoader(session, undefined)
    const tail = await load(SESSION, undefined, 200)
    expect(follow).toHaveBeenCalledWith({ address: { kind: 'session', sessionId: SESSION }, maxMessages: 200 }, expect.any(AbortSignal))
    expect(page).not.toHaveBeenCalled()
    expect(tail).toEqual({ events: [ROW], hasMore: true })
  })

  it('alpha arm: older pages reuse the snapshot cut as throughSeq', async () => {
    const { session, page } = alphaRemote()
    const load = createHistoryLoader(session, undefined)
    await load(SESSION, undefined, 200)
    const older = await load(SESSION, 2, 200)
    expect(page).toHaveBeenCalledWith(
      { address: { kind: 'session', sessionId: SESSION }, throughSeq: 7, beforeSeq: 2, maxMessages: 200 },
    )
    expect(older).toEqual({ events: [{ ...ROW, seq: 0 }], hasMore: false })
  })

  it('alpha arm: a follow failure or a non-ok page resolves undefined', async () => {
    const failing = { follow: vi.fn(async function* (): AsyncGenerator<object> { throw new Error('carrier') }) }
    await expect(createHistoryLoader(failing, undefined)(SESSION, undefined, 200)).resolves.toBeUndefined()
    const { session } = alphaRemote({ pageResult: { ok: false } })
    const load = createHistoryLoader(session, undefined)
    await load(SESSION, undefined, 200)
    await expect(load(SESSION, 2, 200)).resolves.toBeUndefined()
  })

  it('rc.2 arm: without session.follow the loader calls connection.api.sessions.history and unwraps HistoryEntry', async () => {
    const history = vi.fn(async (payload: object) => ({
      result: { ok: true, value: { events: [{ event: ROW }], hasMore: false } },
    }))
    // A remote with a session namespace but no follow method still falls to the legacy arm.
    const load = createHistoryLoader({}, { api: { sessions: { history } } })
    const page = await load(SESSION, undefined, 200)
    expect(history).toHaveBeenCalledWith({ sessionId: SESSION, maxMessages: 200 })
    expect(page).toEqual({ events: [ROW], hasMore: false })
  })

  it('rc.2 arm: beforeSeq rides the payload; a non-ok result resolves undefined', async () => {
    const history = vi.fn(async () => ({ result: { ok: false } }))
    const load = createHistoryLoader(undefined, { api: { sessions: { history } } })
    await expect(load(SESSION, 5, 200)).resolves.toBeUndefined()
    expect(history).toHaveBeenCalledWith({ sessionId: SESSION, beforeSeq: 5, maxMessages: 200 })
  })

  it('neither face mounted: the loader resolves undefined without throwing', async () => {
    await expect(createHistoryLoader({}, undefined)(SESSION, undefined, 200)).resolves.toBeUndefined()
    await expect(createHistoryLoader(undefined, {})(SESSION, undefined, 200)).resolves.toBeUndefined()
  })
})
