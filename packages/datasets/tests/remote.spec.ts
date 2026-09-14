/**
 * The datasets Remote service: session binding resolution through the agent
 * parameter, whitelist enforcement on the Remote read paths (the SAME service
 * core as the tools), and bind/unbind writes landing in the plugin-owned
 * binding store.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import type { BindingSession } from '../src/binding.ts'
import { DatasetsRemoteService } from '../src/remote.ts'
import { createDatasetsService, resolveScope, type DatasetsService } from '../src/service.ts'
import { cleanup, commitAll, makeFixtureRepo, makeJudgingRepo, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let worktreeRoot: string | undefined
let bindingsRoot: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (worktreeRoot !== undefined) rmSync(worktreeRoot, { recursive: true, force: true })
  if (bindingsRoot !== undefined) rmSync(bindingsRoot, { recursive: true, force: true })
  repo = undefined
  worktreeRoot = undefined
  bindingsRoot = undefined
})

/** A minimal live-session fake: the binding store keys on the id alone. */
function fakeSession(): BindingSession {
  return { id: 's1' }
}

function agentOf(session: BindingSession): Agent {
  return { session } as unknown as Agent
}

/** Mount the Remote service over a real service core in a bare context. */
async function bench(defaultRepo = '') {
  const ctx = new Context()
  ctx.provide('datasets', createDatasetsService({
    worktreeRoot: worktreeRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-')),
    bindingsRoot: bindingsRoot ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
  }))
  const fiber = ctx.plugin(DatasetsRemoteService, { defaultRepo })
  await fiber.await()
  const remote = ctx.get('datasetsRemote') as DatasetsRemoteService
  return { ctx, fiber, remote }
}

