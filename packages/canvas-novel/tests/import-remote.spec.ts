import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelRemoteService } from '../src/remote.ts'
import { NovelService } from '../src/store.ts'
import { parseNovelBinaryDocuments } from '../src/client/import-documents.ts'
import { FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'

const STATE = '/dsh/state/novel'
const WORKSPACE = '/home/user/workspace'
const WORK = 'canvas_import0001'
const SESSION_ID = SessionId('s-import')
const SESSION = { id: SESSION_ID, header: { cwd: WORKSPACE } } as unknown as Session
const temporary: string[] = []

function bench(mode: 'workspace-write' | 'read-only' = 'workspace-write', pick?: () => Promise<string | null>) {
  const fs = new FakeFs()
  fs.sandboxMode = mode
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx, new FakeCanvas())
  canvas.addBoard({ id: WORK, title: '导入作品', workspace: WORKSPACE })
  ctx.provide('sandboxPolicy', {
    resolve: ({ session }: { session: Session }) => ({ mode, workspaceRoot: WORKSPACE, sessionId: String(session.id) }),
  } as never)
  ctx.provide('sessions' as never, { get: (id: string) => id === SESSION_ID ? SESSION : undefined } as never)
  if (pick !== undefined) ctx.provide('directoryPicker' as never, { capability: () => ({ kind: 'native', pick }) } as never)
  const store = new NovelService(ctx, { stateRoot: STATE })
  ctx.provide('canvasNovel', store)
  const remote = new NovelRemoteService(ctx, {})
  return { fs, store, remote }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('novel import Remote', () => {
  it('writes imported chapters through the real store and makes them ready for reconciliation', async () => {
    const { fs, store, remote } = bench()
    expect(await remote.importOwnChapter(SESSION_ID, { canvasId: WORK, title: '第一章 门', text: '他推开门。' })).toEqual({ ok: true, n: 1 })
    expect(await remote.importOwnChapter(SESSION_ID, { canvasId: WORK, title: '第二章 叶', text: '叶子亮了。' })).toEqual({ ok: true, n: 2 })
    expect(fs.read(`${WORKSPACE}/导入作品/第1章.md`)).toBe('他推开门。')
    expect(fs.read(`${WORKSPACE}/导入作品/第2章.md`)).toBe('叶子亮了。')
    const read = await store.readChapter({ workId: WORK, n: 1 })
    expect(read.chapter).toMatchObject({ n: 1, title: '第一章 门', byUser: true })
    expect(read.phase).toBe('writing')
    const prepared = await store.extractPrepare({ workId: WORK, n: 1 })
    expect(prepared.ok).toBe(true)
    expect(prepared.text).toContain('他推开门。')
  })

  it('refuses a denied manuscript write without registering an empty chapter', async () => {
    const { store, remote } = bench('read-only')
    expect(await remote.importOwnChapter(SESSION_ID, { canvasId: WORK, title: '第一章', text: '正文。' })).toEqual({ ok: false, error: 'denied' })
    expect(await store.listChapters({ workId: WORK })).toEqual([])
  })

  it('never overwrites an existing manuscript that the chapter table does not know', async () => {
    const { fs, store, remote } = bench()
    const path = `${WORKSPACE}/导入作品/第1章.md`
    fs.seed(path, '别处已经写好的正文。')
    expect(await remote.importOwnChapter(SESSION_ID, { canvasId: WORK, title: '第一章', text: '不能覆盖。' })).toEqual({ ok: false, error: 'body-exists' })
    expect(fs.read(path)).toBe('别处已经写好的正文。')
    expect(await store.listChapters({ workId: WORK })).toEqual([])
  })

  it('keeps native selection on the host and imports its chapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'novel-remote-directory-'))
    temporary.push(root)
    await writeFile(join(root, '第一章.txt'), '第一章 门\n他推开门。')
    await writeFile(join(root, '第二章.txt'), '第二章 叶\n叶子亮了。')
    const pick = vi.fn(async () => root)
    const { store, remote } = bench('workspace-write', pick)
    expect(await remote.importDirectory(SESSION_ID, { path: root })).toMatchObject({ ok: false, error: 'unsupported' })
    expect(pick).not.toHaveBeenCalled()
    const directory = await remote.importDirectory(SESSION_ID)
    expect(pick).toHaveBeenCalledOnce()
    expect(directory.ok).toBe(true)
    const parsed = await parseNovelBinaryDocuments(directory.files)
    expect(parsed.drafts.map(draft => draft.title)).toEqual(['第一章 门', '第二章 叶'])
    for (const draft of parsed.drafts) {
      expect(await remote.importOwnChapter(SESSION_ID, { canvasId: WORK, title: draft.title, text: draft.text })).toMatchObject({ ok: true })
    }
    expect((await store.readChapter({ workId: WORK, n: 2 })).chapter).toMatchObject({ title: '第二章 叶', byUser: true })
    expect((await store.extractPrepare({ workId: WORK, n: 2 })).text).toContain('叶子亮了。')
  })
})
