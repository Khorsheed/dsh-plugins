/**
 * The store's core verbs on the《梦境监护者》seed and on a fresh work:
 * registry + numbering rules (n max+1, file from n, ids per table), the
 * focus map, the review gate, the ghost-card review flow, the ledger, the
 * JSONL journals, and the re-rooted fence (the canvas store's pattern).
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { resolveStoryStateRoot, StoryBibleService } from '../src/store.ts'
import { chapterFileName, chapterNumberOfFile, effectiveChapterPhase } from '../src/types.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-1' } as unknown as Session
const OTHER = { id: 's-2' } as unknown as Session

/** A store over a confining FakeFs (workspace-write) plus the fence ledger. */
function confiningStore(stateRoot = '/dsh/state/story'): { store: StoryBibleService; fs: FakeFs } {
  const fs = new FakeFs()
  fs.sandboxMode = 'workspace-write'
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }: { session: Session }) => ({ mode: 'workspace-write', workspaceRoot: '/some/session/cwd', sessionId: String(session.id) }),
  } as never)
  return { store: new StoryBibleService(ctx, { stateRoot }), fs }
}

describe('the story store', () => {
  it('resolves the state root the datasets/canvas way (explicit → $DSH_HOME/state/story → cwd)', () => {
    expect(resolveStoryStateRoot('/x')).toBe('/x')
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = '/dsh-home'
    expect(resolveStoryStateRoot(undefined)).toBe('/dsh-home/state/story')
    if (home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = home
    expect(resolveStoryStateRoot('')).toContain('.dsh-story')
  })

  it('creates a work: registry row, work.json, focus — and lists it back', async () => {
    const { store, fs } = confiningStore()
    const created = await store.createWork({ title: '测试作品', workspace: '/home/user/workspace' }, SESSION)
    expect(created.ok).toBe(true)
    const works = await store.listWorks()
    expect(works).toHaveLength(1)
    expect(works[0]).toMatchObject({ title: '测试作品', workspace: '/home/user/workspace' })
    // The index on disk is the proposal §2 shape.
    const index = JSON.parse(fs.read('/dsh/state/story/index.json')) as unknown[]
    expect(index).toHaveLength(1)
    // Every write carried the re-rooted fence: the plugin's state dir, the caller's mode and id.
    expect(fs.policies.every(policy => policy?.workspaceRoot === '/dsh/state/story' && policy.sessionId === 's-1')).toBe(true)
    const focused = await store.focusWork({ workId: created.work!.id }, SESSION)
    expect(focused.ok).toBe(true)
    expect(store.focusedWorkOf(SESSION)?.workId).toBe(created.work!.id)
    expect(store.focusedWorkOf(OTHER)).toBeUndefined()
    // The information page computes counts live.
    const info = await store.readWork({ workId: created.work!.id })
    expect(info.info?.counts).toEqual({ memories: 0, intentDrafts: 0, characters: 0, chapters: 0, pending: 0 })
    expect(info.info?.stateDir).toBe(`/dsh/state/story/${created.work!.id}`)
  })

  it('allocates chapter numbers max+1, names files from n, keeps seq as the sort key', async () => {
    const { store } = confiningStore()
    const created = await store.createWork({ title: '编号', workspace: '/home/user/workspace' }, SESSION)
    const workId = created.work!.id
    const first = await store.writeChapter({ workId, title: '第一章' }, SESSION)
    const second = await store.writeChapter({ workId, title: '第二章' }, SESSION)
    expect(first.chapter).toMatchObject({ n: 1, seq: 1, file: '第1章.md', phase: 'planning' })
    expect(second.chapter).toMatchObject({ n: 2, seq: 2, file: '第2章.md' })
    // An explicit seq inserts between neighbors without touching n.
    const inserted = await store.writeChapter({ workId, title: '幕间', seq: 1.5 }, SESSION)
    expect(inserted.chapter).toMatchObject({ n: 3, seq: 1.5, file: '第3章.md' })
    const listed = await store.listChapters({ workId })
    expect(listed.map(row => row.chapter.title)).toEqual(['第一章', '幕间', '第二章'])
    // Updating by n keeps the number and the file.
    const replanned = await store.writeChapter({ workId, n: 2, title: '第二章·改', plan: { goal: '新目标' } }, SESSION)
    expect(replanned.chapter).toMatchObject({ n: 2, title: '第二章·改', file: '第2章.md' })
    expect(replanned.chapter?.plan?.goal).toBe('新目标')
  })

  it('derives 写作中/文件丢失 from the manuscript fact, and 审过 closes only an extracted chapter', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    const chapters = await store.listChapters({ workId: DREAM.workId })
    expect(chapters.find(row => row.chapter.n === 5)?.phase).toBe('extracted')
    expect(chapters.find(row => row.chapter.n === 6)?.phase).toBe('planning')
    // A planning chapter with a manuscript on disk reads 写作中.
    fs.seed(`${DREAM.workspace}/${DREAM.title}/第6章.md`, '开头三段。\n')
    const after = await store.listChapters({ workId: DREAM.workId })
    expect(after.find(row => row.chapter.n === 6)?.phase).toBe('writing')
    // 审过是人工闸门，永远最后: planning/writing refuse, extracted closes, idempotent past the gate.
    const tooEarly = await store.reviewChapter({ workId: DREAM.workId, n: 6 }, SESSION)
    expect(tooEarly.ok).toBe(false)
    expect(tooEarly.error).toBe('not-extracted')
    const reviewed = await store.reviewChapter({ workId: DREAM.workId, n: 5 }, SESSION)
    expect(reviewed.chapter?.phase).toBe('reviewed')
    const again = await store.reviewChapter({ workId: DREAM.workId, n: 5 }, SESSION)
    expect(again.ok).toBe(true)
    // A chapter past planning whose manuscript file vanished reads 文件丢失.
    expect(effectiveChapterPhase({ ...again.chapter!, phase: 'extracted' }, true)).toBe('extracted')
    expect(effectiveChapterPhase({ ...again.chapter!, phase: 'extracted' }, false)).toBe('fileMissing')
    expect(effectiveChapterPhase({ ...again.chapter!, phase: 'reviewed' }, false)).toBe('fileMissing')
  })

  it('runs the ghost-card review flow: draft → accept enters the brief, discard archives', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    const written = await store.writeMemory({ workId: DREAM.workId, content: '钟楼是两层梦的接缝。', kind: '世界' }, SESSION, 'agent')
    expect(written.memory).toMatchObject({ id: 'm19', layer: 'intent', intentStatus: 'draft', reviewed: false, extractedBy: 'llm' })
    // A draft stays out of the brief's canon set…
    const before = await store.gatherBrief({ workId: DREAM.workId })
    expect(before.data?.canonRules.some(memory => memory.content.includes('接缝'))).toBe(false)
    const accepted = await store.decideMemory({ workId: DREAM.workId, id: 'm19', action: 'accept' }, SESSION)
    expect(accepted.memory).toMatchObject({ intentStatus: 'active', reviewed: true })
    const discarded = await store.decideMemory({ workId: DREAM.workId, id: 'm6', action: 'discard' }, SESSION)
    expect(discarded.memory).toMatchObject({ status: 'archived', intentStatus: 'retired' })
    // Ids allocate max+1 over the table, sparse numbering included.
    const next = await store.writeMemory({ workId: DREAM.workId, content: '又一条。' }, SESSION, 'user')
    expect(next.memory?.id).toBe('m20')
    expect(next.memory).toMatchObject({ reviewed: true, extractedBy: 'user', confidence: 'high' })
  })

  it('reads the ledger off the seed (沉睡优先, health counts)', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.counts).toEqual({ active: 3, overdue: 3, resolved: 1, abandoned: 0 })
    expect(ledger.currentChapter).toBe(6)
    expect(ledger.active.map(memory => memory.id)).toEqual(['m18', 'm15', 'm12'])
  })

  it('appends to the JSONL journals without rewriting history (bad lines drop out of the view only)', async () => {
    const { store, fs } = confiningStore()
    const created = await store.createWork({ title: '流水', workspace: '/home/user/workspace' }, SESSION)
    const workId = created.work!.id
    await store.writeCharacter({ workId, name: '甲' }, SESSION)
    // A hand-corrupted line stays on disk but drops out of the view.
    fs.seed(`/dsh/state/story/${workId}/experiences.jsonl`, '{"characterId":"c1","chapter":1,"entry":"好行","createdAt":"t"}\nnot-json\n')
    const before = await store.listExperiences({ workId })
    expect(before).toHaveLength(1)
    // …and an import's append keeps both the good line and the corrupt one.
    fs.seed(`/dsh/state/story/${workId}/chapters.json`, `${JSON.stringify({ version: 1, chapters: [
      { n: 1, seq: 1, title: '一', file: '第1章.md', phase: 'planning', sessionIds: [], createdAt: 't', updatedAt: 't' },
    ] }, null, 2)}\n`)
    fs.seed(`/dsh/state/story/${workId}/memories.json`, `${JSON.stringify({ version: 1, memories: [] }, null, 2)}\n`)
    fs.seed(`/dsh/state/story/${workId}/pending.json`, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`)
    fs.seed(`${'/home/user/workspace'}/流水/第1章.md`, '正文里有甲出场。\n')
    const report = await store.extractImport({ workId, n: 1, payload: {
      experiences: [{ character_id: 'c1', entry: '甲出场了', confidence: 'high', evidence_in_text: '甲出场' }],
    } }, SESSION)
    expect(report.ok).toBe(true)
    const raw = fs.read(`/dsh/state/story/${workId}/experiences.jsonl`)
    expect(raw).toContain('not-json')
    expect(raw.trim().split('\n')).toHaveLength(3)
    const after = await store.listExperiences({ workId })
    expect(after).toHaveLength(2)
  })

  it('refuses to write what it cannot read (corrupt files never get clobbered)', async () => {
    const { store, fs } = confiningStore()
    const created = await store.createWork({ title: '坏档', workspace: '/home/user/workspace' }, SESSION)
    const workId = created.work!.id
    fs.seed(`/dsh/state/story/${workId}/memories.json`, '{broken json')
    const outcome = await store.writeMemory({ workId, content: '不该落库。' }, SESSION, 'agent')
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('io')
    expect(fs.read(`/dsh/state/story/${workId}/memories.json`)).toBe('{broken json')
  })

  it('a read-only deployment denies every state write (the fence keeps the mode)', async () => {
    const fs = new FakeFs()
    fs.sandboxMode = 'read-only'
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: '/x' }) } as never)
    const store = new StoryBibleService(ctx, { stateRoot: '/dsh/state/story' })
    const created = await store.createWork({ title: '只读', workspace: '/home/user/workspace' }, SESSION)
    expect(created.ok).toBe(false)
    expect(created.error).toBe('denied')
  })

  it('writeChapter with content writes the body fenced BEFORE registering — a denied write refuses the registration', async () => {
    const { store, fs } = confiningStore()
    const created = await store.createWork({ title: '落盘', workspace: '/home/user/workspace' }, SESSION)
    const workId = created.work!.id
    // content given: the body lands at <workspace>/<title>/第1章.md and the chapter registers.
    const written = await store.writeChapter({ workId, title: '第一章', content: '开头三段。\n' }, SESSION)
    expect(written.ok).toBe(true)
    expect(fs.read('/home/user/workspace/落盘/第1章.md')).toBe('开头三段。\n')
    expect(written.chapter).toMatchObject({ n: 1, file: '第1章.md' })
    // The write carried the session's mode with the boundary re-rooted at the WORK's workspace.
    expect(fs.policies.every(policy => policy?.workspaceRoot === '/home/user/workspace' || policy?.workspaceRoot === '/dsh/state/story')).toBe(true)
    // The chapter reads back as 写作中 (planning + body).
    const listed = await store.listChapters({ workId })
    expect(listed[0]?.phase).toBe('writing')
    // A denied body write refuses the registration: no chapter row appears
    // (a read-only deployment's policy refuses every write).
    const denied = new FakeFs()
    denied.sandboxMode = 'read-only'
    denied.seed('/dsh/state/story/index.json', '[]\n')
    const ctxDenied = new Context()
    ctxDenied.provide('fs', denied as never)
    ctxDenied.provide('sandboxPolicy', {
      resolve: ({ session }: { session: Session }) => ({ mode: 'read-only', workspaceRoot: '/outside', sessionId: String(session.id) }),
    } as never)
    const deniedStore = new StoryBibleService(ctxDenied, { stateRoot: '/dsh/state/story' })
    denied.seed('/dsh/state/story/index.json', `${JSON.stringify([{ id: 'work-denied0001', title: '拒', workspace: '/outside', createdAt: 't' }], null, 2)}\n`)
    denied.seed('/dsh/state/story/work-denied0001/work.json', `${JSON.stringify({ id: 'work-denied0001', title: '拒', workspace: '/outside', createdAt: 't', updatedAt: 't' }, null, 2)}\n`)
    const refused = await deniedStore.writeChapter({ workId: 'work-denied0001', title: '第一章', content: '写不进去。' }, SESSION)
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe('denied')
    expect((await deniedStore.listChapters({ workId: 'work-denied0001' })).length).toBe(0)
  })

  it('statWorkspace answers existence and directory-ness for the create form', async () => {
    const fs = new FakeFs()
    fs.seed('/home/user/workspace/note.md', 'x')
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: '/dsh/state/story' })
    expect(await store.statWorkspace({ path: '/home/user/workspace' })).toEqual({ ok: true, exists: true, directory: true })
    expect(await store.statWorkspace({ path: '/home/user/workspace/note.md' })).toEqual({ ok: true, exists: true, directory: false })
    expect(await store.statWorkspace({ path: '/nope' })).toEqual({ ok: true, exists: false, directory: false })
    expect((await store.statWorkspace({ path: '' })).ok).toBe(false)
  })

  it('the chapter file vocabulary round-trips (the invariant probe shares it)', () => {
    expect(chapterNumberOfFile(chapterFileName(60))).toBe(60)
    expect(chapterNumberOfFile('第6章.txt')).toBeUndefined()
    expect(chapterNumberOfFile('第六十章.md')).toBeUndefined()
  })

  it('patchMemory revises through derives_from: the old row archives, the new one heads the chain', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    const revised = await store.patchMemory({ workId: DREAM.workId, id: 'm2', content: '蓝色叶子是梦主意识碎片的载体，见光即醒。' }, SESSION)
    expect(revised.ok).toBe(true)
    expect(revised.memory).toMatchObject({ id: 'm19', reviewed: true, extractedBy: 'user', links: { derivesFrom: ['m2'] } })
    const memories = await store.listMemories({ workId: DREAM.workId, includeArchived: true })
    expect(memories.find(memory => memory.id === 'm2')?.status).toBe('archived')
    expect(memories.find(memory => memory.id === 'm19')?.content).toBe('蓝色叶子是梦主意识碎片的载体，见光即醒。')
    // The brief's canon set reads the new head, not the archived row.
    const brief = await store.gatherBrief({ workId: DREAM.workId })
    expect(brief.data?.canonRules.some(memory => memory.id === 'm19')).toBe(true)
    expect(brief.data?.canonRules.some(memory => memory.id === 'm2')).toBe(false)
    // An archived row refuses further edits.
    expect((await store.patchMemory({ workId: DREAM.workId, id: 'm2', content: 'x' }, SESSION)).ok).toBe(false)
  })

  it('confirmChapterPlan stamps the gate and is idempotent; a planless chapter refuses', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    expect((await store.confirmChapterPlan({ workId: DREAM.workId, n: 1 }, SESSION)).ok).toBe(false) // no plan
    const confirmed = await store.confirmChapterPlan({ workId: DREAM.workId, n: 6 }, SESSION)
    expect(confirmed.ok).toBe(true)
    expect(confirmed.chapter?.planConfirmedAt).toBeDefined()
    const again = await store.confirmChapterPlan({ workId: DREAM.workId, n: 6 }, SESSION)
    expect(again.ok).toBe(true)
    expect(again.chapter?.planConfirmedAt).toBe(confirmed.chapter?.planConfirmedAt)
    expect((await store.confirmChapterPlan({ workId: DREAM.workId, n: 42 }, SESSION)).error).toBe('missing')
  })

  it('foreshadowExit runs the three exits: resolve with answer, abandon, promote into a rule', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    // resolve needs an answer.
    expect((await store.foreshadowExit({ workId: DREAM.workId, id: 'm18', action: 'resolve' }, SESSION)).ok).toBe(false)
    const resolved = await store.foreshadowExit({ workId: DREAM.workId, id: 'm18', action: 'resolve', answer: '是艾文。' }, SESSION)
    expect(resolved.memory?.specifics).toMatchObject({ status: 'resolved', answer: '是艾文。' })
    // …and the plan brief now prints the reveal (防规划矛盾).
    const brief = await store.gatherBrief({ workId: DREAM.workId })
    expect(brief.data?.resolvedForeshadows.some(memory => memory.id === 'm18')).toBe(true)
    expect(brief.data?.activeForeshadows.some(memory => memory.id === 'm18')).toBe(false)
    // A settled card refuses further exits.
    expect((await store.foreshadowExit({ workId: DREAM.workId, id: 'm18', action: 'abandon' }, SESSION)).ok).toBe(false)
    const abandoned = await store.foreshadowExit({ workId: DREAM.workId, id: 'm15', action: 'abandon' }, SESSION)
    expect(abandoned.memory?.specifics?.status).toBe('abandoned')
    const promoted = await store.foreshadowExit({ workId: DREAM.workId, id: 'm12', action: 'promote', answer: '门后是梦主的童年场景。' }, SESSION)
    expect(promoted.ok).toBe(true)
    expect(promoted.promoted).toMatchObject({ type: 'semantic', layer: 'canon', kind: '世界', content: '门后是梦主的童年场景。', reviewed: true })
    expect(promoted.memory?.links?.resolvedBy).toBe(promoted.promoted?.id)
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.counts).toEqual({ active: 0, overdue: 0, resolved: 3, abandoned: 1 })
  })

  it('lists the mention journal for the dot strip, and retracts an automatic experience by id', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs, { ch5Phase: 'planning' })
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    const before = await store.listMentions({ workId: DREAM.workId, foreshadowId: 'm12' })
    expect(before.map(entry => entry.kind)).toEqual(['planted', 'advanced'])
    // Import lands an automatic experience WITH an id and the 自动 mark…
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: {
      experiences: [{ character_id: 'c1', entry: '推开了门缝', confidence: 'high', evidence_in_text: '指尖碰到门缝的边缘' }],
      recap: 'r',
    } }, SESSION)
    const landed = (await store.listExperiences({ workId: DREAM.workId, characterId: 'c1' })).find(entry => entry.chapter === 5 && entry.entry === '推开了门缝')
    expect(landed).toMatchObject({ id: 'e1', autoImported: true })
    // …and the retract gesture takes it back, every other line byte-identical.
    const retracted = await store.retractExperience({ workId: DREAM.workId, id: 'e1' }, SESSION)
    expect(retracted.ok).toBe(true)
    expect((await store.listExperiences({ workId: DREAM.workId })).some(entry => entry.id === 'e1')).toBe(false)
    const raw = fs.read(`${DREAM.stateRoot}/${DREAM.workId}/experiences.jsonl`)
    expect(raw.trim().split('\n')).toHaveLength(6)
    expect((await store.retractExperience({ workId: DREAM.workId, id: 'e1' }, SESSION)).error).toBe('missing')
  })
})
