import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { BrowserCheckResult, BrowserChecker } from '../src/checks.ts'
import { GameService } from '../src/store.ts'

/** A checker that answers whatever the spec queued, recording what it saw. */
class FakeChecker implements BrowserChecker {
  next: BrowserCheckResult = { failures: [], passed: 1 }
  runs: { files: string[]; tests: string[] }[] = []
  async run(files: Record<string, unknown>, tests: Record<string, string>): Promise<BrowserCheckResult> {
    this.runs.push({ files: Object.keys(files).sort(), tests: Object.keys(tests) })
    return this.next
  }
  async dispose(): Promise<void> {}
}

let dir: string
let workspace: string
let checker: FakeChecker
let store: GameService
let trashed: string[]
let failTrash = false
const session = (id = 's1'): Session => ({ id, header: { cwd: workspace } }) as unknown as Session

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'game-store-'))
  workspace = join(dir, 'ws')
  await mkdir(workspace)
  checker = new FakeChecker()
  const ctx = { fs: { sandboxMode: undefined }, get: () => undefined } as unknown as Context
  trashed = []
  store = new GameService(ctx, { stateRoot: join(dir, 'state') }, { checker, writer: put, trash: async folder => {
    if (failTrash) throw new Error('磁盘不同')
    const to = join(dir, 'trash', String(trashed.length))
    await mkdir(join(dir, 'trash'), { recursive: true })
    await rename(folder, to)
    trashed.push(folder)
    return to
  } })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function created() {
  const result = await store.create({ title: 'Lighthouse', pitch: '守住灯塔到天亮', elementTypes: '角色、敌人', artStyle: 'pixel' }, session())
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.project
}

