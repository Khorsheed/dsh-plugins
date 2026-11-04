import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { bodyFingerprint } from '../src/types.ts'
import { NovelService } from '../src/store.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION_ID = 's-feedback'

function bench(turn = 1) {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const chapterFile = `${DREAM.stateRoot}/${DREAM.workId}/chapters.json`
  const table = JSON.parse(fs.read(chapterFile)) as { chapters: Record<string, unknown>[] }
  table.chapters.forEach(chapter => { chapter.byUser = true })
  fs.seed(chapterFile, JSON.stringify(table))
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  canvas.bind(SESSION_ID, DREAM.workId)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  const session = { id: SESSION_ID, snapshotEvents: () => [{ type: 'turn/start', data: { turn } }] } as unknown as Session
  return { fs, store, session }
}

async function idea(store: NovelService, text = '这里补一拍人物心理。') {
  const read = await store.readChapter({ workId: DREAM.workId, n: 1 })
  const body = read.body ?? ''
  const quote = '监护所的钟没有影子'
  const start = body.indexOf(quote)
  return store.addChapterFeedback({
    workId: DREAM.workId,
    idea: {
      chapter: 1,
      quote,
      start,
      end: start + quote.length,
      before: body.slice(Math.max(0, start - 120), start),
      after: body.slice(start + quote.length, start + quote.length + 120),
      baseBodyHash: bodyFingerprint(body) ?? '',
      text,
    },
  }, SESSION)
}

const SESSION = { id: SESSION_ID } as unknown as Session

async function prepared(store: NovelService, session: Session) {
  await idea(store)
  const result = await store.prepareChapterFeedback({ workId: DREAM.workId, n: 1 }, session)
  expect(result.ok).toBe(true)
  return result
}

