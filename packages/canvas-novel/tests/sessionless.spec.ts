/**
 * The session-less write fence and the dispose guard. A caller WITHOUT a
 * Session (a host-side consumer with no conversation) resolves the DEPLOYMENT
 * DEFAULT policy at the fence — the fence is never skipped: a read-only
 * deployment still denies, and a policy home that cannot resolve session-less
 * refuses coded instead of letting the write through unfenced. A disposed
 * instance refuses every public verb with the coded package error; a same-root
 * rebuild is a new instance's business.
 *
 * Two suites pin the fence at different depths (the canvas workspace spec's
 * precedent): `the real harness policy chain` runs the REAL services — the
 * SessionProjectionRegistry feeding the real SandboxPolicyService.resolve on
 * a real cordis Context — so a harness release that changes session-less
 * resolution turns this suite red before a consumer finds out; the
 * hand-mirrored policy home of the first suite stays as the readable
 * inventory of exactly which behavior the chain is expected to produce.
 */
import { Context } from '@deepseek-ai/cordis'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { NovelDisposedError, NovelService } from '../src/store.ts'
import { FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'

const STATE = '/dsh/state/novel'
const WORKSPACE = '/home/user/workspace'
const SESSION = { id: 's-1' } as unknown as Session

interface Bench {
  store: NovelService
  ctx: Context
  fs: FakeFs
  canvas: FakeCanvas
  /** The session each policy resolve saw, in call order (undefined = session-less). */
  resolveCalls: (Session | undefined)[]
}

/**
 * One store over a confining FakeFs plus a hand-mirrored policy home: the
 * mirror is the readable member list of the fence contract — a session-less
 * call resolves the deployment default (mode + fallback root, no id), a
 * session call resolves that session's mode and id, and `throwsSessionless`
 * stands in for a host policy home that cannot resolve without a session.
 */
function bench(opts: {
  mode?: 'workspace-write' | 'read-only'
  throwsSessionless?: boolean
  fs?: FakeFs
  canvas?: FakeCanvas
} = {}): Bench {
  const fs = opts.fs ?? new FakeFs()
  fs.sandboxMode = opts.mode ?? fs.sandboxMode ?? 'workspace-write'
  const canvas = opts.canvas ?? new FakeCanvas()
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  provideCanvas(ctx, canvas)
  const resolveCalls: (Session | undefined)[] = []
  ctx.provide('sandboxPolicy', {
    resolve: (request?: { session?: Session }) => {
      resolveCalls.push(request?.session)
      if (request?.session === undefined && opts.throwsSessionless === true) {
        throw new Error('mirror: this policy home needs a session')
      }
      return request?.session === undefined
        ? { mode: fs.sandboxMode, workspaceRoot: '/host-cwd' }
        : { mode: fs.sandboxMode, workspaceRoot: '/session/cwd', sessionId: String(request.session.id) }
    },
  } as never)
  return { store: new NovelService(ctx, { stateRoot: STATE }), ctx, fs, canvas, resolveCalls }
}

/** A fresh 长篇小说 canvas with the workspace attached; its id is the work id. */
function freshWork(canvas: FakeCanvas, title = '工作', id = 'canvas_fresh0001'): string {
  canvas.addBoard({ id, title, workspace: WORKSPACE })
  return id
}

describe('the session-less write fence (the hand-mirrored policy home)', () => {
  it('resolves the deployment default policy — re-rooted at the state root, no session id lent', async () => {
    const { store, fs, canvas, resolveCalls } = bench()
    const workId = freshWork(canvas)
    const planned = await store.writeChapter({ workId, title: '第一章' }, undefined)
    expect(planned).toMatchObject({ ok: true })
    expect(planned.chapter).toMatchObject({ n: 1, phase: 'planning', sessionIds: [] })
    expect(resolveCalls).toEqual([undefined])
    // The one fence the write carried: the deployment default mode, the
    // plugin's own state root as the boundary, no id.
    expect(fs.policies).toEqual([{ mode: 'workspace-write', workspaceRoot: STATE }])
  })

  it('re-roots the same default mode at the work workspace for a session-less manuscript write', async () => {
    const { store, fs, canvas } = bench()
    const workId = freshWork(canvas)
    const written = await store.writeChapter({ workId, title: '第一章', content: '正文第一段。', byUser: true }, undefined)
    expect(written).toMatchObject({ ok: true })
    expect(fs.read(`${WORKSPACE}/工作/第1章.md`)).toContain('正文第一段。')
    // The manuscript first (re-rooted at the work's workspace), then the registration (the state root).
    expect(fs.policies).toEqual([
      { mode: 'workspace-write', workspaceRoot: WORKSPACE },
      { mode: 'workspace-write', workspaceRoot: STATE },
    ])
  })

  it('lands a session-less card write live, every engine write fenced at the default', async () => {
    const { store, fs, canvas } = bench()
    const workId = freshWork(canvas)
    const written = await store.writeCard(
      { workId, role: 'world', fields: { name: '钟楼', kind: '地点', rule: '钟楼是两层梦的接缝。' } },
      undefined,
    )
    expect(written).toMatchObject({ ok: true, ref: 'w1' })
    expect(canvas.card(workId, written.cardId!)).toMatchObject({ status: 'kept' })
    expect(fs.policies.length).toBeGreaterThan(0)
    for (const policy of fs.policies) expect(policy).toEqual({ mode: 'workspace-write', workspaceRoot: STATE })
  })

  it('keeps a session-passed write byte-identical (the unchanged half)', async () => {
    const { store, fs, canvas, resolveCalls } = bench()
    const workId = freshWork(canvas)
    const planned = await store.writeChapter({ workId, title: '第一章' }, SESSION)
    expect(planned).toMatchObject({ ok: true })
    expect(planned.chapter?.sessionIds).toEqual(['s-1'])
    expect(resolveCalls).toEqual([SESSION])
    expect(fs.policies).toEqual([{ mode: 'workspace-write', workspaceRoot: STATE, sessionId: 's-1' }])
  })

  it('denies coded under a read-only deployment default, at both refusal layers', async () => {
    const { store, fs, canvas } = bench({ mode: 'read-only' })
    const workId = freshWork(canvas)
    // The index registration carries the default mode to the fs, which says no.
    expect((await store.writeChapter({ workId, title: '第一章' }, undefined)).error).toBe('denied')
    expect(fs.policies).toEqual([{ mode: 'read-only', workspaceRoot: STATE }])
    // The manuscript write refuses at the service layer, before any fs write at all.
    expect((await store.writeChapter({ workId, title: '第一章', content: '正文。', byUser: true }, undefined)).error).toBe('denied')
    expect(fs.policies).toHaveLength(1)
    expect(await store.listChapters({ workId })).toEqual([])
  })

  it('refuses coded when the policy home cannot resolve session-less — never silently allows', async () => {
    const { store, fs, canvas } = bench({ throwsSessionless: true })
    const workId = freshWork(canvas)
    expect((await store.writeChapter({ workId, title: '第一章' }, undefined)).error).toBe('denied')
    expect((await store.proposeOutline({ workId, sheet: { logline: '一句话主线' } }, undefined)).error).toBe('denied')
    // No write ever reached the fs unfenced.
    expect(fs.policies).toEqual([])
    // The same store with a session resolves and lands as always.
    expect((await store.writeChapter({ workId, title: '第一章' }, SESSION)).ok).toBe(true)
  })

  it('construction without a mounted filesystem fails clearly (the eager fs inject)', () => {
    const ctx = new Context()
    expect(() => new NovelService(ctx, { stateRoot: STATE }))
      .toThrow('@khorsheed/dsh-canvas-novel: the mounting Context must provide fs at construction')
  })
})

/**
 * The store against the REAL harness chain: a true SessionProjectionRegistry
 * feeding a true SandboxPolicyService (`resolve({})` → the deployment default
 * mode + the fallback root) on a real cordis Context. No stub anywhere on
 * this path: a harness release that changes session-less resolution fails
 * HERE, in the provider's own suite.
 */
describe('the session-less write fence against the real harness policy chain', () => {
  function realChainBench(mode: 'workspace-write' | 'read-only') {
    const ctx = new Context()
    new SessionProjectionRegistry(ctx)
    new SandboxPolicyService(ctx, { mode, workspaceRoot: '/host-cwd' })
    const fs = new FakeFs()
    fs.sandboxMode = mode
    ctx.provide('fs', fs as never)
    const canvas = provideCanvas(ctx, new FakeCanvas())
    const store = new NovelService(ctx, { stateRoot: STATE })
    return { ctx, fs, canvas, store }
  }

  it('resolves a session-less write through the real registry and policy home', async () => {
    const { ctx, fs, canvas, store } = realChainBench('workspace-write')
    const workId = freshWork(canvas)
    expect((await store.writeChapter({ workId, title: '第一章' }, undefined)).ok).toBe(true)
    expect((await store.writeChapter({ workId, title: '第二章', content: '正文。', byUser: true }, undefined)).ok).toBe(true)
    // The fences the real chain produced: the deployment default mode, the
    // boundaries re-rooted (state root, then the work workspace for the
    // manuscript), and never a session id.
    expect(fs.policies.map(policy => ({ mode: policy?.mode, workspaceRoot: policy?.workspaceRoot, sessionId: policy?.sessionId }))).toEqual([
      { mode: 'workspace-write', workspaceRoot: STATE, sessionId: undefined },
      { mode: 'workspace-write', workspaceRoot: WORKSPACE, sessionId: undefined },
      { mode: 'workspace-write', workspaceRoot: STATE, sessionId: undefined },
    ])
    await ctx.fiber.dispose()
  })

  it('still denies every session-less write when the real deployment default is read-only', async () => {
    const { ctx, canvas, store } = realChainBench('read-only')
    const workId = freshWork(canvas)
    expect((await store.writeChapter({ workId, title: '第一章' }, undefined)).error).toBe('denied')
    expect((await store.writeChapter({ workId, title: '第二章', content: '正文。', byUser: true }, undefined)).error).toBe('denied')
    expect(await store.listChapters({ workId })).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('the dispose guard', () => {
  it('refuses every public verb with the coded package error after dispose', async () => {
    const { store, canvas } = bench()
    const workId = freshWork(canvas)
    expect((await store.writeChapter({ workId, title: '第一章' }, undefined)).ok).toBe(true)
    store.dispose()
    // The reads.
    await expect(store.readWorkMeta(workId)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.boundWork('s-1')).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listWorks()).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.readEntries(workId)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listExperiences({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listMentions({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listRelationJournal({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listHistory({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listChapters({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.readChapterBody(undefined as never, undefined as never)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.readChapter({ workId, n: 1 })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.readOutline(workId)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.ledger({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.recentUpdates({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.storyLog({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.gatherBrief({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.extractPrepare({ workId, n: 1 })).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.listPending({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    expect(() => store.resolveCard(undefined as never, 'x')).toThrow(NovelDisposedError)
    // The writes (a session behind them would change nothing).
    await expect(store.bindWork('工作', SESSION)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.ensureRefs(workId, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.writeCard({ workId, role: 'world', fields: {} }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.writeChapter({ workId, title: 'x' }, SESSION)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.proposeOutline({ workId, sheet: { logline: 'x' } }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.decideOutline({ workId, action: 'accept' }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.editPlan({ workId, n: 1, plan: {} }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.reviewChapter({ workId, n: 1 }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.starForeshadow({ workId, cardId: 'c_1', starred: true }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.setCurrentState({ workId, cardId: 'c_1', state: {} }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.confirmChapterPlan({ workId, n: 1 }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.extractImport({ workId, n: 1, payload: {} }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    await expect(store.decidePending({ workId, id: 'p1', action: 'accept' }, undefined)).rejects.toBeInstanceOf(NovelDisposedError)
    // Coded and package-named — never a bare throw of arbitrary shape.
    const error = await store.listWorks().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'NovelDisposedError', code: 'disposed' })
    expect((error as Error).message).toContain('@khorsheed/dsh-canvas-novel')
  })

  it('is idempotent', () => {
    const { store } = bench()
    store.dispose()
    store.dispose()
    expect(() => store.dispose()).not.toThrow()
  })

  it('follows the borrowed Context\'s own teardown', async () => {
    const { ctx, store } = bench()
    await ctx.fiber.dispose()
    await expect(store.listWorks()).rejects.toBeInstanceOf(NovelDisposedError)
  })

  it('an in-flight write racing disposal refuses at the write boundary and leaves nothing behind', async () => {
    const { store, fs, canvas } = bench()
    const workId = freshWork(canvas)
    const writing = store.writeChapter({ workId, title: '竞态' }, undefined)
    store.dispose()
    await expect(writing).rejects.toBeInstanceOf(NovelDisposedError)
    // The refusal came before the fs write: no fence was ever stamped, no document created.
    expect(fs.policies).toEqual([])
  })

  it('a same-root rebuild after dispose works (the disposed instance alone stays dead)', async () => {
    const fs = new FakeFs()
    const canvas = new FakeCanvas()
    const first = bench({ fs, canvas })
    const workId = freshWork(canvas)
    expect((await first.store.writeChapter({ workId, title: '第一章' }, undefined)).ok).toBe(true)
    first.store.dispose()
    await expect(first.store.listChapters({ workId })).rejects.toBeInstanceOf(NovelDisposedError)
    // A NEW service instance over the same state root is ordinary business.
    const second = bench({ fs, canvas })
    expect((await second.store.listChapters({ workId })).map(row => row.chapter.title)).toEqual(['第一章'])
    expect((await second.store.writeChapter({ workId, title: '第二章' }, undefined)).ok).toBe(true)
  })
})
