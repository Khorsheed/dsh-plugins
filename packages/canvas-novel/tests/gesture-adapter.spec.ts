/**
 * The agent-free gesture adapter's contract: PARITY with the native Remote
 * face (the same request through `remote.novel.*` and through
 * `createNovelGestureAdapter` yields the same receipt — the text-plan parse,
 * the `changed` receipts, the error codes and the unknown refs included), the
 * session-less fence underneath it, no agents/lookup contact anywhere on the
 * path, and the disposed core's coded refusal on BOTH faces.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createNovelGestureAdapter, type NovelGestureAdapter } from '../src/gestures.ts'
import { NovelRemoteService } from '../src/remote.ts'
import { NovelDisposedError, NovelService } from '../src/store.ts'
import { dreamCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-1' } as unknown as Session

/** The plan edit the parity sequence runs (a full text-form plan for chapter 6). */
const PLAN_TEXT = `梗概：赵启明穿过门缝，看见倒置的档案室。
情节：
- 深夜｜两人穿过门缝（转折）
- 门后传来妹妹的声音（落点）
伏笔：
- 推进 #12：门后第一层
出场：
- 赵启明（视角）：推门的人
- 艾文：带路
章末钩子：影子在门后出现`

interface Bench {
  store: NovelService
  fs: FakeFs
  remote: NovelRemoteService
  agent: Agent
  adapter: NovelGestureAdapter
}

/**
 * One seeded《梦境监护者》world with BOTH faces mounted: the native Remote
 * (called with a stub agent, as the wire would) and the adapter (closed over
 * the same session). `poisonAgents` mounts an `agents` face whose every
 * property get throws — the tripwire proving the path never touches it.
 */
function bench(opts: { mode?: 'workspace-write' | 'read-only'; poisonAgents?: boolean } = {}): Bench {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  fs.sandboxMode = opts.mode ?? 'workspace-write'
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  provideCanvas(ctx, dreamCanvas())
  if (opts.poisonAgents === true) {
    ctx.provide('agents', new Proxy({}, { get: () => { throw new Error('agents must not be touched') } }) as never)
  }
  ctx.provide('sandboxPolicy', {
    resolve: (request?: { session?: Session }) => request?.session === undefined
      ? { mode: fs.sandboxMode, workspaceRoot: '/host-cwd' }
      : { mode: fs.sandboxMode, workspaceRoot: '/session/cwd', sessionId: String(request.session.id) },
  } as never)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  ctx.provide('canvasNovel', store as never)
  const remote = new NovelRemoteService(ctx)
  const agent = { session: SESSION } as unknown as Agent
  return { store, fs, remote, agent, adapter: createNovelGestureAdapter(store, SESSION) }
}

/** One gesture case run through both faces. */
interface ParityCase {
  readonly name: string
  readonly remote: (face: NovelRemoteService, agent: Agent) => Promise<unknown>
  readonly adapter: (face: NovelGestureAdapter) => Promise<unknown>
}