describe('chapter feedback lifecycle', () => {
  it('archives only after the edited request, this chapter write, and a normal turn end', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    const edited = `${draft.text!}\n\n请保留现在的叙述口吻。`
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: edited }, session)
    await store.observeChapterFeedbackSubmission(session, edited)
    let view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches[0]).toMatchObject({ status: 'sent', turn: 1, submittedText: edited })
    expect(view.ideas).toHaveLength(0)

    const written = await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', content: '赵启明先听见了钟声，然后才看见没有影子的钟。', replace: true }, session)
    expect(written.ok).toBe(true)
    view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches[0]?.status).toBe('written')
    expect(view.batches[0]?.write?.bodyHash).toBe(bodyFingerprint('赵启明先听见了钟声，然后才看见没有影子的钟。'))

    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches).toHaveLength(1)
    expect(view.batches[0]?.status).toBe('archived')
    expect(view.batches[0]?.submittedText).toBe(edited)

    await store.addChapterFeedback({ workId: DREAM.workId, idea: { chapter: 1, text: '下一批再看结尾。', baseBodyHash: '' } }, session)
    view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.ideas.map(row => row.text)).toEqual(['下一批再看结尾。'])
    expect(view.batches[0]?.status).toBe('archived')
  })

  it('does not archive an unsent draft and recalls it with its ideas', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', content: '别的请求改了正文。', replace: true }, session)
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    const before = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(before.batches[0]?.status).toBe('drafted')
    expect((await store.recallChapterFeedback({ workId: DREAM.workId, n: 1, batchId: draft.batchId! }, session)).ok).toBe(true)
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).ideas).toHaveLength(1)
  })

  it('does not match an unrelated message, even if the chapter changes', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, '改发一条无关消息。')
    await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', content: '无关请求的正文。', replace: true }, session)
    const view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches[0]?.status).toBe('drafted')
    expect((await store.recallChapterFeedback({ workId: DREAM.workId, n: 1, batchId: draft.batchId! }, session)).ok).toBe(true)
  })

  it('keeps a sent batch open when this turn only discusses or writes another chapter', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, draft.text!)
    await store.writeChapter({ workId: DREAM.workId, n: 2, title: '蓝叶', content: '第二章被改，不是本批的第一章。', replace: true }, session)
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    const view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches[0]).toMatchObject({ status: 'sent', notice: 'no-write' })
    expect(view.batches[0]?.write).toBeUndefined()
  })

  it('refuses to overwrite a moved chapter and keeps the conflict visible', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, draft.text!)
    const current = await store.readChapter({ workId: DREAM.workId, n: 1 })
    await store.editChapterBody({ workId: DREAM.workId, n: 1, text: '用户先改过的正文。', baseHash: bodyFingerprint(current.body ?? '') }, session)
    const written = await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', content: '旧批次覆盖版本。', replace: true }, session)
    expect(written).toMatchObject({ ok: false, error: 'stale' })
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]).toMatchObject({ status: 'sent', notice: 'stale' })
    expect((await store.readChapter({ workId: DREAM.workId, n: 1 })).body).toBe('用户先改过的正文。')
  })

  it('supports delete, undo, and an interrupted turn without archiving', async () => {
    const { store, session } = bench()
    const added = await idea(store)
    expect((await store.deleteChapterFeedback({ workId: DREAM.workId, n: 1, id: added.idea!.id }, session)).ok).toBe(true)
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).ideas).toHaveLength(0)
    expect((await store.restoreChapterFeedback({ workId: DREAM.workId, idea: added.idea! }, session)).ok).toBe(true)
    const draft = await store.prepareChapterFeedback({ workId: DREAM.workId, n: 1 }, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, draft.text!)
    await store.finishChapterFeedbackTurn(session, 1, 'interrupted')
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]).toMatchObject({ status: 'sent', notice: 'interrupted' })
    expect((await store.recallChapterFeedback({ workId: DREAM.workId, n: 1, batchId: draft.batchId! }, session)).ok).toBe(true)
  })

  it('accepts a late composer candidate only when it matches the completed turn', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.observeChapterFeedbackSubmission(session, draft.text!)
    await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', content: '本轮已经写入的正文。', replace: true }, session)
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]?.status).toBe('drafted')
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]?.status).toBe('archived')
  })

  it('counts an agent rewrite of a user original instead of treating it as a panel edit', async () => {
    const { store, session } = bench()
    const draft = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, draft.text!)
    const written = await store.writeChapter({ workId: DREAM.workId, n: 1, title: '入职', byUser: true, content: 'Agent 修改后的用户原稿。', replace: true }, session)
    expect(written.ok).toBe(true)
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]?.status).toBe('written')
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]?.status).toBe('archived')
  })

  it('archives a host-prefixed request after a verified direct chapter write', async () => {
    const { fs, store, session } = bench()
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'tool/call', data: { turn: 1, name: 'bash', callId: 'c-direct', arguments: JSON.stringify({ command: "python3 - <<'PY'\np=Path('梦境监护者/第1章.md')\np.write_text(p.read_text().replace('旧句', '新句'))\nPY" }) } },
      { type: 'tool/result', data: { message: { source: { callId: 'c-direct' } } } },
    ]
    Object.assign(session, { snapshotEvents: () => events })
    const draft = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: draft.batchId!, text: draft.text! }, session)
    await store.observeChapterFeedbackSubmission(session, `你现在是本房间的协调者。\n【协调者交接】\n\n${draft.text!}`)
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]?.status).toBe('sent')
    fs.seed(`${DREAM.workspace}/${DREAM.title}/第1章.md`, 'Bash 直接修改后的正文。')
    await store.finishChapterFeedbackTurn(session, 1, 'completed')
    expect((await store.chapterFeedback({ workId: DREAM.workId, n: 1 })).batches[0]).toMatchObject({ status: 'archived', submittedText: draft.text })
  })

  it('prepares the next batch while the earlier one is still open', async () => {
    const { store, session } = bench()
    const first = await prepared(store, session)
    await store.submitChapterFeedbackCandidate({ workId: DREAM.workId, batchId: first.batchId!, text: first.text! }, session)
    await store.observeChapterFeedbackSubmission(session, first.text!)
    await idea(store, '上批还没结束，这一条进入下一批。')
    const second = await store.prepareChapterFeedback({ workId: DREAM.workId, n: 1 }, session)
    expect(second.ok).toBe(true)
    expect(second.batchId).not.toBe(first.batchId)
    const view = await store.chapterFeedback({ workId: DREAM.workId, n: 1 })
    expect(view.batches).toHaveLength(2)
    expect(view.batches.find(batch => batch.id === first.batchId)?.status).toBe('sent')
    const next = view.batches.find(batch => batch.id === second.batchId)
    expect(next?.status).toBe('drafted')
    expect(next?.ideas.map(row => row.text)).toEqual(['上批还没结束，这一条进入下一批。'])
  })
})