describe('DatasetsRemoteService', () => {
  it('bind records the binding, binding reads it, unbind clears it', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    expect(remote.binding(agent)).toBeNull()

    const recorded = await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    expect(recorded).toEqual({ repoPath: repo.dir, layers: ['visible'] })
    expect(remote.binding(agent)).toEqual({ repoPath: repo.dir, layers: ['visible'] })

    expect(remote.unbind(agent)).toBeNull()
    expect(remote.binding(agent)).toBeNull()
    await fiber.dispose()
  })

  it('previewRepo resolves the canonical toplevel and ignores the session binding', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    // A bound session must not narrow the preview (the binder is choosing the whitelist).
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    const result = await remote.previewRepo(agent, { path: `${repo.dir}/` })
    expect(result.repo).toBe(realpathSync(repo.dir))
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    // Declared layers arrive unfiltered — neither the binding's whitelist nor
    // the modelFacing floor narrows what the binder previews.
    expect(result.datasets[0]?.layers).toEqual(['visible', 'hidden'])
    await expect(remote.previewRepo(agent, { path: join(repo.dir, 'no-such-dir') }))
      .rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await fiber.dispose()
  })

  it('bind rejects a non-repository path loud and records nothing', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await expect(remote.bind(agent, { repoPath: join(repo.dir, 'no-such-dir') }))
      .rejects.toMatchObject({ code: 'NOT_A_REPO' })
    expect(remote.binding(agent)).toBeNull()
    await fiber.dispose()
  })

  it('list is the operator view: neither the binding whitelist nor the floor narrows it', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    const datasets = await remote.list(agent, {})
    if (datasets.kind !== 'datasets') throw new Error('expected datasets result')
    expect(datasets.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    // The binding whitelists ['visible'], yet the human sees every layer.
    expect([...datasets.datasets[0]?.layers ?? []].sort()).toEqual(['hidden', 'visible'])

    const items = await remote.list(agent, { dataset: 'alpha' })
    if (items.kind !== 'items') throw new Error('expected items result')
    const i1 = items.items.find(item => item.id === 'i1')
    expect(Object.keys(i1?.layers ?? {}).sort()).toEqual(['hidden', 'visible'])
    await fiber.dispose()
  })

  it('read is the operator view: a whitelisted-out (sensitive) layer still reads for the human', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    // The binding's whitelist constrains the agent's tools, never the tab.
    const sensitive = await remote.read(agent, {
      dataset: 'alpha', item: 'i1', layer: 'hidden', path: 'notes.md',
    })
    expect(sensitive.content).toBe('hidden notes v1\n')

    const ok = await remote.read(agent, {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    expect(ok.content).toBe('task one v1\n')
    expect(ok.commit).toBe(repo.commit)
    await fiber.dispose()
  })

  it('show returns the descriptor passthrough and every layer (operator view)', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })

    const result = await remote.show(agent, { dataset: 'alpha', item: 'i1' })
    expect(result.commit).toBe(repo.commit)
    expect([...result.dataset.layers].sort()).toEqual(['hidden', 'visible'])
    expect(result.dataset.warnings.map(warning => warning.layer)).toEqual(['visible'])
    expect(result.datasetLayers).toEqual({ visible: ['guide.md'], hidden: ['answers.md'] })
    expect((result.descriptor['extra'] as Record<string, unknown>)['passthrough']).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(Object.keys(result.items[0]?.layers ?? {}).sort()).toEqual(['hidden', 'visible'])
    await fiber.dispose()
  })

  it('readPassthrough serves the passthrough zone to the operator (and stays off the agent tool surface)', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, layers: ['visible'] })
    // The human reads passthrough content regardless of the agent whitelist.
    const handbook = await remote.readPassthrough(agent, { dataset: 'alpha', path: 'handbook.md' })
    expect(handbook.content).toBe('# handbook passthrough\n')
    const meta = await remote.readPassthrough(agent, { dataset: 'alpha', path: 'items/i1/item.json' })
    expect(meta.content).toBe('{"difficulty":"hard"}\n')
    await expect(remote.readPassthrough(agent, { dataset: 'alpha', path: 'missing.md' }))
      .rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await fiber.dispose()
  })

  it('fails loud with no binding and no default, and falls back to the configured default repo', async () => {
    repo = makeFixtureRepo()
    const unbound = await bench()
    await expect(unbound.remote.list(agentOf(fakeSession()), {})).rejects.toMatchObject({ code: 'NO_REPO' })
    await unbound.fiber.dispose()

    const withDefault = await bench(repo.dir)
    const result = await withDefault.remote.list(agentOf(fakeSession()), {})
    if (result.kind !== 'datasets') throw new Error('expected datasets result')
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    await withDefault.fiber.dispose()
  })

  it('overview answers the list page in one call: slot ← layer, canary, validate', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })

    const overview = await remote.overview(agent)
    expect(overview.repo).toBe(realpathSync(repo.dir))
    expect(overview.commit).toBe(repo.commit)
    const row = overview.datasets[0]
    expect(row?.id).toBe('bench')
    expect(row?.itemCount).toBe(2)
    // The «槽位 ← 层» cell: both layouts fold into the same six words, and the
    // passthrough zone reports under the reserved name.
    expect(row?.slotLayers).toEqual({
      prompt: ['visible'],
      standards: ['visible'],
      oracle: ['grading'],
      rubric: ['grading'],
      checks: ['verify'],
      other: ['-'],
    })
    // This fixture declares no canary; the row says so without ever carrying
    // the string itself (a canary in a payload is a canary in a log).
    expect(row?.canary).toBe(false)
    expect(JSON.stringify(row)).not.toContain('dsh-canary')
    // validate ran: this fixture is clean apart from its passthrough zone.
    expect(row?.validate?.errors).toBe(0)
    expect(row?.validate?.warnings).toBeGreaterThan(0)
    await fiber.dispose()
  })

  it('itemBrief lists exactly what the player receives, in both layouts', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })

    const registered = await remote.itemBrief(agent, { dataset: 'bench', item: 'R1' })
    // The item's own modelFacing files, then the dataset-level stage prompt —
    // and NOTHING from grading or verify. This list IS the leak self-check.
    expect(registered.player.files.map(file => [file.source, file.path])).toEqual([
      ['item', 'standards.yml'],
      ['item', 'task.md'],
      ['dataset', 'prompts/stage1.md'],
    ])
    expect(registered.player.files.every(file => file.layer === 'visible')).toBe(true)
    expect(registered.player.totalBytes).toBe(
      registered.player.files.reduce((sum, file) => sum + file.bytes, 0),
    )
    expect(registered.player.totalBytes).toBeGreaterThan(0)

    // The convention layout shows the same three files under the same slot.
    const conventional = await remote.itemBrief(agent, { dataset: 'bench', item: 'C1' })
    expect(conventional.player.files.map(file => file.path).sort())
      .toEqual(['prompts/stage1.md', 'standards.yml', 'task.md'])
    await fiber.dispose()
  })

  it('itemBrief counts the rubric’s shape without ever shipping its text', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })

    const brief = await remote.itemBrief(agent, { dataset: 'bench', item: 'R1' })
    expect(brief.judgeability.rubricPath).toBe('answers/rubric.yml')
    expect(brief.judgeability.leaves).toBe(2)
    expect(brief.judgeability.kinds).toEqual({ 'objective': 1, 'llm-draft': 1 })
    expect(brief.judgeability.probes).toEqual(['checks/probes/link-check.mjs'])
    expect(brief.judgeability.stageSchemas).toEqual(['schemas/stage1.json'])
    expect(brief.judgeability.notes).toEqual([])
    // The criteria are counted, never carried: the page shows the SHAPE.
    expect(JSON.stringify(brief)).not.toContain('every link in the write-up resolves')
    await fiber.dispose()
  })

  it('itemBrief says why a number is missing instead of reporting a bare zero', async () => {
    repo = makeFixtureRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })
    // `alpha` declares no grading layer at all — a dataset outside the judging
    // convention, which is not the same thing as an unjudgeable one.
    const brief = await remote.itemBrief(agent, { dataset: 'alpha', item: 'i1' })
    expect(brief.judgeability.rubricPath).toBeNull()
    expect(brief.judgeability.leaves).toBe(0)
    expect(brief.judgeability.notes.join('\n')).toContain('declares no grading layer')
    await fiber.dispose()
  })

  it('scaffoldDataset writes a descriptor skeleton and refuses to overwrite one', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })

    const result = await remote.scaffoldDataset(agent, { id: 'fresh', name: 'Fresh set' })
    expect(result.written).toEqual([
      'datasets/fresh/dataset.json',
      'datasets/fresh/visible/prompts/stage1.md',
      'datasets/fresh/schemas/stage1.json',
      'datasets/fresh/items/.gitkeep',
    ])
    expect(JSON.parse(readFileSync(join(repo.dir, 'datasets/fresh/dataset.json'), 'utf8')).id).toBe('fresh')
    // A second call on the same id is a loud refusal, never a silent overwrite.
    await expect(remote.scaffoldDataset(agent, { id: 'fresh' })).rejects.toMatchObject({ code: 'SHAPE_INVALID' })
    await fiber.dispose()
  })

  it('scaffoldItem homes the placeholders by the dataset’s own register, and skips what exists', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })

    // R1 is register-homed and already ships three of the four: only the probe
    // README is missing, and it lands under the probes/ segment that is what
    // makes a probe a probe (protocol §6.7).
    const registered = await remote.scaffoldItem(agent, { dataset: 'bench', item: 'R1' })
    expect(registered.written).toEqual(['datasets/bench/items/R1/checks/probes/README.md'])
    expect(registered.skipped).toEqual([
      'datasets/bench/items/R1/task.md',
      'datasets/bench/items/R1/standards.yml',
      'datasets/bench/items/R1/answers/rubric.yml',
    ])

    // A new item the register does not name gets the convention layout.
    const fresh = await remote.scaffoldItem(agent, { dataset: 'bench', item: 'C2' })
    expect(fresh.written).toEqual([
      'datasets/bench/items/C2/visible/task.md',
      'datasets/bench/items/C2/visible/standards.yml',
      'datasets/bench/items/C2/grading/rubric.yml',
      'datasets/bench/items/C2/verify/probes/README.md',
    ])
    await fiber.dispose()
  })

  it('validate names the placeholder a skeleton just wrote — the expected next step', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })
    await remote.scaffoldItem(agent, { dataset: 'bench', item: 'C2' })
    // validate reads the WORKING TREE's HEAD, so the uncommitted skeleton is
    // invisible until the human commits it — which is the honest answer, and
    // the reason the page says the commit is theirs.
    const beforeCommit = await remote.validate(agent, { dataset: 'bench' })
    expect(beforeCommit.datasets[0]?.errors).toEqual([])
    commitAll(repo.dir, 'skeleton')
    const afterCommit = await remote.validate(agent, { dataset: 'bench' })
    expect(afterCommit.datasets[0]?.errors.map(error => error.code)).toContain('RUBRIC_NO_ITEMS')
    expect(afterCommit.datasets[0]?.errors.some(error => error.message.includes('C2'))).toBe(true)
    await fiber.dispose()
  })

  it('importItem copies an item directory in verbatim and leaves the roles to the dataset', async () => {
    repo = makeJudgingRepo()
    const source = mkdtempSync(join(tmpdir(), 'dsh-datasets-import-'))
    try {
      mkdirSync(join(source, 'visible'), { recursive: true })
      mkdirSync(join(source, 'grading'), { recursive: true })
      writeFileSync(join(source, 'item.json'), '{"id":"IM1","title":"imported"}\n')
      writeFileSync(join(source, 'visible', 'task.md'), 'imported task\n')
      writeFileSync(join(source, 'grading', 'rubric.yml'), 'items: []\n')
      const { fiber, remote } = await bench()
      const agent = agentOf(fakeSession())
      await remote.bind(agent, { repoPath: repo.dir })

      const result = await remote.importItem(agent, { dataset: 'bench', item: 'IM1', sourceDir: source })
      expect(result.written).toEqual([
        'datasets/bench/items/IM1/grading/rubric.yml',
        'datasets/bench/items/IM1/item.json',
        'datasets/bench/items/IM1/visible/task.md',
      ])
      // Verbatim: the copy re-homes nothing, so the dataset's own layers decide
      // what each file became — and the item reads back through the normal face.
      commitAll(repo.dir, 'imported')
      const shown = await remote.show(agent, { dataset: 'bench', item: 'IM1' })
      expect(shown.items[0]?.layers).toEqual({ visible: ['task.md'], grading: ['rubric.yml'] })
      await fiber.dispose()
    } finally {
      rmSync(source, { recursive: true, force: true })
    }
  })

  it('importItem fails loud on a path that is not a directory', async () => {
    repo = makeJudgingRepo()
    const { fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })
    await expect(remote.importItem(agent, {
      dataset: 'bench', item: 'IM2', sourceDir: join(repo.dir, 'datasets/bench/dataset.json'),
    })).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await fiber.dispose()
  })

  it('the skeleton gestures are the human’s: an agent-scoped call is refused', async () => {
    repo = makeJudgingRepo()
    const { ctx, fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir })
    // The Remote is the operator face, so its calls pass; the same service
    // reached with a TOOL scope (no operator flag) is refused — an agent's
    // authoring path is datasets_put_item, inside the session binding.
    const service = ctx.get('datasets') as DatasetsService
    const scope = resolveScope({}, service.binding({ id: 's1' }), '')
    await expect(service.scaffoldDataset(scope, { id: 'agent-made' })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    await expect(service.scaffoldItem(scope, { dataset: 'bench', item: 'X1' })).rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    await expect(service.importItem(scope, { dataset: 'bench', item: 'X1', sourceDir: repo.dir }))
      .rejects.toMatchObject({ code: 'LAYER_NOT_ALLOWED' })
    expect(existsSync(join(repo.dir, 'datasets/agent-made'))).toBe(false)
    await fiber.dispose()
  })

  it('the datasets whitelist narrows the agent boundary but never the operator view', async () => {
    repo = makeFixtureRepo()
    const { ctx, fiber, remote } = await bench()
    const agent = agentOf(fakeSession())
    await remote.bind(agent, { repoPath: repo.dir, datasets: ['beta'] })

    // The tab (operator) still lists every dataset in the repo…
    const result = await remote.list(agent, {})
    if (result.kind !== 'datasets') throw new Error('expected datasets result')
    expect(result.datasets.map(summary => summary.id)).toEqual(['alpha', 'beta'])
    const shown = await remote.show(agent, { dataset: 'alpha' })
    expect(shown.dataset.id).toBe('alpha')
    // …while the same session through the TOOL boundary keeps the whitelist.
    const service = ctx.get('datasets') as DatasetsService
    const binding = service.binding({ id: 's1' })
    const scope = resolveScope({}, binding, '')
    const toolView = await service.list(scope)
    if (toolView.kind !== 'datasets') throw new Error('expected datasets result')
    expect(toolView.datasets.map(summary => summary.id)).toEqual(['beta'])
    await fiber.dispose()
  })
})
