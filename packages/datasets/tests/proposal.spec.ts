/**
 * T90 registration proposals and the update gate: the organizing agent files
 * a proposal (never a registration — decision A), the plugin checks its
 * mapping against the repository and the original directory, the person
 * confirms; afterwards the registration follows its branch only while the
 * changes stay invisible to agents.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mappingMatches, openProposals, type ProposalInput } from '../src/proposal.ts'
import { createDatasetsService, type DatasetsService } from '../src/service.ts'
import { loadAuthoringSkill } from '../src/tool.ts'
import { datasetToolDefinitions } from '../src/tool-definition.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo
let state: string
let source: string
let service: DatasetsService

beforeEach(() => {
  repo = makeFixtureRepo()
  state = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-proposal-state-')))
  source = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-proposal-source-')))
  writeFiles(source, {
    'qa.jsonl': '{"id":"i1","q":"task one","a":"hidden notes"}\n{"id":"i2","q":"task two","a":"none"}\n',
    'README.md': 'shared guide\n',
  })
  service = createDatasetsService({
    materializedRoot: join(state, 'materialized'),
    registryPath: join(state, 'registry.json'),
    bindingsRoot: join(state, 'bindings'),
  })
})

afterEach(() => {
  cleanup(repo.dir)
  rmSync(state, { recursive: true, force: true })
  rmSync(source, { recursive: true, force: true })
})

/** A proposal that explains every file of the fixture and of the source directory. */
function fullInput(): ProposalInput {
  return {
    repo: repo.dir,
    registryId: 'fixture',
    purpose: 'unit test',
    source: { kind: 'local', label: 'fixture source', path: source },
    layers: [
      { set: 'alpha', layer: 'visible', visible: true, reason: 'the task' },
      { set: 'alpha', layer: 'hidden', visible: false, reason: 'the answers' },
    ],
    mapping: {
      sources: [
        {
          path: 'qa.jsonl', disposition: 'split', target: 'datasets/alpha/items/', count: 2, key: 'id',
          fields: [{ name: 'id', to: 'item id' }, { name: 'q', to: 'visible/task.md' }, { name: 'a', to: 'hidden/notes.md' }],
        },
        { path: 'README.md', disposition: 'copy', target: 'datasets/alpha/visible/guide.md' },
      ],
      outputs: [
        { path: 'datasets/*/dataset.json', origin: 'new', count: 2 },
        { path: 'datasets/alpha/handbook.md', origin: 'new' },
        { path: 'datasets/alpha/drafts/', origin: 'new' },
        { path: 'datasets/alpha/visible/guide.md', origin: 'copy', from: 'README.md' },
        { path: 'datasets/alpha/hidden/answers.md', origin: 'new' },
        { path: 'datasets/alpha/items/*/item.json', origin: 'new' },
        { path: 'datasets/alpha/items/*/visible/task.md', origin: 'split', from: 'qa.jsonl', field: 'q', count: 2 },
        { path: 'datasets/alpha/items/*/hidden/notes.md', origin: 'split', from: 'qa.jsonl', field: 'a' },
        { path: 'datasets/beta/', origin: 'new' },
      ],
    },
    samples: [{ set: 'alpha', item: 'i1', from: { file: 'qa.jsonl', line: 1 } }],
  }
}

/** The problem codes of a dry run. */
async function codes(input: ProposalInput): Promise<string[]> {
  return (await service.proposals.check(input)).problems.map(problem => problem.code)
}

describe('mapping paths', () => {
  it('exact, trailing-slash prefix, and * within one segment', () => {
    expect(mappingMatches('a/b.txt', 'a/b.txt')).toBe(true)
    expect(mappingMatches('a/', 'a/b/c.txt')).toBe(true)
    expect(mappingMatches('a/*/c.txt', 'a/x/c.txt')).toBe(true)
    expect(mappingMatches('a/*/c.txt', 'a/x/y/c.txt')).toBe(false)
    expect(mappingMatches('a/*.md', 'a/x.md')).toBe(true)
  })
})

