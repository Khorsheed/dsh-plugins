import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli-core.ts'
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
    await expect(service.transition('m', 'releasable', { runId: 'g1' }))
      .rejects.toThrow(/empty under archive\/: logs\//)
    mkdirSync(join(archive, 'archive', 'logs', 'nested'), { recursive: true })
    writeFileSync(join(archive, 'archive', 'logs', 'nested', 'run.txt'), 'ok')
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
    writeFileSync(join(archive, 'archive', 'logs', 'run.txt'), 'ok')
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

describe('submit intent for mutually exclusive schema edges', () => {
  const TRUE_PAYLOAD = {
    feasible: true,
    mechanisms_considered: [],
    stage1_risks_resolved: [],
    iterations: [],
  }

  beforeEach(() => {
    mkdirSync(join(dir, 'bench', 'templates'), { recursive: true })
    mkdirSync(join(dir, 'bench', 'schemas'), { recursive: true })
    writeFileSync(join(dir, 'bench', 'schemas', 'run-meta.json'), JSON.stringify({ type: 'object' }))
    writeFileSync(join(dir, 'bench', 'schemas', 'stage1.json'), JSON.stringify({ type: 'object' }))
    writeFileSync(join(dir, 'bench', 'schemas', 'stage2.json'), JSON.stringify({
      type: 'object',
      required: ['feasible', 'mechanisms_considered', 'stage1_risks_resolved', 'iterations'],
      properties: {
        feasible: { type: 'boolean' },
        mechanisms_considered: { type: 'array', items: { type: 'object' } },
        stage1_risks_resolved: { type: 'array', items: { type: 'object' } },
        iterations: { type: 'array', items: { type: 'object' } },
      },
    }))
    writeFileSync(join(dir, 'bench', 'schemas', 'stage2-halted.json'), JSON.stringify({
      type: 'object', required: ['feasible'], properties: { feasible: { const: false } },
    }))
    writeFileSync(join(dir, 'bench', 'templates', 'bench-v1.json'), JSON.stringify({
      name: 'bench-v1',
      states: ['pending', 'ws-ready', 'stage-1', 'stage-2', 'judged', 'halted', 'archived', 'releasable', 'released'],
      transitions: [
        { from: 'pending', to: 'ws-ready', guard: { type: 'schema-check', schemaPath: '../schemas/run-meta.json', inputFrom: 'run-meta' } },
        { from: 'ws-ready', to: 'stage-1' },
        { from: 'stage-1', to: 'stage-2', guard: { type: 'schema-check', schemaPath: '../schemas/stage1.json' } },
        { from: 'stage-2', to: 'judged', guard: { type: 'schema-check', schemaPath: '../schemas/stage2.json' } },
        { from: 'stage-2', to: 'halted', guard: { type: 'schema-check', schemaPath: '../schemas/stage2-halted.json' } },
        { from: 'judged', to: 'archived' },
        { from: 'halted', to: 'archived' },
        { from: 'archived', to: 'releasable', guard: { type: 'file-check', dir: 'archive', expectedFiles: ['workspace/', 'verdicts/'] } },
        { from: 'releasable', to: 'released' },
      ],
      releasableStates: ['releasable'],
    }))
  })

  async function atBranch(id: string): Promise<void> {
    await service.create({ runId: 'bench', id })
    await service.transition(id, 'ws-ready', { runId: 'bench' })
    await service.transition(id, 'stage-1', { runId: 'bench' })
    await service.submit(id, { runId: 'bench', json: {} })
    await service.transition(id, 'stage-2', { runId: 'bench' })
  }

  beforeEach(async () => {
    await service.runCreate({
      templatePath: join(dir, 'bench', 'templates', 'bench-v1.json'),
      runId: 'bench',
      meta: {},
    })
  })

  it('requires an intent and lists both candidates when several schema edges leave the state', async () => {
    await atBranch('ambiguous')
    const before = service.get('ambiguous', 'bench').mission.attempts[0]?.submission
    await expect(service.submit('ambiguous', { runId: 'bench', json: TRUE_PAYLOAD }))
      .rejects.toThrow(/stage-2 → judged[\s\S]*stage-2 → halted/)
    expect(service.get('ambiguous', 'bench').mission.attempts[0]?.submission).toEqual(before)
  })

  it('accepts the feasible payload for the intended judged edge and the transition guard re-checks it', async () => {
    await atBranch('yes')
    await service.submit('yes', { runId: 'bench', to: 'judged', json: TRUE_PAYLOAD })
    await expect(service.transition('yes', 'judged', { runId: 'bench' })).resolves.toMatchObject({ changed: true })
  })

  it('accepts the infeasible payload for the intended halted edge', async () => {
    await atBranch('no')
    await service.submit('no', { runId: 'bench', to: 'halted', json: { feasible: false } })
    await expect(service.transition('no', 'halted', { runId: 'bench' })).resolves.toMatchObject({ changed: true })
  })

  it('CLI --to uses the same intent selection and reports ambiguity as usage', async () => {
    await atBranch('cli')
    const output: string[] = []
    const io = { stdout: (line: string) => output.push(line), stderr: (line: string) => output.push(line) }
    expect(await runCli([
      'submit', 'cli', '--run', 'bench', '--json', JSON.stringify(TRUE_PAYLOAD), '--data-dir', join(dir, 'data'),
    ], io)).toBe(2)
    expect(output.join('')).toMatch(/stage-2 → judged[\s\S]*stage-2 → halted/)
    expect(await runCli([
      'submit', 'cli', '--run', 'bench', '--to', 'judged', '--json', JSON.stringify(TRUE_PAYLOAD), '--data-dir', join(dir, 'data'),
    ], io)).toBe(0)
    await expect(service.transition('cli', 'judged', { runId: 'bench' })).resolves.toMatchObject({ changed: true })
  })
})

describe('schema-check inputFrom run-meta', () => {
  // Bench-style: the earliest transition pins the dataset snapshot in run.meta.
  const BENCH = {
    states: ['pending', 'ws-ready', 'done'],
    transitions: [
      {
        from: 'pending', to: 'ws-ready',
        guard: { type: 'schema-check', schemaPath: 'schemas/run-meta.json', inputFrom: 'run-meta' },
      },
      { from: 'ws-ready', to: 'done' },
    ],
  }
  const META_SCHEMA = {
    type: 'object',
    required: ['datasetId', 'commit'],
    properties: {
      datasetId: { type: 'string' },
      commit: { type: 'string' },
      repoPath: { type: 'string' },
    },
  }

  beforeEach(() => {
    mkdirSync(join(dir, 'schemas'), { recursive: true })
    writeFileSync(join(dir, 'schemas', 'run-meta.json'), JSON.stringify(META_SCHEMA))
    writeFileSync(join(dir, 'bench.json'), JSON.stringify(BENCH))
  })

  it('meta satisfying the schema passes; the transition does not touch submissions', async () => {
    await service.runCreate({ templatePath: join(dir, 'bench.json'), runId: 'b', meta: { datasetId: 'suite-a', commit: 'abc123' } })
    await service.create({ runId: 'b', id: 'cell' })
    const result = await service.transition('cell', 'ws-ready', { runId: 'b' })
    expect(result.changed).toBe(true)
  })

  it('missing meta fields fail the guard loud — the transition is refused', async () => {
    await service.runCreate({ templatePath: join(dir, 'bench.json'), runId: 'b', meta: { datasetId: 'suite-a' } })
    await service.create({ runId: 'b', id: 'cell' })
    await expect(service.transition('cell', 'ws-ready', { runId: 'b' }))
      .rejects.toThrow(/schema-check guard \(run meta\) failed[\s\S]*missing required property "commit"/)
    expect(service.get('cell', 'b').mission.attempts[0]?.state).toBe('pending')
  })

  it('a submit payload is NOT validated against a run-meta guard', async () => {
    await service.runCreate({ templatePath: join(dir, 'bench.json'), runId: 'b', meta: { datasetId: 's', commit: 'c' } })
    await service.create({ runId: 'b', id: 'cell' })
    // An arbitrary payload would violate the meta schema — submit must not apply it.
    const result = await service.submit('cell', { runId: 'b', json: { anything: true } })
    expect(result.checkpoint).toBe('submit')
  })

  it('run lint accepts the run-meta input', async () => {
    const result = service.lintTemplateFile(join(dir, 'bench.json'))
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    const c = { out: [] as string[], err: [] as string[] }
    const code = await runCli(['run', 'lint', '--template', join(dir, 'bench.json'), '--data-dir', dir], {
      stdout: line => c.out.push(line), stderr: line => c.err.push(line),
    })
    expect(code).toBe(0)
    expect(c.out.join('')).toMatch(/lint ok/)
  })
})
