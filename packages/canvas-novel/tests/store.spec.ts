/**
 * The store's core verbs on the《梦境监护者》seed and on a fresh work:
 * a work is a 长篇小说 canvas (served by the fake canvas), numbering rules
 * (n max+1, file from n, refs per numbering space), the session binding,
 * the review gate, live agent cards and their archive verb, the
 * ledger, the JSONL journals, and the re-rooted fence (the canvas store's
 * pattern).
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { manuscriptParagraphs, NovelService, resolveNovelStateRoot } from '../src/store.ts'
import { chapterFileName, chapterNumberOfFile, effectiveChapterPhase } from '../src/types.ts'
import { FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-1' } as unknown as Session

/** A store over a confining FakeFs (workspace-write) plus the fence ledger. */
function confiningStore(stateRoot = '/dsh/state/novel'): { store: NovelService; fs: FakeFs; canvas: FakeCanvas } {
  const fs = new FakeFs()
  fs.sandboxMode = 'workspace-write'
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx, new FakeCanvas())
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }: { session: Session }) => ({ mode: 'workspace-write', workspaceRoot: '/some/session/cwd', sessionId: String(session.id) }),
  } as never)
  return { store: new NovelService(ctx, { stateRoot }), fs, canvas }
}

/** A fresh 长篇小说 canvas with the workspace attached; its id is the work id. */
function freshWork(canvas: FakeCanvas, title: string, id = 'canvas_fresh0001'): string {
  canvas.addBoard({ id, title, workspace: '/home/user/workspace' })
  return id
}