describe('the proposal check', () => {
  it('a mapping that explains everything passes; the unlayered visible files are a warning, not a block', async () => {
    const { problems, warnings, proposal } = await service.proposals.check(fullInput())
    expect(problems).toEqual([])
    expect(warnings.map(warning => warning.code)).toContain('UNLAYERED_VISIBLE')
    // The page says findings in the reader's language from these params.
    expect(warnings.find(warning => warning.code === 'UNLAYERED_VISIBLE')!.params).toEqual({ count: expect.any(Number) })
    expect(proposal).toMatchObject({ kind: 'new', trackedRef: 'main', commit: repo.commit, registryId: 'fixture' })
  })

  it('a repository file no output entry explains blocks', async () => {
    const input = fullInput()
    input.mapping.outputs = input.mapping.outputs.filter(output => output.path !== 'datasets/beta/')
    expect(await codes(input)).toContain('OUTPUT_UNCOVERED')
  })

  it('an output entry that matches nothing, or the wrong number of files, blocks', async () => {
    const input = fullInput()
    input.mapping.outputs.push({ path: 'datasets/alpha/items/*/verify/test.sh', origin: 'new' })
    input.mapping.outputs[6]!.count = 5
    const found = await codes(input)
    expect(found).toContain('OUTPUT_MISSING')
    expect(found).toContain('OUTPUT_COUNT')
  })

  it('an original file left unaccounted for, a miscounted record file, and a dropped field all block', async () => {
    const input = fullInput()
    input.mapping.sources = [{ ...input.mapping.sources![0]!, count: 3, fields: [{ name: 'q', to: 'visible/task.md' }] }]
    const found = await codes(input)
    expect(found).toContain('SOURCE_UNLISTED')
    expect(found).toContain('SOURCE_COUNT')
    expect(found).toContain('FIELD_UNACCOUNTED')
  })

  it('an unused file needs a reason; a sample must be a real item; a layer must be declared', async () => {
    const input = fullInput()
    input.mapping.sources![1] = { path: 'README.md', disposition: 'unused' }
    input.samples = [{ set: 'alpha', item: 'nope' }]
    input.layers = [{ set: 'alpha', layer: 'grading', visible: false }]
    const found = await codes(input)
    expect(found).toContain('DISPOSITION_INCOMPLETE')
    expect(found).toContain('SAMPLE_MISSING')
    expect(found).toContain('LAYER_UNKNOWN')
  })
})

describe('propose → review → confirm', () => {
  it('proposing writes a proposal and never the registry (decision A)', async () => {
    const { proposal } = await service.proposals.propose(fullInput())
    expect(service.registry.entries()).toEqual([])
    expect(service.proposals.list().map(p => [p.id, p.status])).toEqual([[proposal.id, 'pending']])

    const review = await service.proposals.review(proposal.id)
    expect(review.facts.itemCount).toBe(3)
    expect(review.facts.validate.ok).toBe(true)
    expect(review.facts.version).toMatchObject({ number: 1, commit: repo.commit, trackedRef: 'main' })
    expect(review.facts.sets.find(set => set.set === 'alpha')?.layers).toEqual([
      { name: 'visible', modelFacing: true, suggested: true, reason: 'the task' },
      { name: 'hidden', modelFacing: false, suggested: false, reason: 'the answers' },
    ])
    expect(review.compare.mode).toBe('new')
    expect(review.compare.sourceRead).toBe(true)
    expect(review.compare.summary).toMatchObject({ split: 3, copy: 1 })
    expect(review.compare.sources.find(row => row.path === 'qa.jsonl')).toMatchObject({ files: 1, counted: 2 })
    expect(review.compare.unlayered).toEqual(expect.arrayContaining(['datasets/alpha/handbook.md', 'datasets/alpha/drafts/notes.md']))

    const item = await service.proposals.reviewItem(proposal.id, 'alpha', 'i1')
    expect(item.files.map(file => [file.path, file.origin])).toEqual(expect.arrayContaining([
      ['datasets/alpha/items/i1/visible/task.md', 'split'],
      ['datasets/alpha/items/i1/hidden/notes.md', 'split'],
    ]))
    expect(item.source).toMatchObject({ file: 'qa.jsonl', line: 1 })
    expect(item.source?.record).toContain('task one')
    // No sample for i2: the keyed source row finds the record by its id.
    expect((await service.proposals.reviewItem(proposal.id, 'alpha', 'i2')).source).toMatchObject({ file: 'qa.jsonl', line: 2 })

    const files = await service.proposals.reviewFiles(proposal.id)
    expect(files.outputs.length).toBe(11)
    expect(files.outputs.every(row => row.origin !== 'unexplained')).toBe(true)
  })

  it('confirming registers with the confirmed commit; a newer proposal supersedes an open one', async () => {
    const first = (await service.proposals.propose(fullInput())).proposal
    const second = (await service.proposals.propose(fullInput())).proposal
    expect(service.proposals.get(first.id).status).toBe('superseded')
    await expect(service.proposals.confirm(first.id, 'fixture', {})).rejects.toThrowError(/superseded/)

    const entry = await service.proposals.confirm(second.id, 'mine', { alpha: { layers: ['visible'] } })
    expect(entry).toMatchObject({ id: 'mine', confirmedCommit: repo.commit, trackedRef: 'main' })
    expect(service.proposals.get(second.id)).toMatchObject({ status: 'confirmed', confirmedAs: 'mine' })
  })

  it('returning keeps the note for the organizing session', async () => {
    const { proposal } = await service.proposals.propose({ ...fullInput(), sessionId: 's-1' })
    expect(service.proposals.giveBack(proposal.id, 'split hidden notes again')).toMatchObject({
      status: 'returned', returnNote: 'split hidden notes again', sessionId: 's-1',
    })
    await expect(service.proposals.confirm(proposal.id, 'fixture', {})).rejects.toThrowError(/returned/)
  })

  it('a branch that moved after the proposal blocks confirmation', async () => {
    const { proposal } = await service.proposals.propose(fullInput())
    writeFiles(repo.dir, { 'notes.txt': 'outside datasets\n' })
    commitAll(repo.dir, 'move on')
    await expect(service.proposals.confirm(proposal.id, 'fixture', {})).rejects.toThrowError(/moved on/)
  })
})

