import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import { NovelRemoteService } from '../src/remote.ts'
import { novelGenreAgent } from '../src/genre-agent.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const session = { id: 's-delete', snapshotEvents: () => [{ type: 'user/message', seq: 1 }] } as unknown as Session

function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  canvas.addShelves(DREAM.workId)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  ctx.provide('canvasNovel', store as never)
  return { ctx, fs, store, canvas }
}

async function previewAndApply(store: NovelService, chapters: readonly number[]) {
  const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters }, session)
  if (!preview.ok) throw new Error(`preview failed: ${preview.error}`)
  const applied = await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)
  if (!applied.ok) throw new Error(`apply failed: ${applied.error}`)
  return { preview, applied }
}

const activeNumbers = async (store: NovelService): Promise<number[]> => (await store.listChapters({ workId: DREAM.workId })).map(row => row.chapter.n)

describe('chapter deletion with recyclable snapshots', () => {
  it('deletes bodies and chapter-owned memory, restores one generation, and reuses a number safely', async () => {
    const { store, fs } = bench()
    const { preview } = await previewAndApply(store, [3, 6])
    expect(preview.operation.chapters.map(row => row.record.n)).toEqual([3, 6])
    expect(preview.operation.size).toBeGreaterThan(0)
    expect(await activeNumbers(store)).toEqual([1, 2, 4, 5])
    expect(() => fs.read(join(DREAM.workspace, DREAM.title, '第3章.md'))).toThrow()
    expect((await store.listExperiences({ workId: DREAM.workId })).some(row => row.chapter === 3)).toBe(false)
    expect((await store.listRelationJournal({ workId: DREAM.workId })).some(row => row.chapter === 3)).toBe(false)
    expect((await store.listExperiences({ workId: DREAM.workId })).some(row => row.chapter === 4)).toBe(true)
    const table = JSON.parse(fs.read(join(DREAM.stateRoot, DREAM.workId, 'chapters.json'))) as { chapters: { n: number; title: string; deletionId?: string }[] }
    expect(table.chapters.find(row => row.n === 3)).toMatchObject({ title: '已删除章节', deletionId: preview.operation.id })
    expect((await store.listChapterDeletions(DREAM.workId)).map(row => row.id)).toEqual([preview.operation.id])

    const restored = await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [3] }, session)
    expect(restored.ok).toBe(true)
    expect(restored.ok && restored.restored).toBe(1)
    const third = await store.readChapter({ workId: DREAM.workId, n: 3 })
    expect(third.ok && third.phase).toBe('writing')
    expect(third.ok && third.chapter?.id).toMatch(/^ch_/)
    expect(third.ok && third.chapter?.id).not.toBe('ch:3')
    expect(third.ok && third.body).toContain('半页守则')
    expect((await store.listExperiences({ workId: DREAM.workId })).some(row => row.chapter === 3)).toBe(false)
    expect(await store.listChapterDeletions(DREAM.workId)).toHaveLength(1)

    const sixth = await store.writeChapter({ workId: DREAM.workId, title: '新的第六章' }, session)
    expect(sixth.ok && sixth.chapter).toMatchObject({ n: 6, title: '新的第六章' })
    expect(sixth.ok && sixth.chapter?.plan).toBeUndefined()
    expect(sixth.ok && sixth.chapter?.id).toMatch(/^ch_/)
    const conflict = await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [6] }, session)
    expect(conflict).toMatchObject({ ok: false, error: 'duplicate' })
    const next = await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [6], position: 'next' }, session)
    expect(next.ok).toBe(true)
    expect(next.ok && next.operation.status).toBe('closed')
    expect(next.ok && next.operation.chapters).toEqual([])
    expect(next.ok && next.operation.finished[6]).toBe('restored')
    expect(await activeNumbers(store)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('purges one snapshot without reactivating it, then restores the other', async () => {
    const { store } = bench()
    const { preview } = await previewAndApply(store, [3, 4])
    const purged = await store.purgeChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [3] }, session)
    expect(purged.ok).toBe(true)
    expect(purged.ok && purged.operation.chapters.map(row => row.record.n)).toEqual([4])
    expect(purged.ok && purged.operation.finished[3]).toBe('purged')
    expect(await activeNumbers(store)).toEqual([1, 2, 5, 6])
    const restored = await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [4] }, session)
    expect(restored.ok).toBe(true)
    expect(restored.ok && restored.operation.status).toBe('closed')
    expect(await activeNumbers(store)).toEqual([1, 2, 4, 5, 6])
    expect(await store.listChapterDeletions(DREAM.workId)).toEqual([])
  })

  it('reads retained body and plan snapshots only until they are purged or restored', async () => {
    const { ctx, store } = bench()
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3, 6] }, session)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(await store.readChapterDeletionSnapshot({ workId: DREAM.workId, deletionId: preview.operation.id, chapter: 3 })).toBeUndefined()
    expect(await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)).toMatchObject({ ok: true })
    const body = await store.readChapterDeletionSnapshot({ workId: DREAM.workId, deletionId: preview.operation.id, chapter: 3 })
    expect(body?.body).toContain('半页守则')
    expect(body?.record.n).toBe(3)
    const plan = await store.readChapterDeletionSnapshot({ workId: DREAM.workId, deletionId: preview.operation.id, chapter: 6 })
    expect(plan?.body).toBe('')
    expect(plan?.record.plan?.summary).toBeTruthy()
    const remote = new NovelRemoteService(ctx)
    const wire = await remote.chapterDeletionSnapshot({ canvasId: DREAM.workId, deletionId: preview.operation.id, chapter: 3 })
    expect(wire).toMatchObject({ ok: true, snapshot: { n: 3, title: body?.record.title, body: body?.body } })
    expect(wire.ok && wire.snapshot?.plan).toBeUndefined()
    expect(JSON.stringify(wire)).not.toContain('"derived"')
    expect(await store.purgeChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [3] }, session)).toMatchObject({ ok: true })
    expect(await store.readChapterDeletionSnapshot({ workId: DREAM.workId, deletionId: preview.operation.id, chapter: 3 })).toBeUndefined()
    expect(await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [6] }, session)).toMatchObject({ ok: true })
    expect(await store.readChapterDeletionSnapshot({ workId: DREAM.workId, deletionId: preview.operation.id, chapter: 6 })).toBeUndefined()
  })

  it('requires a later user message for an agent apply', async () => {
    const { store } = bench()
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3] }, session, true)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session, true)).toMatchObject({ ok: false, error: 'plan-unseen' })
    const confirmed = { ...session, snapshotEvents: () => [{ type: 'user/message', seq: 2 }] } as unknown as Session
    const applied = await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, confirmed, true)
    expect(applied.ok).toBe(true)
    expect(await activeNumbers(store)).toEqual([1, 2, 4, 5, 6])
  })

  it('refuses a stale preview without touching the body or registration', async () => {
    const { store, fs } = bench()
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3] }, session)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const changed = await store.writeChapter({ workId: DREAM.workId, n: 3, title: '刚改过标题' }, session)
    expect(changed.ok).toBe(true)
    expect(await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)).toMatchObject({ ok: false, error: 'stale' })
    expect((await store.readChapter({ workId: DREAM.workId, n: 3 })).ok).toBe(true)
    expect(fs.read(join(DREAM.workspace, DREAM.title, '第3章.md'))).toContain('半页守则')
    expect(await store.listChapterDeletions(DREAM.workId)).toEqual([])
  })

  it('keeps reads consistent during cleanup failure, retries, and only then allows number reuse', async () => {
    const { store, fs } = bench()
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3, 6] }, session)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    fs.deleteFailures.add(join(DREAM.workspace, DREAM.title, '第3章.md'))
    const applied = await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)
    expect(applied.ok).toBe(true)
    expect(applied.ok && applied.cleanupPending).toBe(true)
    expect(applied.ok && applied.operation.status).toBe('cleanup-pending')
    expect(await activeNumbers(store)).toEqual([1, 2, 4, 5])
    expect((await store.listExperiences({ workId: DREAM.workId })).some(row => row.chapter === 3)).toBe(false)
    expect(await store.writeChapter({ workId: DREAM.workId, title: '不能抢号' }, session)).toMatchObject({ ok: false, error: 'cleanup-pending' })
    expect(await store.restoreChapters({ workId: DREAM.workId, deletionId: preview.operation.id, chapters: [3] }, session)).toMatchObject({ ok: false, error: 'cleanup-pending' })
    const retried = await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)
    expect(retried.ok).toBe(true)
    expect(retried.ok && retried.cleanupPending).toBe(false)
    expect(retried.ok && retried.operation.status).toBe('active')
    expect(() => fs.read(join(DREAM.workspace, DREAM.title, '第3章.md'))).toThrow()
    const created = await store.writeChapter({ workId: DREAM.workId, title: '新的第六章' }, session)
    expect(created.ok && created.chapter).toMatchObject({ n: 6, title: '新的第六章' })
    expect(created.ok && created.chapter?.id).toMatch(/^ch_/)
  })

  it('expires abandoned previews instead of retaining their snapshots forever', async () => {
    const { store, fs } = bench()
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3] }, session)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const file = join(DREAM.stateRoot, DREAM.workId, 'deletions', `${preview.operation.id}.json`)
    const operation = JSON.parse(fs.read(file)) as { updatedAt: string }
    operation.updatedAt = '2000-01-01T00:00:00.000Z'
    fs.seed(file, `${JSON.stringify(operation, null, 2)}\n`)
    expect(await store.listChapterDeletions(DREAM.workId)).toEqual([])
    expect(await fs.stat(file)).toBeUndefined()
  })

  it('keeps manual memory corrections while removing chapter-owned rows', async () => {
    const { store } = bench()
    const corrected = await store.correctMind({ workId: DREAM.workId, cardId: CARD.zhao, kind: 'intent', text: '用户手动补充的打算' }, session)
    expect(corrected.ok).toBe(true)
    await previewAndApply(store, [6])
    const minds = await store.listMinds({ workId: DREAM.workId })
    expect(minds.some(row => row.chapter === 6 && row.origin === 'manual' && row.text === '用户手动补充的打算')).toBe(true)
  })

  it('archives cascade cards on deletion and permanently removes them only when purged', async () => {
    const { store, canvas, fs } = bench()
    const agent = novelGenreAgent(store)
    expect(await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '临时地点', rule: '只出现在旧章' } }, session)).not.toContain('失败')
    const cardId = (await store.readEntries(DREAM.workId))!.rules.find(row => row.name === '临时地点')!.cardId
    const file = join(DREAM.stateRoot, DREAM.workId, 'chapters.json')
    const table = JSON.parse(fs.read(file)) as { chapters: { n: number; newCards?: string[]; settings?: string[] }[] }
    const third = table.chapters.find(row => row.n === 3)!
    third.newCards = [cardId]
    third.settings = [cardId]
    fs.seed(file, `${JSON.stringify(table, null, 2)}\n`)
    const preview = await store.previewChapterDeletion({ workId: DREAM.workId, chapters: [3] }, session)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.operation.cascadeCards.map(row => row.id)).toEqual([cardId])
    expect(await store.applyChapterDeletion({ workId: DREAM.workId, deletionId: preview.operation.id }, session)).toMatchObject({ ok: true })
    expect(canvas.card(DREAM.workId, cardId)?.status).toBe('archived')
    const purged = await store.purgeChapters({ workId: DREAM.workId, deletionId: preview.operation.id }, session)
    expect(purged.ok).toBe(true)
    expect(canvas.card(DREAM.workId, cardId)).toBeUndefined()
  })
})