describe('GameService', () => {
  it('refuses to create past the gate, then creates, binds and writes the first files', async () => {
    const refused = await store.create({ title: 'X' }, session())
    expect(refused).toMatchObject({ ok: false })
    expect('missing' in refused && refused.missing.length).toBe(3)

    const project = await created()
    expect(project.root).toBe(join(workspace, 'lighthouse'))
    expect((await store.boundProject('s1'))?.id).toBe(project.id)
    expect(JSON.parse(await readFile(join(project.root, 'game.json'), 'utf8'))).toMatchObject({ id: project.id, artStyle: 'pixel', autoConfirm: true })
    const view = await store.view(project.id)
    // The one-pager lives in game.json; no chapter restates it at creation.
    expect(view?.chapters[0]).toMatchObject({ id: 'pillars', status: 'todo', text: '' })
    expect(view?.chapters.find(c => c.id === 'core-loop')?.status).toBe('todo')
    expect(view?.hasEntry).toBe(false)

    const second = await store.create({ title: 'Lighthouse', pitch: 'p', elementTypes: '角色', artStyle: 'flat' }, session('s2'))
    expect(second.ok && second.project.root).toBe(join(workspace, 'lighthouse-2'))
  })

  it('skips projects without an entry, deploys a passing turn, and skips an unchanged one', async () => {
    const project = await created()
    expect((await store.checkTurn(session(), 0, 2)).kind).toBe('skip')

    await put(join(project.root, 'index.html'), '<script type="module" src="src/main.js"></script>')
    await put(join(project.root, 'src/main.js'), 'window.dshGame = { ready: true, step() {}, input() {}, state() { return {} } }')
    await put(join(project.root, 'tests/move.test.js'), 'test("x", () => {})')
    await put(join(project.root, 'design/core-loop.md'), '# loop')
    const outcome = await store.checkTurn(session(), 0, 2)
    expect(outcome).toMatchObject({ kind: 'pass', deployed: { version: 1 } })
    expect(checker.runs[0]).toEqual({ files: ['_dsh/runtime.js', 'game.json', 'index.html', 'src/main.js'], tests: ['tests/move.test.js'] })

    const bundle = await store.bundle(project.id)
    expect(bundle.ok && Object.keys(bundle.bundle.files).sort()).toEqual(['_dsh/runtime.js', 'game.json', 'index.html', 'src/main.js'])
    expect((await store.view(project.id))?.chapters.find(c => c.id === 'playtest')?.text).toContain('v1 通过检查')

    // A design-doc edit is not a build change.
    await put(join(project.root, 'design/core-loop.md'), '# loop v2')
    expect((await store.checkTurn(session(), 0, 2)).kind).toBe('skip')
    expect(checker.runs).toHaveLength(1)
  })

  it('records failures, gives up at the cap, and keeps the play area on the last good version', async () => {
    const project = await created()
    await put(join(project.root, 'index.html'), '<p>hi</p>')
    expect((await store.checkTurn(session(), 0, 2)).kind).toBe('pass')

    await put(join(project.root, 'index.html'), '<p>broken</p>')
    await put(join(project.root, 'elements/a.json'), '{"id":"a","name":"甲","type":"道具"}')
    checker.next = { failures: [{ where: 'smoke', message: '运行报错' }], passed: 0 }
    const first = await store.checkTurn(session(), 0, 2)
    expect(first.kind).toBe('fail')
    if (first.kind !== 'fail') return
    expect(first.record.failures.map(f => f.where)).toEqual(['elements/a.json', 'smoke'])
    expect(first.record.gaveUp).toBeUndefined()

    const last = await store.checkTurn(session(), 2, 2)
    expect(last).toMatchObject({ kind: 'fail', record: { gaveUp: true } })
    // Given up on this exact build: the next turn does not re-run it.
    expect((await store.checkTurn(session(), 0, 2)).kind).toBe('skip')
    expect((await store.view(project.id))?.current?.version).toBe(1)
  })

  it('keeps a poster per version, never another build\'s', async () => {
    const project = await created()
    await put(join(project.root, 'index.html'), '<p>v1</p>')
    checker.next = { failures: [], passed: 1, screenshot: Buffer.from('poster-one').toString('base64') }
    await store.checkTurn(session(), 0, 2)
    await put(join(project.root, 'index.html'), '<p>broken</p>')
    checker.next = { failures: [{ where: 'smoke', message: 'boom' }], passed: 0, screenshot: Buffer.from('broken').toString('base64') }
    await store.checkTurn(session(), 0, 2)
    const one = await store.checkShot(project.id, 1)
    expect(one.ok && Buffer.from(one.webp, 'base64').toString()).toBe('poster-one')
    expect((await store.checkShot(project.id, 2)).ok).toBe(false)
  })

  it('leaves a candidate when auto-confirm is off, and confirm promotes it', async () => {
    const project = await created()
    expect(await store.setAutoConfirm(project.id, false, session())).toEqual({ ok: true })
    await put(join(project.root, 'index.html'), '<p>hi</p>')
    expect(await store.checkTurn(session(), 0, 2)).toMatchObject({ kind: 'pass', deployed: null, candidate: { version: 1 } })
    expect((await store.bundle(project.id)).ok).toBe(false)
    expect(await store.confirm(project.id, session())).toEqual({ ok: true, version: 1 })
    expect((await store.view(project.id))).toMatchObject({ current: { version: 1 }, candidate: null })
  })

  it('names the elements a candidate changed and added against the live version', async () => {
    const made = await store.create({ runtime: '3d', title: 'Hills', pitch: '在山里找东西', elementTypes: '角色、敌人', artStyle: 'ink' }, session())
    if (!made.ok) throw new Error(JSON.stringify(made))
    const project = made.project
    await put(join(project.root, 'index.html'), '<p>hi</p>')
    const fox = (look: object) => JSON.stringify([{ id: 'fox', name: '狐', type: '角色', look }, { id: 'tree', name: '树', type: '敌人' }])
    const recipe = { kind: 'parts3d', base: 'quadruped', parts: [{ type: 'tail', count: 1 }], palette: {}, motion: {} }
    await put(join(project.root, 'elements/a.json'), fox(recipe))
    await store.checkTurn(session(), 0, 2)
    expect((await store.view(project.id))?.candidateDiff).toBeNull()

    expect(await store.setAutoConfirm(project.id, false, session())).toEqual({ ok: true })
    const base = await store.turnBaseline('s1')
    await put(join(project.root, 'elements/a.json'), fox({ ...recipe, parts: [{ type: 'tail', count: 9 }] }))
    await put(join(project.root, 'elements/b.json'), JSON.stringify({ id: 'rock', name: '石', type: '敌人' }))
    expect(await store.checkTurn(session(), 0, 2)).toMatchObject({ kind: 'pass', candidate: { version: 2 } })
    expect((await store.view(project.id))?.candidateDiff).toEqual({ changed: ['fox'], added: ['rock'] })

    // The turn report carries the 3D look before and after, for the card's side-by-side.
    const report = await store.recordTurn('s1', 4, base!)
    const fx = report?.elements.find(e => e.id === 'fox')
    expect(fx?.what).toBe('look')
    expect(JSON.parse(fx!.looks!.after).parts[0].count).toBe(9)
    expect(JSON.parse(fx!.looks!.before!).parts[0].count).toBe(1)
  })

  it('deletes a project to the trash or only from the list, behind its guards', async () => {
    const exists = (p: string) => stat(p).then(() => true, () => false)
    const one = await created()
    // Only from the list: the folder stays, the row and the binding go.
    expect(await store.deleteProject(one.id, 'forget', session())).toEqual({ ok: true })
    expect(await exists(join(one.root, 'game.json'))).toBe(true)
    expect(await store.boundProject('s1')).toBeUndefined()
    expect((await store.listProjects()).some(p => p.id === one.id)).toBe(false)

    const two = await created()
    await store.bind('s2', two.id)
    // A folder that no longer holds this project is never trashed.
    const manifest = await readFile(join(two.root, 'game.json'), 'utf8')
    await writeFile(join(two.root, 'game.json'), manifest.replace(two.id, 'g_other'))
    expect(await store.deleteProject(two.id, 'trash', session())).toEqual({ ok: false, error: 'not-a-project' })
    await writeFile(join(two.root, 'game.json'), manifest)
    // Nor the calling session's own workspace.
    expect(await store.deleteProject(two.id, 'trash', ({ id: 's1', header: { cwd: two.root } }) as unknown as Session)).toEqual({ ok: false, error: 'is-workspace' })
    // A failed move changes nothing.
    failTrash = true
    expect(await store.deleteProject(two.id, 'trash', session())).toEqual({ ok: false, error: 'trash-failed', reason: '磁盘不同' })
    failTrash = false
    expect((await store.listProjects()).some(p => p.id === two.id)).toBe(true)
    // To the trash: folder moved, row and every binding gone.
    const done = await store.deleteProject(two.id, 'trash', session())
    expect(done).toMatchObject({ ok: true, trashedTo: join(dir, 'trash', '0') })
    expect(trashed).toEqual([two.root])
    expect(await exists(two.root)).toBe(false)
    expect(await store.boundProject('s1')).toBeUndefined()
    expect(await store.boundProject('s2')).toBeUndefined()
    expect(await store.deleteProject(two.id, 'trash', session())).toEqual({ ok: false, error: 'not-found' })
  })

  it('adopts an existing folder and logs play sessions', async () => {
    const root = join(workspace, 'old')
    await put(join(root, 'game.json'), JSON.stringify({ id: 'g_old', title: '旧游戏' }))
    const adopted = await store.adopt(root)
    expect(adopted).toMatchObject({ ok: true, project: { id: 'g_old', title: '旧游戏' } })
    expect(await store.adopt(join(workspace, 'none'))).toEqual({ ok: false, error: 'not-found' })
    await store.logPlay('g_old', { version: 2, seconds: 40, errors: ['boom'] }, session())
    expect((await store.view('g_old'))?.chapters.find(c => c.id === 'playtest')?.text).toContain('试玩 v2 40 秒，报错 1 次：boom')
  })
})