describe('the commit cache (T96: a filed proposal reopens without recomputing)', () => {
  /** A store over the service's registry whose validator counts its calls. */
  function countingStore(root: string): { store: ReturnType<typeof openProposals>; calls: () => number } {
    let calls = 0
    const store = openProposals(root, {
      registry: service.registry,
      validate: async (dir, commit) => {
        calls += 1
        return await service.validate({ repo: dir, ref: commit, operator: true })
      },
    })
    return { store, calls: () => calls }
  }

  it('proposing computes validate once; reopening the same commit reads the cache', async () => {
    const root = join(state, 'proposals-cache')
    const { store, calls } = countingStore(root)
    const { proposal } = await store.propose(fullInput())
    expect(calls()).toBe(1)
    const first = await store.review(proposal.id)
    const second = await store.review(proposal.id)
    await store.reviewFiles(proposal.id)
    expect(calls()).toBe(1)
    expect(second.facts).toEqual(first.facts)
    expect(first.facts.validate.ok).toBe(true)

    // A restart (fresh store over the same root) still hits the persisted facts.
    const reopened = countingStore(root)
    const again = await reopened.store.review(proposal.id)
    expect(reopened.calls()).toBe(0)
    expect(again.facts.version).toEqual(first.facts.version)
  })

  it('the head answers the four summary cards without the comparison', async () => {
    const root = join(state, 'proposals-head')
    const { store, calls } = countingStore(root)
    const { proposal } = await store.propose(fullInput())
    const head = await store.head(proposal.id)
    expect(head.proposal.id).toBe(proposal.id)
    expect(head.itemCount).toBe(3)
    expect(head.sets).toEqual(['alpha', 'beta'])
    expect(head.version).toMatchObject({ number: 1, commit: repo.commit })
    expect(head.validate).toMatchObject({ ok: true })
    expect(calls()).toBe(1)

    // A commit whose facts were never cached answers without validate rather than computing it.
    rmSync(join(root, 'cache'), { recursive: true, force: true })
    const cold = countingStore(root)
    const coldHead = await cold.store.head(proposal.id)
    expect(coldHead.validate).toBeUndefined()
    expect(coldHead.version).toEqual(head.version)
    expect(cold.calls()).toBe(0)
  })

  it('a validator that cannot run is reported, not cached', async () => {
    let calls = 0
    const store = openProposals(join(state, 'proposals-failing'), {
      registry: service.registry,
      validate: async () => {
        calls += 1
        throw new Error('validator offline')
      },
    })
    await expect(store.propose(fullInput())).rejects.toThrowError(/validator offline/)
    await expect(store.propose(fullInput())).rejects.toThrowError(/validator offline/)
    expect(calls).toBe(2)
  })
})

