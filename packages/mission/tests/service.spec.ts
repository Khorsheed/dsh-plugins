import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { MissionService } from '../src/service.ts'
import { currentAttempt } from '../src/projection.ts'

let dir: string
let service: MissionService
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-service-'))
  service = new MissionService(join(dir, 'data'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('implicit run and zero-config create', () => {
  it('create without a run lands in the implicit run on the simple template', async () => {
    const { run, mission } = await service.create({ title: 'tidy up' })
    expect(run.id).toBe('default')
    expect(run.stateMachine).toEqual(expect.objectContaining({ states: ['queued', 'active', 'done', 'failed'] }))
    expect(mission.id).toBe('1')
    expect(currentAttempt(mission).state).toBe('queued')
    // A second create reuses the same implicit run and numbers sequentially.
    const second = await service.create({ title: 'next' })
    expect(second.run.id).toBe('default')
    expect(second.mission.id).toBe('2')
  })

  it('the implicit run is per-session when a session is named', async () => {
    const { run } = await service.create({ originSession: 'abc-123', title: 'x' })
    expect(run.id).toBe('session-abc-123')
    expect(run.originSession).toBe('abc-123')
  })

  it('re-creating with identical parameters is a no-op; conflicting ones fail', async () => {
    await service.create({ id: 'm', title: 'a' })
    const again = await service.create({ id: 'm', title: 'a' })
    expect(again.existed).toBe(true)
    await expect(service.create({ id: 'm', title: 'different' })).rejects.toThrow(/different parameters/)
  })
})

describe('annotations: ns isolation and append-only', () => {
  it('namespaces accumulate independently and identical repeats are no-ops', async () => {
    await service.create({ id: 'm' })
    expect((await service.annotate('m', 'script', { v: 1 })).added).toBe(true)
    expect((await service.annotate('m', 'lab', { v: 1 })).added).toBe(true)
    expect((await service.annotate('m', 'script', { v: 1 })).added).toBe(false) // idempotent
    expect((await service.annotate('m', 'script', { v: 2 })).added).toBe(true) // append, never rewrite
    const { mission } = service.get('m')
    expect(mission.annotations.map(a => a.ns)).toEqual(['script', 'lab', 'script'])
    expect(mission.annotations.every(a => a.attempt === 1)).toBe(true)
  })

  it('annotations carry their attempt number across a retry', async () => {
    await service.create({ id: 'm' })
    await service.annotate('m', 'script', { round: 1 })
    await service.retry('m', { reason: 'resource was unavailable', category: 'infrastructure' })
    await service.annotate('m', 'script', { round: 2 })
    const { mission } = service.get('m')
    expect(mission.annotations.map(a => [a.attempt, a.payload])).toEqual([
      [1, { round: 1 }],
      [2, { round: 2 }],
    ])
  })
})

describe('attempt vs checkpoint', () => {
  it('checkpoints live inside an attempt; retry starts a fresh attempt with none', async () => {
    await service.create({ id: 'm' })
    await service.submit('m', { files: [{ path: 'a.txt', content: '1' }] })
    await service.addCheckpoint('m', { name: 'mid', ref: 'tag-1' })
    let attempt = currentAttempt(service.get('m').mission)
    expect(attempt.checkpoints.map(c => c.name)).toEqual(['submit', 'mid'])
    await service.retry('m', { reason: 'requested a fresh pass', category: 'operator' })
    attempt = currentAttempt(service.get('m').mission)
    expect(attempt.attempt).toBe(2)
    expect(attempt.checkpoints).toEqual([])
    // Attempt 1 is immutable: its checkpoints survive untouched.
    expect(service.get('m').mission.attempts[0]?.checkpoints).toHaveLength(2)
  })

  it('retry requires a reason and records its category on the new attempt and in history', async () => {
    await service.create({ id: 'm' })
    await expect(service.retry('m', undefined as never)).rejects.toThrow(/requires a non-empty reason/)
    await expect(service.retry('m', { reason: '', category: 'operator' })).rejects.toThrow(/non-empty reason/)
    await expect(service.retry('m', { reason: 'try again', category: 'invalid' as never })).rejects.toThrow(/category must be one of/)
    await service.retry('m', {
      reason: 'resource interrupted', category: 'infrastructure', by: 'tool:s-1', now: 1234,
    })
    const fresh = service.get('m').mission.attempts[1]
    expect(fresh?.retry).toEqual({
      reason: 'resource interrupted', category: 'infrastructure', by: 'tool:s-1', at: 1234,
    })
    expect(fresh?.history).toEqual([{
      kind: 'retry', reason: 'resource interrupted', category: 'infrastructure', by: 'tool:s-1', at: 1234,
    }])
  })

  it('reads a legacy run with no retry metadata and appends a compatible new attempt', async () => {
    mkdirSync(join(dir, 'data', 'runs'), { recursive: true })
    writeFileSync(join(dir, 'data', 'runs', 'legacy.json'), JSON.stringify({
      id: 'legacy', createdAt: 1, state: 'active', meta: {},
      stateMachine: {
        states: ['queued', 'done'], transitions: [{ from: 'queued', to: 'done' }], releasableStates: [],
      },
      missions: [{
        id: 'm', labels: {}, currentAttempt: 1, annotations: [], attempts: [{
          attempt: 1, state: 'queued', refs: {}, enteredAt: { queued: 1 }, checkpoints: [], history: [],
          artifacts: [], attestations: [],
        }],
      }],
    }))
    expect(service.get('m', 'legacy').mission.attempts[0]?.retry).toBeUndefined()
    await service.retry('m', { runId: 'legacy', reason: 'requested another pass', category: 'operator' })
    expect(service.get('m', 'legacy').mission.attempts[1]?.retry).toMatchObject({
      reason: 'requested another pass', category: 'operator', by: 'service',
    })
  })

  it('submit registers a NO-REF checkpoint; addCheckpoint with a ref MERGES into it — never a duplicate', async () => {
    await service.create({ id: 'm' })
    await service.submit('m', { files: [{ path: 'a.txt', content: '1' }], checkpoint: 'round-1' })
    await service.addCheckpoint('m', { name: 'round-1', ref: 'git-tag-abc' })
    const attempt = currentAttempt(service.get('m').mission)
    expect(attempt.checkpoints).toHaveLength(1)
    expect(attempt.checkpoints[0]).toMatchObject({ name: 'round-1', ref: 'git-tag-abc', artifacts: ['a.txt'] })
    // A conflicting ref for the same checkpoint fails loud.
    await expect(service.addCheckpoint('m', { name: 'round-1', ref: 'other' })).rejects.toThrow(/already carries ref/)
  })
})

describe('idempotent writes', () => {
  it('submit with identical bytes is a no-op; different bytes at an existing path fail', async () => {
    await service.create({ id: 'm' })
    const first = await service.submit('m', { files: [{ path: 'a.txt', content: 'v1' }] })
    expect(first.written).toEqual(['a.txt'])
    const repeat = await service.submit('m', { files: [{ path: 'a.txt', content: 'v1' }] })
    expect(repeat.written).toEqual([])
    expect(currentAttempt(service.get('m').mission).artifacts).toHaveLength(1)
    await expect(service.submit('m', { files: [{ path: 'a.txt', content: 'v2' }] })).rejects.toThrow(/append-only/)
  })

  it('addArtifact dedups by path and rejects a conflicting kind', async () => {
    await service.create({ id: 'm' })
    const file = join(service.store.attemptDataDir('default', 'm', 1), 'x')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'content\n')
    expect((await service.addArtifact('m', { path: 'x', kind: 'collect' })).added).toBe(true)
    expect((await service.addArtifact('m', { path: 'x', kind: 'collect' })).added).toBe(false)
    await expect(service.addArtifact('m', { path: 'x', kind: 'archive' })).rejects.toThrow(/already indexed/)
  })

  it('addArtifact fails loud on a missing path (no ghost artifacts), accepts directories', async () => {
    await service.create({ id: 'm' })
    await expect(service.addArtifact('m', { path: 'ghost.txt', kind: 'collect' })).rejects.toThrow(/does not exist/)
    const sub = join(service.store.attemptDataDir('default', 'm', 1), 'logs')
    mkdirSync(sub, { recursive: true })
    expect((await service.addArtifact('m', { path: 'logs', kind: 'archive' })).added).toBe(true)
  })
})

describe('service face (ctx.mission)', () => {
  it('mounts through the cordis plugin and serves the fine-grained methods', async () => {
    const ctx = new Context()
    const registered: string[] = []
    const commands: string[] = []
    ctx.provide('tools', { register: (def: { name: string }) => { registered.push(def.name); return () => {} } })
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('commands', { register: (def: { name: string }) => { commands.push(def.name); return () => {} } })
    apply(ctx, { dataDir: join(dir, 'plugin-data') })
    const mission = ctx.get('mission') as MissionService
    expect(mission).toBeInstanceOf(MissionService)
    expect(commands).toEqual(['mission'])
    expect(registered.sort()).toEqual([
      'mission_annotate', 'mission_attest', 'mission_create', 'mission_get', 'mission_is_releasable',
      'mission_list', 'mission_retry', 'mission_run_create', 'mission_run_list', 'mission_run_status',
      'mission_submit', 'mission_transition',
    ])

    await mission.create({ id: 'cell', by: 'service' })
    await mission.setRefs('cell', { resource: 'box-1', fingerprint: 'sha256:abc', sessions: ['s-1'] })
    await mission.setRefs('cell', { sessions: ['s-1', 's-2'] }) // sessions union
    const report = join(mission.store.attemptDataDir('default', 'cell', 1), 'report.json')
    mkdirSync(dirname(report), { recursive: true })
    writeFileSync(report, '{}\n')
    await mission.addArtifact('cell', { path: 'report.json', kind: 'collect' })
    await mission.addCheckpoint('cell', { name: 'verify', ref: 'tag-9', artifacts: ['report.json'] })
    await mission.annotate('cell', 'lab', { exitCode: 0 }, { by: 'service' })
    const { mission: record } = mission.get('cell')
    const attempt = currentAttempt(record)
    expect(attempt.refs).toEqual({ resource: 'box-1', fingerprint: 'sha256:abc', sessions: ['s-1', 's-2'] })
    expect(attempt.artifacts).toHaveLength(1)
    expect(attempt.checkpoints).toHaveLength(1)
    expect(record.annotations).toHaveLength(1)
    // simple template has no releasableStates → never releasable.
    expect(mission.isReleasable('cell')).toBe(false)
  })

  it('isReleasable follows the run\'s declared releasableStates', async () => {
    const template = {
      states: ['work', 'releasable', 'released'],
      transitions: [
        { from: 'work', to: 'releasable', guard: { type: 'attested', key: 'ok' } },
        { from: 'releasable', to: 'released' },
      ],
      releasableStates: ['releasable'],
    }
    await service.runCreate({ template, runId: 'r' })
    await service.create({ runId: 'r', id: 'm' })
    expect(service.isReleasable('m')).toBe(false)
    await service.attest('m', 'ok', { runId: 'r' })
    await service.transition('m', 'releasable', { runId: 'r' })
    expect(service.isReleasable('m')).toBe(true)
    await service.transition('m', 'released', { runId: 'r' })
    expect(service.isReleasable('m')).toBe(false)
  })
})

describe('mission lookup', () => {
  it('run creation is idempotent for an identical template + meta, refused on divergence', async () => {
    const template = { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }] }
    const first = await service.runCreate({ template, runId: 'r', meta: { scene: 'x' } })
    expect(first.existed).toBe(false)
    const again = await service.runCreate({ template, runId: 'r', meta: { scene: 'x' } })
    expect(again.existed).toBe(true)
    await expect(service.runCreate({ template, runId: 'r', meta: { scene: 'y' } })).rejects.toThrow(/already exists/)
    expect(service.runList()).toHaveLength(1)
  })

  it('an id present in several runs requires disambiguation', async () => {
    await service.runCreate({ template: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }] }, runId: 'r1' })
    await service.runCreate({ template: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }] }, runId: 'r2' })
    await service.create({ runId: 'r1', id: 'm' })
    await service.create({ runId: 'r2', id: 'm' })
    expect(() => service.get('m')).toThrow(/several runs/)
    expect(service.get('m', 'r2').run.id).toBe('r2')
    expect(() => service.get('ghost')).toThrow(/does not exist/)
  })
})