describe('the gesture adapter — parity with the native Remote', () => {
  it('runs the same gesture sequence through both faces with identical receipts and state', async () => {
    const a = bench()
    const b = bench()
    const work = DREAM.workId
    const cases: ParityCase[] = [
      // The happy path: a full text-form plan edit (the parse runs in the shared core).
      {
        name: 'editPlan lands',
        remote: (face, agent) => face.editPlan(agent, { canvasId: work, n: 6, text: PLAN_TEXT }),
        adapter: face => face.editPlan({ canvasId: work, n: 6, text: PLAN_TEXT }),
      },
      // An unknown handle: the error receipt names it, identically on both faces.
      {
        name: 'editPlan names unknown refs',
        remote: (face, agent) => face.editPlan(agent, { canvasId: work, n: 6, text: '梗概：x\n伏笔：\n- 推进 #99：不存在的伏笔' }),
        adapter: face => face.editPlan({ canvasId: work, n: 6, text: '梗概：x\n伏笔：\n- 推进 #99：不存在的伏笔' }),
      },
      {
        name: 'confirmPlan on the edited chapter',
        remote: (face, agent) => face.confirmPlan(agent, { canvasId: work, n: 6 }),
        adapter: face => face.confirmPlan({ canvasId: work, n: 6 }),
      },
      {
        name: 'confirmPlan on a planless chapter',
        remote: (face, agent) => face.confirmPlan(agent, { canvasId: work, n: 1 }),
        adapter: face => face.confirmPlan({ canvasId: work, n: 1 }),
      },
      {
        name: 'reviewChapter too early',
        remote: (face, agent) => face.reviewChapter(agent, { canvasId: work, n: 6 }),
        adapter: face => face.reviewChapter({ canvasId: work, n: 6 }),
      },
      {
        name: 'reviewChapter closes an extracted chapter',
        remote: (face, agent) => face.reviewChapter(agent, { canvasId: work, n: 5 }),
        adapter: face => face.reviewChapter({ canvasId: work, n: 5 }),
      },
      {
        name: 'starForeshadow',
        remote: (face, agent) => face.starForeshadow(agent, { canvasId: work, cardId: CARD.doorGap, starred: true }),
        adapter: face => face.starForeshadow({ canvasId: work, cardId: CARD.doorGap, starred: true }),
      },
      {
        name: 'starForeshadow on a character card refuses',
        remote: (face, agent) => face.starForeshadow(agent, { canvasId: work, cardId: CARD.zhao, starred: true }),
        adapter: face => face.starForeshadow({ canvasId: work, cardId: CARD.zhao, starred: true }),
      },
      {
        name: 'setCurrentState',
        remote: (face, agent) => face.setCurrentState(agent, { canvasId: work, cardId: CARD.zhao, state: { where: '门后', state: '推门而入' } }),
        adapter: face => face.setCurrentState({ canvasId: work, cardId: CARD.zhao, state: { where: '门后', state: '推门而入' } }),
      },
      {
        name: 'setCurrentState on a foreshadow refuses',
        remote: (face, agent) => face.setCurrentState(agent, { canvasId: work, cardId: CARD.doorGap, state: {} }),
        adapter: face => face.setCurrentState({ canvasId: work, cardId: CARD.doorGap, state: {} }),
      },
      {
        name: 'decidePending on an empty queue',
        remote: (face, agent) => face.decidePending(agent, { canvasId: work, id: 'p1', action: 'accept' }),
        adapter: face => face.decidePending({ canvasId: work, id: 'p1', action: 'accept' }),
      },
      {
        name: 'decideOutline without a proposal',
        remote: (face, agent) => face.decideOutline(agent, { canvasId: work, action: 'accept' }),
        adapter: face => face.decideOutline({ canvasId: work, action: 'accept' }),
      },
    ]
    for (const entry of cases) {
      const native = await entry.remote(a.remote, a.agent)
      const adapted = await entry.adapter(b.adapter)
      expect(adapted, entry.name).toEqual(native)
    }
    // The receipts matched; now the same gestures landed the same state in both worlds.
    const planA = (await a.store.readChapter({ workId: work, n: 6 })).chapter?.plan
    const planB = (await b.store.readChapter({ workId: work, n: 6 })).chapter?.plan
    expect(planB).toEqual(planA)
    expect(planA?.summary).toBe('赵启明穿过门缝，看见倒置的档案室。')
    expect(planA?.foreshadowOps[0]).toMatchObject({ op: '推进', id: CARD.doorGap })
    expect((await a.store.readEntries(work))?.foreshadows.find(view => view.cardId === CARD.doorGap)?.starred).toBe(true)
    expect((await b.store.readEntries(work))?.foreshadows.find(view => view.cardId === CARD.doorGap)?.starred).toBe(true)

    // And a further edit keeps parity — the parse's changed list included.
    const edited = await a.remote.editPlan(a.agent, { canvasId: work, n: 6, text: '梗概：穿过后回头，门已经不在了。' })
    const editedB = await b.adapter.editPlan({ canvasId: work, n: 6, text: '梗概：穿过后回头，门已经不在了。' })
    expect(editedB).toEqual(edited)
    expect(edited.ok).toBe(true)
    expect(edited.changed).toContain('summary')

    // decideOutline's happy path: identical proposals on both cores, then the decision.
    expect((await a.store.proposeOutline({ workId: work, sheet: { logline: '一个人守着别人的梦' } }, SESSION)).ok).toBe(true)
    expect((await b.store.proposeOutline({ workId: work, sheet: { logline: '一个人守着别人的梦' } }, SESSION)).ok).toBe(true)
    const decidedNative = await a.remote.decideOutline(a.agent, { canvasId: work, action: 'accept' })
    const decidedAdapted = await b.adapter.decideOutline({ canvasId: work, action: 'accept' })
    expect(decidedAdapted).toEqual(decidedNative)
    expect(decidedNative).toEqual({ ok: true })
    expect((await a.store.readOutline(work)).sheet.logline).toBe((await b.store.readOutline(work)).sheet.logline)
  })
})

describe('the gesture adapter — the fence underneath', () => {
  it('a session-less adapter write resolves the deployment default, no id lent', async () => {
    const { store, fs } = bench()
    const adapter = createNovelGestureAdapter(store)
    expect(await adapter.starForeshadow({ canvasId: DREAM.workId, cardId: CARD.doorGap, starred: true })).toEqual({ ok: true })
    expect(fs.policies.length).toBeGreaterThan(0)
    for (const policy of fs.policies) expect(policy).toEqual({ mode: 'workspace-write', workspaceRoot: DREAM.stateRoot })
  })

  it('a session-less adapter write under a read-only default is refused coded', async () => {
    const { store } = bench({ mode: 'read-only' })
    const adapter = createNovelGestureAdapter(store)
    expect(await adapter.starForeshadow({ canvasId: DREAM.workId, cardId: CARD.doorGap, starred: true }))
      .toEqual({ ok: false, error: 'denied' })
  })

  it('never touches an agents/lookup face — construction included', async () => {
    const { store } = bench({ poisonAgents: true })
    const adapter = createNovelGestureAdapter(store)
    const work = DREAM.workId
    // Every verb answers a RECEIPT (ok or coded error) — the poisoned proxy never fires.
    const receipts: { readonly ok: boolean }[] = [
      await adapter.editPlan({ canvasId: work, n: 6, text: PLAN_TEXT }),
      await adapter.confirmPlan({ canvasId: work, n: 6 }),
      await adapter.reviewChapter({ canvasId: work, n: 6 }),
      await adapter.starForeshadow({ canvasId: work, cardId: CARD.doorGap, starred: true }),
      await adapter.setCurrentState({ canvasId: work, cardId: CARD.zhao, state: {} }),
      await adapter.decidePending({ canvasId: work, id: 'p1', action: 'discard' }),
      await adapter.decideOutline({ canvasId: work, action: 'discard' }),
    ]
    expect(receipts.map(receipt => receipt.ok)).toEqual([true, true, false, true, true, false, false])
  })

  it('a disposed core refuses coded through BOTH faces', async () => {
    const { store, remote, agent, adapter } = bench()
    store.dispose()
    const request = { canvasId: DREAM.workId, cardId: CARD.doorGap, starred: true }
    await expect(adapter.starForeshadow(request)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(remote.starForeshadow(agent, request)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(adapter.editPlan({ canvasId: DREAM.workId, n: 6, text: PLAN_TEXT })).rejects.toBeInstanceOf(NovelDisposedError)
  })
})