describe('the update gate (only a visible change waits for a person)', () => {
  async function confirmed(): Promise<void> {
    const { proposal } = await service.proposals.propose(fullInput())
    await service.proposals.confirm(proposal.id, 'fixture', { alpha: { layers: ['visible'] } })
  }

  it('follows the branch automatically while every change is invisible to agents', async () => {
    await confirmed()
    writeFiles(repo.dir, {
      'datasets/alpha/hidden/answers.md': 'shared answers v2\n',
      'datasets/alpha/items/i1/hidden/notes.md': 'hidden notes v2\n',
      'tools/convert.py': 'print(1)\n',
    })
    const tip = commitAll(repo.dir, 'hidden-only')
    const entry = service.registry.get('fixture')!
    const latest = await service.registry.latest(entry)
    expect(latest).toMatchObject({ commit: tip, version: 2 })
    expect(latest.pending).toBeUndefined()
    expect(await service.proposals.reviewPending(entry)).toBeUndefined()
  })

  it('holds a visible change at the confirmed version and lists every deletion until confirmed', async () => {
    await confirmed()
    git(repo.dir, ['rm', '-q', 'datasets/alpha/items/i2/visible/task.md'])
    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'task one v2\n' })
    const tip = commitAll(repo.dir, 'visible change')
    const entry = service.registry.get('fixture')!
    const latest = await service.registry.latest(entry)
    expect(latest.commit).toBe(repo.commit)
    expect(latest.pending).toMatchObject({ commit: tip, version: 2 })

    const review = (await service.proposals.reviewPending(entry))!
    expect(review.compare.mode).toBe('update')
    expect(review.facts.registered).toMatchObject({ number: 1, commit: repo.commit })
    expect(review.facts.version).toMatchObject({ number: 2, commit: tip })
    expect(review.compare.summary).toMatchObject({ modified: 1, deleted: 1 })
    expect(review.compare.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'D', path: 'datasets/alpha/items/i2/visible/task.md', visible: true }),
    ]))
    expect(review.problems).toEqual([])

    await expect(service.proposals.confirmPending(entry, repo.commit, entry.sets)).rejects.toThrowError(/not the version waiting/)
    const updated = await service.proposals.confirmPending(entry, tip, entry.sets)
    expect(updated.confirmedCommit).toBe(tip)
    expect((await service.registry.latest(updated)).pending).toBeUndefined()
  })

  it('an update proposal compares the registered version with the new one', async () => {
    await confirmed()
    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'task one v3\n', 'provenance/notes.md': 'why v3\n' })
    const tip = commitAll(repo.dir, 'visible edit')
    const { proposal } = await service.proposals.propose(fullInput())
    expect(proposal).toMatchObject({ kind: 'update', registeredAs: 'fixture', commit: tip })
    const review = await service.proposals.review(proposal.id)
    expect(review.compare.mode).toBe('update')
    // The chips are disjoint and sum to the change list: the provenance
    // note counts as 题集外, not again as 新增.
    expect(review.compare.summary).toMatchObject({ modified: 1, added: 0, deleted: 0, outside: 1 })
    expect(review.compare.changes).toHaveLength(2)
    expect(review.facts.sets.find(set => set.set === 'alpha')?.layers.map(layer => [layer.name, layer.registered]))
      .toEqual([['visible', true], ['hidden', false]])
    const entry = await service.proposals.confirm(proposal.id, 'ignored', { alpha: { layers: ['visible'] } })
    expect(entry).toMatchObject({ id: 'fixture', confirmedCommit: tip })
  })
})

describe('datasets_propose_registration (the organize tier)', () => {
  async function run(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tool = datasetToolDefinitions(service, { group: 'organize' }).find(d => d.name === 'datasets_propose_registration')!
    return await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<Record<string, unknown>> })
      .execute(args, { agent: { session: { id: 'organizing-1' } } })
  }

  it('dryRun reports the problems and files nothing; a clean run files a proposal tagged with the session', async () => {
    const input = fullInput()
    const broken = await run({ ...input, mapping: { ...input.mapping, outputs: [] }, dryRun: true })
    expect(broken.ok).toBe(false)
    expect(service.proposals.list()).toEqual([])
    await expect(run({ ...input, mapping: { ...input.mapping, outputs: [] } })).rejects.toThrowError(/OUTPUT_UNCOVERED/)

    expect(await run({ ...input, dryRun: true })).toMatchObject({ ok: true, kind: 'new', problems: [] })
    const filed = await run(input)
    expect(service.proposals.get(filed.filed as string)).toMatchObject({ status: 'pending', sessionId: 'organizing-1' })
    expect(service.registry.entries()).toEqual([])
  })

  it('the shipped skill loads with its name and the eight steps', () => {
    const skill = loadAuthoringSkill()
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('dataset-authoring')
    for (const heading of ['Check git first', 'Never modify the original data', 'no sampling', 'Commit per batch', 'SWE-bench', 'Terminal-Bench', 'jsonl QA']) {
      expect(skill!.content).toContain(heading)
    }
  })
})