describe('the novel store', () => {
  it('resolves the state root the datasets/canvas way (explicit → $DSH_HOME/state/novel → cwd)', () => {
    expect(resolveNovelStateRoot('/x')).toBe('/x')
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = '/dsh-home'
    expect(resolveNovelStateRoot(undefined)).toBe('/dsh-home/state/novel')
    if (home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = home
    expect(resolveNovelStateRoot('')).toContain('.dsh-novel')
  })

  it('a work is a novel canvas; a session writes into the canvas it is bound to', async () => {
    const { store, canvas } = confiningStore()
    const workId = freshWork(canvas, '测试作品')
    expect(await store.readWorkMeta(workId)).toEqual({ id: workId, title: '测试作品', workspace: '/home/user/workspace' })
    // A plain canvas, an unknown id and a malformed id are not works.
    canvas.addBoard({ id: 'canvas_plain0001', title: '杂记', genre: null })
    expect(await store.readWorkMeta('canvas_plain0001')).toBeUndefined()
    expect(await store.readWorkMeta('canvas_nothere01')).toBeUndefined()
    expect(await store.readWorkMeta('work-abcdef')).toBeUndefined()
    // The binding — never a focus — names the session's work.
    expect(await store.boundWork('s-1')).toBeUndefined()
    canvas.bind('s-1', workId)
    expect((await store.boundWork('s-1'))?.title).toBe('测试作品')
    expect(await store.boundWork('s-2')).toBeUndefined()
    canvas.bind('s-2', 'canvas_plain0001')
    expect(await store.boundWork('s-2')).toBeUndefined()
  })

  it('reads no work at all without the canvas (degrade, never explode)', async () => {
    const ctx = new Context()
    ctx.provide('fs', new FakeFs() as never)
    const store = new NovelService(ctx, { stateRoot: '/dsh/state/novel' })
    expect(await store.readWorkMeta(DREAM.workId)).toBeUndefined()
    expect(await store.boundWork('s-1')).toBeUndefined()
    expect((await store.writeCard({ workId: DREAM.workId, role: 'world', fields: { rule: '无处落卡。' } }, SESSION)).error).toBe('missing')
  })

  it('allocates chapter numbers max+1, names files from n, keeps seq as the sort key', async () => {
    const { store, canvas } = confiningStore()
    const workId = freshWork(canvas, '编号')
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
    const replanned = await store.writeChapter({ workId, n: 2, title: '第二章·改', plan: { summary: '新梗概' } }, SESSION)
    expect(replanned.chapter).toMatchObject({ n: 2, title: '第二章·改', file: '第2章.md' })
    expect(replanned.chapter?.plan).toEqual({ summary: '新梗概', beats: [], foreshadowOps: [], cast: [] })
    // A plan without its 梗概 is not a plan.
    expect((await store.writeChapter({ workId, n: 2, title: '第二章', plan: { goal: '旧形状' } }, SESSION)).ok).toBe(false)
  })

  it('derives 写作中/文件丢失 from the manuscript fact, and 审过 closes only an extracted chapter', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
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

  it('lands an agent card live: in the brief at once, ✗ archives', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const canvas = provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    const written = await store.writeCard({ workId: DREAM.workId, role: 'world', fields: { name: '钟楼', kind: '地点', rule: '钟楼是两层梦的接缝。' } }, SESSION)
    // The entry space is shared by rules and foreshadows: #18 is the max, so the new rule draws w19.
    expect(written).toMatchObject({ ok: true, ref: 'w19' })
    expect(canvas.card(DREAM.workId, written.cardId!)).toMatchObject({ status: 'kept', createdBy: 'agent' })
    // Live means canon: the brief carries it at once, no ✓ in between.
    const after = await store.gatherBrief({ workId: DREAM.workId })
    expect(after.data?.canonRules.some(view => view.text.includes('接缝'))).toBe(true)
    // ✗ archives a card — the seeded canvas-native proposal too; it stays on the board, hidden.
    expect((await store.archiveCard({ workId: DREAM.workId, id: 'w6' }, SESSION)).ok).toBe(true)
    expect(canvas.card(DREAM.workId, CARD.dreamLayers)?.status).toBe('archived')
    // A proposal needs every required field (a world card its name too); the next one draws max+1.
    expect((await store.writeCard({ workId: DREAM.workId, role: 'world', fields: {} }, SESSION)).error).toBe('invalid-name')
    expect((await store.writeCard({ workId: DREAM.workId, role: 'world', fields: { rule: '又一条。' } }, SESSION)).error).toBe('invalid-name')
    expect((await store.writeCard({ workId: DREAM.workId, role: 'world', fields: { name: '又一条', rule: '又一条。' } }, SESSION)).ref).toBe('w20')
    // A name a live card already holds is refused, naming that card.
    expect(await store.writeCard({ workId: DREAM.workId, role: 'world', fields: { name: '又一条', rule: '换个说法。' } }, SESSION))
      .toMatchObject({ ok: false, error: 'duplicate', ref: 'w20' })
    expect(await store.writeCard({ workId: DREAM.workId, role: 'character', fields: { name: '艾文' } }, SESSION))
      .toMatchObject({ ok: false, error: 'duplicate', ref: 'c2' })
    // The brief names a world card by its title.
    const named = await store.gatherBrief({ workId: DREAM.workId })
    expect(named.data?.canonRules.find(view => view.ref === 'w19')?.text).toBe('钟楼（地点）：钟楼是两层梦的接缝。')
  })

  it('reads the ledger off the seed (沉睡优先, health counts)', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.counts).toEqual({ active: 3, overdue: 3, resolved: 1, abandoned: 0 })
    expect(ledger.currentChapter).toBe(6)
    expect(ledger.active.map(view => view.cardId)).toEqual([CARD.formerKeeper, CARD.leafGlow, CARD.doorGap])
  })

  it('appends to the JSONL journals without rewriting history (bad lines drop out of the view only)', async () => {
    const { store, fs, canvas } = confiningStore()
    const workId = freshWork(canvas, '流水')
    const character = await store.writeCard({ workId, role: 'character', fields: { name: '甲' } }, SESSION)
    expect(character.ref).toBe('c1')
    // A hand-corrupted line stays on disk but drops out of the view.
    fs.seed(`/dsh/state/novel/${workId}/experiences.jsonl`, '{"characterId":"c1","chapter":1,"entry":"好行","createdAt":"t"}\nnot-json\n')
    const before = await store.listExperiences({ workId })
    expect(before).toHaveLength(1)
    // …and an import's append keeps both the good line and the corrupt one.
    fs.seed(`/dsh/state/novel/${workId}/chapters.json`, `${JSON.stringify({ version: 1, chapters: [
      { n: 1, seq: 1, title: '一', file: '第1章.md', phase: 'planning', sessionIds: [], createdAt: 't', updatedAt: 't' },
    ] }, null, 2)}\n`)
    fs.seed(`/dsh/state/novel/${workId}/pending.json`, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`)
    fs.seed(`${'/home/user/workspace'}/流水/第1章.md`, '正文里有甲出场。\n')
    const report = await store.extractImport({ workId, n: 1, payload: {
      experiences: [{ character_id: 'c1', entry: '甲出场了', confidence: 'high', evidence_in_text: '甲出场' }],
    } }, SESSION)
    expect(report.ok).toBe(true)
    const raw = fs.read(`/dsh/state/novel/${workId}/experiences.jsonl`)
    expect(raw).toContain('not-json')
    expect(raw.trim().split('\n')).toHaveLength(3)
    const after = await store.listExperiences({ workId })
    expect(after).toHaveLength(2)
  })

  it('refuses to write what it cannot read (corrupt files never get clobbered)', async () => {
    const { store, fs, canvas } = confiningStore()
    const workId = freshWork(canvas, '坏档')
    fs.seed(`/dsh/state/novel/${workId}/chapters.json`, '{broken json')
    const outcome = await store.writeChapter({ workId, title: '不该落库' }, SESSION)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('io')
    expect(fs.read(`/dsh/state/novel/${workId}/chapters.json`)).toBe('{broken json')
  })

  it('a read-only deployment denies every state write (the fence keeps the mode)', async () => {
    const fs = new FakeFs()
    fs.sandboxMode = 'read-only'
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: '/x' }) } as never)
    const store = new NovelService(ctx, { stateRoot: '/dsh/state/novel' })
    const written = await store.writeChapter({ workId: DREAM.workId, title: '写不进去' }, SESSION)
    expect(written.ok).toBe(false)
    expect(written.error).toBe('denied')
  })

  it('writeChapter with content writes the body fenced BEFORE registering — a denied write refuses the registration', async () => {
    const { store, fs, canvas } = confiningStore()
    const workId = freshWork(canvas, '落盘')
    // content given: the body lands at <workspace>/<title>/第1章.md and the chapter registers.
    const written = await store.writeChapter({ workId, title: '第一章', content: '开头三段。\n' }, SESSION)
    expect(written.ok).toBe(true)
    expect(fs.read('/home/user/workspace/落盘/第1章.md')).toBe('开头三段。\n')
    expect(written.chapter).toMatchObject({ n: 1, file: '第1章.md' })
    // The write carried the session's mode with the boundary re-rooted at the WORK's workspace.
    expect(fs.policies.every(policy => policy?.workspaceRoot === '/home/user/workspace' || policy?.workspaceRoot === '/dsh/state/novel')).toBe(true)
    // The chapter reads back as 写作中 (planning + body).
    const listed = await store.listChapters({ workId })
    expect(listed[0]?.phase).toBe('writing')
    // A denied body write refuses the registration: no chapter row appears
    // (a read-only deployment's policy refuses every write).
    const denied = new FakeFs()
    denied.sandboxMode = 'read-only'
    const ctxDenied = new Context()
    ctxDenied.provide('fs', denied as never)
    provideCanvas(ctxDenied, new FakeCanvas().addBoard({ id: 'canvas_denied0001', title: '拒', workspace: '/outside' }))
    ctxDenied.provide('sandboxPolicy', {
      resolve: ({ session }: { session: Session }) => ({ mode: 'read-only', workspaceRoot: '/outside', sessionId: String(session.id) }),
    } as never)
    const deniedStore = new NovelService(ctxDenied, { stateRoot: '/dsh/state/novel' })
    const refused = await deniedStore.writeChapter({ workId: 'canvas_denied0001', title: '第一章', content: '写不进去。' }, SESSION)
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe('denied')
    expect((await deniedStore.listChapters({ workId: 'canvas_denied0001' })).length).toBe(0)
  })

  it('a canvas without a workspace keeps the plan but refuses a body (no-workspace)', async () => {
    const { store, canvas } = confiningStore()
    canvas.addBoard({ id: 'canvas_bare00001', title: '无处' })
    const planned = await store.writeChapter({ workId: 'canvas_bare00001', title: '第一章' }, SESSION)
    expect(planned.ok).toBe(true)
    const refused = await store.writeChapter({ workId: 'canvas_bare00001', n: 1, title: '第一章', content: '没地方放。' }, SESSION)
    expect(refused).toEqual({ ok: false, error: 'no-workspace' })
  })

  it('paragraphs a manuscript written one line per paragraph, and leaves a spaced one alone', () => {
    expect(manuscriptParagraphs('第一段。\n第二段。\n')).toBe('第一段。\n\n第二段。\n')
    expect(manuscriptParagraphs('\r\n  缩进的一段。\r\n“对白。”')).toBe('  缩进的一段。\n\n“对白。”\n')
    const spaced = '第一段。\n\n第二段，\n续行。\n'
    expect(manuscriptParagraphs(spaced)).toBe(spaced)
    expect(manuscriptParagraphs('只有一段。')).toBe('只有一段。')
  })

  it('the chapter file vocabulary round-trips (the invariant probe shares it)', () => {
    expect(chapterNumberOfFile(chapterFileName(60))).toBe(60)
    expect(chapterNumberOfFile('第6章.txt')).toBeUndefined()
    expect(chapterNumberOfFile('第六十章.md')).toBeUndefined()
  })

  it('writeCard with a ref merges fields into the card in place; archive retires it from the brief', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const canvas = provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    const revised = await store.writeCard({ workId: DREAM.workId, role: 'world', id: 'w2', fields: { rule: '蓝色叶子是梦主意识碎片的载体，见光即醒。', bogus: 'x' } }, SESSION)
    expect(revised).toMatchObject({ ok: true, cardId: CARD.leafCarrier, ref: 'w2', ignored: ['bogus'] })
    expect(canvas.card(DREAM.workId, CARD.leafCarrier)?.fields?.rule).toBe('蓝色叶子是梦主意识碎片的载体，见光即醒。')
    const brief = await store.gatherBrief({ workId: DREAM.workId })
    expect(brief.data?.canonRules.find(view => view.cardId === CARD.leafCarrier)?.text).toContain('见光即醒')
    // A ref of another role, or an empty patch, refuses.
    expect((await store.writeCard({ workId: DREAM.workId, role: 'foreshadow', id: 'w2', fields: { question: 'x' } }, SESSION)).ok).toBe(false)
    expect((await store.writeCard({ workId: DREAM.workId, role: 'world', id: 'w2', fields: { bogus: 'x' } }, SESSION)).error).toBe('invalid-name')
    // Archive retires the kept card; a second archive refuses.
    expect((await store.archiveCard({ workId: DREAM.workId, id: 'w2' }, SESSION)).ok).toBe(true)
    const after = await store.gatherBrief({ workId: DREAM.workId })
    expect(after.data?.canonRules.some(view => view.cardId === CARD.leafCarrier)).toBe(false)
    expect((await store.archiveCard({ workId: DREAM.workId, id: 'w2' }, SESSION)).ok).toBe(false)
  })

  it('confirmChapterPlan stamps the gate and is idempotent; a planless chapter refuses', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    expect((await store.confirmChapterPlan({ workId: DREAM.workId, n: 1 }, SESSION)).ok).toBe(false) // no plan
    const confirmed = await store.confirmChapterPlan({ workId: DREAM.workId, n: 6 }, SESSION)
    expect(confirmed.ok).toBe(true)
    expect(confirmed.chapter?.planConfirmedAt).toBeDefined()
    const again = await store.confirmChapterPlan({ workId: DREAM.workId, n: 6 }, SESSION)
    expect(again.ok).toBe(true)
    expect(again.chapter?.planConfirmedAt).toBe(confirmed.chapter?.planConfirmedAt)
    expect((await store.confirmChapterPlan({ workId: DREAM.workId, n: 42 }, SESSION)).error).toBe('missing')
  })

  it('a foreshadow exits through its status field: 已揭晓 with an answer, 已放弃', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs)
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    const resolved = await store.writeCard({ workId: DREAM.workId, role: 'foreshadow', id: '#18', fields: { status: '已揭晓', answer: '是艾文。' } }, SESSION)
    expect(resolved.ok).toBe(true)
    // …and the plan brief now prints the reveal (防规划矛盾).
    const brief = await store.gatherBrief({ workId: DREAM.workId })
    expect(brief.data?.resolvedForeshadows.find(view => view.cardId === CARD.formerKeeper)?.answer).toBe('是艾文。')
    expect(brief.data?.activeForeshadows.some(view => view.cardId === CARD.formerKeeper)).toBe(false)
    // A value outside the select's options is ignored, not written.
    const bogus = await store.writeCard({ workId: DREAM.workId, role: 'foreshadow', id: '#15', fields: { status: '搁置' } }, SESSION)
    expect(bogus.ok).toBe(false)
    expect(bogus.ignored).toEqual(['status'])
    await store.writeCard({ workId: DREAM.workId, role: 'foreshadow', id: '#15', fields: { status: '已放弃' } }, SESSION)
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.counts).toEqual({ active: 1, overdue: 1, resolved: 2, abandoned: 1 })
  })

  it('lists the mention journal for the dot strip, and retracts an automatic experience by id', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs, { ch5Phase: 'planning' })
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
    const before = await store.listMentions({ workId: DREAM.workId, foreshadowId: CARD.doorGap })
    expect(before.map(entry => entry.kind)).toEqual(['planted', 'advanced'])
    // Import lands an automatic experience WITH an id and the 自动 mark…
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: {
      experiences: [{ character_id: 'c1', entry: '推开了门缝', confidence: 'high', evidence_in_text: '指尖碰到门缝的边缘' }],
      recap: 'r',
    } }, SESSION)
    const landed = (await store.listExperiences({ workId: DREAM.workId, characterId: CARD.zhao })).find(entry => entry.chapter === 5 && entry.entry === '推开了门缝')
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
