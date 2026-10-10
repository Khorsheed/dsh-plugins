import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { BrowserChecker } from '../src/checks.ts'
import { normalizeLook, parseParams, patchElementText } from '../src/project.ts'
import { GameService } from '../src/store.ts'

const checker: BrowserChecker = { run: async () => ({ failures: [], passed: 1 }), dispose: async () => {} }
let dir: string, workspace: string, store: GameService
const session = { id: 's1', header: { cwd: '' } } as unknown as Session
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}
const LOOK = { palette: ['#000000', '#ffcd75'], states: { idle: ['.0.', '010', '.0.'] } }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'game-wb-'))
  workspace = join(dir, 'ws')
  await mkdir(workspace)
  ;(session as unknown as { header: { cwd: string } }).header.cwd = workspace
  store = new GameService({ fs: { sandboxMode: undefined }, get: () => undefined } as unknown as Context, { stateRoot: join(dir, 'state') }, { checker, writer: put })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function project() {
  const created = await store.create({ title: 'Fog', pitch: 'p', elementTypes: '角色、敌人', artStyle: 'pixel' }, session)
  if (!created.ok) throw new Error('create failed')
  const root = created.project.root
  const manifest = JSON.parse(await readFile(join(root, 'game.json'), 'utf8')) as Record<string, unknown>
  manifest.params = [{ key: 'speed', label: '移动速度', min: 0, max: 100, step: 1, value: 40 }]
  await put(join(root, 'game.json'), JSON.stringify(manifest))
  await put(join(root, 'index.html'), '<p>x</p>')
  await put(join(root, 'elements/units.json'), JSON.stringify([{ id: 'fog', name: '雾怪', type: '敌人', speed: 6, look: LOOK }]))
  return created.project
}

describe('pure helpers', () => {
  it('parses params, clamping values and dropping bad rows', () => {
    expect(parseParams([{ key: 'a', min: 0, max: 10, value: 99 }, { key: 'b', min: 5, max: 1 }, { min: 0, max: 1 }]))
      .toEqual([{ key: 'a', label: 'a', min: 0, max: 10, step: 0.1, value: 10 }])
  })
  it('normalizes looks: pads rows and drops characters outside the palette', () => {
    expect(normalizeLook({ palette: ['#000000', 'red'], states: { idle: ['0z', '0'] } })).toEqual({ palette: ['#000000'], states: { idle: ['0.', '0.'] } })
    expect(normalizeLook({ palette: [], states: {} })).toBeNull()
  })
  it('patches one element inside an array file', () => {
    const text = patchElementText('[{"id":"a","hp":1},{"id":"b","hp":2}]', 'b', { hp: 5, old: undefined })
    expect(JSON.parse(text!)).toEqual([{ id: 'a', hp: 1 }, { id: 'b', hp: 5 }])
    expect(patchElementText('{"id":"a"}', 'z', {})).toBeUndefined()
  })
})

