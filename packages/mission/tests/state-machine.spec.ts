import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MissionService } from '../src/service.ts'
import { SIMPLE_TEMPLATE } from '../src/template.ts'

let dir: string
let service: MissionService
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-sm-'))
  service = new MissionService(join(dir, 'data'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function simpleRun(): Promise<string> {
  const { run } = await service.runCreate({ template: SIMPLE_TEMPLATE, runId: 'r1' })
  return run.id
}

describe('state machine enforcement', () => {
  it('rejects every undeclared transition, allows the declared ones, records history', async () => {
    await simpleRun()
    await service.create({ runId: 'r1', id: 'm1' })
    const declared = new Set(['queued>active', 'active>done', 'active>failed'])
    const states = SIMPLE_TEMPLATE.stateMachine.states
    for (const from of states) {
      for (const to of states) {
        if (from === to || declared.has(`${from}>${to}`)) continue
        // Force the mission into `from` via the declared path when needed.
        const { mission } = service.get('m1', 'r1')
        const current = mission.attempts[0]?.state
        if (current !== from) {
          if (from === 'active' && current === 'queued') await service.transition('m1', 'active', { runId: 'r1' })
          else continue // terminal states are unreachable here by construction
        }
        await expect(service.transition('m1', to, { runId: 'r1' })).rejects.toThrow(/not declared/)
      }
    }
    const { mission } = service.get('m1', 'r1')
    expect(mission.attempts[0]?.state).toBe('active')
    await service.transition('m1', 'done', { runId: 'r1', note: 'finished' })
    const after = service.get('m1', 'r1').mission
    const attempt = after.attempts[0]
    expect(attempt?.state).toBe('done')
    expect(attempt?.history).toHaveLength(2)
    expect(attempt?.history[1]).toMatchObject({ from: 'active', to: 'done', note: 'finished' })
    expect(attempt?.enteredAt['done']).toBeTypeOf('number')
  })

  it('repeating a transition already in the target state is an idempotent no-op', async () => {
    await simpleRun()
    await service.create({ runId: 'r1', id: 'm1' })
    await service.transition('m1', 'active', { runId: 'r1' })
    const repeat = await service.transition('m1', 'active', { runId: 'r1' })
    expect(repeat.changed).toBe(false)
    const { mission } = service.get('m1', 'r1')
    expect(mission.attempts[0]?.history).toHaveLength(1)
  })

  it('records the caller into history (by)', async () => {
    await simpleRun()
    await service.create({ runId: 'r1', id: 'm1' })
    await service.transition('m1', 'active', { runId: 'r1', by: 'tool:sess-9' })
    const { mission } = service.get('m1', 'r1')
    expect(mission.attempts[0]?.history[0]?.by).toBe('tool:sess-9')
  })
})

describe('guards', () => {
  const GUARDED = {
    states: ['work', 'review', 'releasable', 'released'],
    transitions: [
      { from: 'work', to: 'review', guard: { type: 'schema-check', schemaPath: 'schemas/out.json' } },
      { from: 'review', to: 'releasable', guard: { type: 'file-check', dir: 'archive', expectedFiles: ['workspace.tgz', 'logs/'] } },
      { from: 'releasable', to: 'released', guard: { type: 'attested', key: 'human-ok' } },
    ],
    releasableStates: ['releasable'],
  }

  it('schema-check: submit validates first, transition re-validates the recorded submission', async () => {
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    writeFileSync(join(dir, 'schemas', 'out.json'), JSON.stringify({
      type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } },
    }))
    const templatePath = join(dir, 'template.json')
    writeFileSync(templatePath, JSON.stringify(GUARDED))
    await service.runCreate({ templatePath, runId: 'g1' })
    await service.create({ runId: 'g1', id: 'm' })

    // No submission yet → guard fails loud, state stays.
    await expect(service.transition('m', 'review', { runId: 'g1' })).rejects.toThrow(/no submission/)
    // A violating submission is rejected BEFORE anything is written.
    await expect(service.submit('m', { runId: 'g1', json: { ok: 'yes' } })).rejects.toThrow(/violates the schema/)
    expect(service.get('m', 'g1').mission.attempts[0]?.submission).toBeUndefined()
    // A valid submission passes both submit-time and transition-time checks.
    await service.submit('m', { runId: 'g1', json: { ok: true } })
    const result = await service.transition('m', 'review', { runId: 'g1' })
    expect(result).toMatchObject({ changed: true, from: 'work', to: 'review' })
  })

  it('file-check: dir resolves relative to the attempt run-data directory, no interpolation', async () => {
    const templatePath = join(dir, 'template.json')
    writeFileSync(templatePath, JSON.stringify(GUARDED))
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    writeFileSync(join(dir, 'schemas', 'out.json'), JSON.stringify({ type: 'object' }))
    await service.runCreate({ templatePath, runId: 'g1' })
    await service.create({ runId: 'g1', id: 'm' })
    await service.submit('m', { runId: 'g1', json: {} })
    await service.transition('m', 'review', { runId: 'g1' })

    // Files absent → guard fails.
    await expect(service.transition('m', 'releasable', { runId: 'g1' })).rejects.toThrow(/file-check guard failed/)
    // Files present under <runData>/m/attempt-1/archive/ → guard passes.
    const archive = service.store.attemptDataDir('g1', 'm', 1)
    mkdirSync(join(archive, 'archive', 'logs'), { recursive: true })
    writeFileSync(join(archive, 'archive', 'workspace.tgz'), 'bytes')
    const result = await service.transition('m', 'releasable', { runId: 'g1' })
    expect(result.changed).toBe(true)
  })

  it('file-check: absolute dirs and .. escapes are rejected', async () => {
    const bad = {
      states: ['a', 'b'],
      transitions: [{ from: 'a', to: 'b', guard: { type: 'file-check', dir: '/etc', expectedFiles: ['passwd'] } }],
    }
    await service.runCreate({ template: bad, runId: 'b1' })
    await service.create({ runId: 'b1', id: 'm' })
    await expect(service.transition('m', 'b', { runId: 'b1' })).rejects.toThrow(/must be relative/)

    const escape = {
      states: ['a', 'b'],
      transitions: [{ from: 'a', to: 'b', guard: { type: 'file-check', dir: '../..', expectedFiles: ['x'] } }],
    }
    await service.runCreate({ template: escape, runId: 'b2' })
    await service.create({ runId: 'b2', id: 'm' })
    await expect(service.transition('m', 'b', { runId: 'b2' })).rejects.toThrow(/escapes/)
  })

  it('attested: the transition waits for an attestation of the declared key', async () => {
    const templatePath = join(dir, 'template.json')
    writeFileSync(templatePath, JSON.stringify(GUARDED))
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    writeFileSync(join(dir, 'schemas', 'out.json'), JSON.stringify({ type: 'object' }))
    await service.runCreate({ templatePath, runId: 'g1' })
    await service.create({ runId: 'g1', id: 'm' })
    await service.submit('m', { runId: 'g1', json: {} })
    await service.transition('m', 'review', { runId: 'g1' })
    const archive = service.store.attemptDataDir('g1', 'm', 1)
    mkdirSync(join(archive, 'archive', 'logs'), { recursive: true })
    writeFileSync(join(archive, 'archive', 'workspace.tgz'), 'bytes')
    await service.transition('m', 'releasable', { runId: 'g1' })

    await expect(service.transition('m', 'released', { runId: 'g1' })).rejects.toThrow(/has not been attested/)
    await service.attest('m', 'human-ok', { runId: 'g1', by: 'cli' })
    const result = await service.transition('m', 'released', { runId: 'g1' })
    expect(result.changed).toBe(true)
    // Same key twice = no-op.
    expect((await service.attest('m', 'human-ok', { runId: 'g1' })).added).toBe(false)
    const { mission } = service.get('m', 'g1')
    expect(mission.attempts[0]?.attestations).toHaveLength(1)
    expect(mission.attempts[0]?.attestations[0]).toMatchObject({ key: 'human-ok', by: 'cli' })
  })
})