describe('the user layer', () => {
  it('keeps slider values as overrides, finalizes them into game.json, and clears only what a sent message lists', async () => {
    const p = await project()
    expect(await store.setParam(p.id, 'speed', 55, session)).toEqual({ ok: true })
    let view = await store.view(p.id)
    expect(view?.paramOverrides).toEqual({ speed: 55 })
    // A slider is a trial: nothing waits to be sent until the user finalizes or says so.
    expect(view?.pending).toEqual([])
    await store.setParam(p.id, 'speed', 40, session)
    expect((await store.view(p.id))?.paramOverrides).toEqual({})
    await store.setParam(p.id, 'speed', 70, session)
    await store.finalizeParams(p.id, session)
    view = await store.view(p.id)
    expect(view?.manifest?.params[0]?.value).toBe(70)
    expect(view?.paramOverrides).toEqual({})
    const listed = (await store.view(p.id))!.pending
    expect(listed.map(x => x.text)).toEqual(['定稿参数：移动速度 40→70（已写进 game.json）'])
    expect(await store.clearSent('s1', `随便说说 ${listed[0]!.text}`)).toBe(0)
    await store.writeChapter(p.id, 'core-loop', '# 循环', session)
    expect(await store.clearSent('s1', `【面板改动】我改了：\n- ${listed[0]!.text}\n`)).toBe(1)
    expect((await store.view(p.id))?.pending.map(x => x.key)).toEqual(['design:core-loop'])
  })

  it('edits an element in the working file and in the live version, and records it', async () => {
    const p = await project()
    await store.checkTurn(session, 0, 2)
    const edited = await store.editElement(p.id, 'fog', { look: { ...LOOK, palette: ['#000000', '#ff3864'] }, fields: { speed: 9 } }, session)
    expect(edited.ok).toBe(true)
    const working = JSON.parse(await readFile(join(p.root, 'elements/units.json'), 'utf8')) as { speed: number; look: { palette: string[] } }[]
    expect(working[0]).toMatchObject({ speed: 9, look: { palette: ['#000000', '#ff3864'] } })
    const live = JSON.parse(await readFile(join(p.root, '.game/versions/1/elements/units.json'), 'utf8')) as { speed: number }[]
    expect(live[0]?.speed).toBe(9)
    expect((await store.view(p.id))?.pending.map(x => x.key).sort()).toEqual(['fields:fog', 'look:fog'])
  })

  it('stores up to 3 look proposals and applies the picked one', async () => {
    const p = await project()
    const proposed = await store.proposeLooks('s1', 'fog', '更像烟', [
      { label: 'A', note: '圆', look: LOOK },
      { label: 'B', note: '尖', look: { palette: ['#ffffff'], states: { idle: ['00', '00'] } } },
      { label: 'bad', look: { nope: 1 } },
    ])
    expect(proposed).toEqual({ ok: true, count: 2, name: '雾怪' })
    const open = (await store.view(p.id))?.proposals[0]
    expect(open?.variants.map(v => v.label)).toEqual(['A', 'B'])
    expect(await store.pickProposal(p.id, 'fog', open!.at, 1, session)).toEqual({ ok: true })
    const view = await store.view(p.id)
    expect(view?.elements[0]?.look?.palette).toEqual(['#ffffff'])
    expect(view?.proposals[0]?.picked).toBe(1)
    expect(view?.pending.find(x => x.key === 'look:fog')?.text).toContain('选了「B」')
  })

  it('rejects candidates, rolls back, diffs versions, and forces a candidate after a restyle request', async () => {
    const p = await project()
    expect((await store.checkTurn(session, 0, 2)).kind).toBe('pass')
    await put(join(p.root, 'index.html'), '<p>y</p>')
    await store.requestRestyle(p.id, 'neon', session)
    const restyled = await store.checkTurn(session, 0, 2)
    expect(restyled).toMatchObject({ kind: 'pass', deployed: null, candidate: { version: 2 } })
    expect(await store.reject(p.id, '太亮了', session)).toEqual({ ok: true })
    let view = await store.view(p.id)
    expect(view?.versions.map(v => [v.version, v.status])).toEqual([[2, 'rejected'], [1, 'current']])
    expect(view?.pending.some(x => x.text.includes('退回了候选 v2（太亮了）'))).toBe(true)
    expect(await store.diff(p.id, 1, 2)).toEqual({ ok: true, diff: { added: [], removed: [], changed: ['index.html'] } })
    await put(join(p.root, 'index.html'), '<p>z</p>')
    expect((await store.checkTurn(session, 0, 2))).toMatchObject({ kind: 'pass', deployed: { version: 3 } })
    expect(await store.rollback(p.id, 1, session)).toEqual({ ok: true })
    view = await store.view(p.id)
    expect(view?.current?.version).toBe(1)
    expect(view?.log[0]?.text).toBe('试玩区切回 v1')
  })

  it('writes a chapter the user edited and marks it for the next send', async () => {
    const p = await project()
    expect(await store.writeChapter(p.id, 'core-loop', '# 核心循环\n躲雾', session)).toEqual({ ok: true })
    expect(await readFile(join(p.root, 'design/core-loop.md'), 'utf8')).toBe('# 核心循环\n躲雾\n')
    expect(await store.writeChapter(p.id, 'elements', 'x', session)).toEqual({ ok: false, error: 'invalid' })
    expect((await store.view(p.id))?.pending.map(x => x.key)).toEqual(['design:core-loop'])
  })
})

describe('turn reports', () => {
  it('records what a turn changed: version, check, elements, chapters, params, code', async () => {
    const p = await project()
    const base = await store.turnBaseline('s1')
    expect(base).toBeDefined()
    expect(await store.recordTurn('s1', 1, base!)).toBeUndefined()

    const manifest = JSON.parse(await readFile(join(p.root, 'game.json'), 'utf8')) as { params: { value: number }[] }
    manifest.params[0]!.value = 60
    await put(join(p.root, 'game.json'), JSON.stringify(manifest))
    await put(join(p.root, 'elements/units.json'), JSON.stringify([
      { id: 'fog', name: '雾怪', type: '敌人', speed: 9, look: { palette: ['#ffffff'], states: { idle: ['0'] } } },
      { id: 'oil', name: '灯油', type: '角色' },
    ]))
    await put(join(p.root, 'design/mechanics.md'), '# 机制')
    await put(join(p.root, 'src/main.js'), 'x')
    await store.checkTurn(session, 0, 2)
    const report = await store.recordTurn('s1', 2, base!)
    expect(report).toMatchObject({
      turn: 2, version: { kind: 'deployed', version: 1 }, check: { ok: true, fixes: 0 },
      chapters: [{ id: 'mechanics', title: '机制与规则' }],
      params: [{ key: 'speed', label: '移动速度', from: 40, to: 60 }],
    })
    expect(report!.elements).toEqual([
      { id: 'fog', name: '雾怪', what: 'look', fields: ['speed'] },
      { id: 'oil', name: '灯油', what: 'new' },
    ])
    expect(report!.code).toEqual(['src/main.js'])
    expect(await store.turnReport('s1', 2)).toMatchObject({ turn: 2 })
    expect(await store.turnReport('s1', 3)).toBeNull()
  })
})
