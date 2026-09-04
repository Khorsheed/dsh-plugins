import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { MissionService } from '../src/service.ts'
import { handleMissionCommand } from '../src/slash.ts'

const SESSION = 'sess-1'

let dir: string
let service: MissionService
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-slash-'))
  service = new MissionService(dir)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Invoke the `/mission` handler as the given session. */
function run(rawInput: string, sessionId: string = SESSION): Promise<CommandResult> {
  const invocation = { rawInput, agent: { session: { id: sessionId } } } as unknown as CommandInvocation
  return handleMissionCommand(service, invocation)
}

/** Seed one implicit-run mission owned by SESSION. */
async function seed(id: string, extra: { dependsOn?: string[]; scheduledAt?: number; title?: string } = {}): Promise<void> {
  await service.create({ id, originSession: SESSION, by: 'test', ...extra })
}

describe('/mission usage handling', () => {
  it('bare /mission answers with the usage text', async () => {
    const result = await run('')
    expect(result.kind).toBe('error')
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { text: string }).text).toMatch(/usage:/)
  })

  it('unknown subcommand answers with the usage text', async () => {
    const result = await run('frobnicate')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toMatch(/unknown subcommand/)
  })

  it('a value-less flag is a usage error', async () => {
    const result = await run('queue --bucket')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toMatch(/--bucket requires a value/)
  })
})

describe('/mission queue', () => {
  it('empty state: no runs for this session', async () => {
    const result = await run('queue')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toMatch(/no missions in this session's runs/)
  })

  it('renders the five-bucket table with plan/blocked and duration columns', async () => {
    await seed('a', { title: 'first' })
    await seed('b', { dependsOn: ['a'] })
    await seed('c', { scheduledAt: Date.now() + 3_600_000 })
    await seed('d')
    await service.transition('d', 'active', { by: 'test' })
    await seed('e')
    await service.transition('e', 'active', { by: 'test' })
    await service.transition('e', 'done', { by: 'test' })

    const result = await run('queue')
    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    expect(text).toMatch(/run session-sess-1/)
    expect(text).toMatch(/#\s+title\s+bucket\s+state\s+plan\/blocked\s+duration/)
    expect(text).toMatch(/a\s+first\s+ready\s+queued/)
    expect(text).toMatch(/b\s+—\s+blocked\s+queued\s+waiting: a/)
    expect(text).toMatch(/c\s+—\s+scheduled\s+queued\s+at: /)
    expect(text).toMatch(/d\s+—\s+active\s+active\s+—\s+<1m/)
    expect(text).toMatch(/e\s+—\s+done\s+done\s+—\s+<1m/)
  })

  it('warns about held-but-unreleasable resources', async () => {
    await seed('h')
    await service.setRefs('h', { resource: 'box-1' }, { by: 'test' })
    const result = await run('queue')
    expect((result as { text: string }).text).toMatch(/⚠ holding resource but not releasable: h/)
  })

  it('defaults to this session; --all includes other sessions', async () => {
    await seed('mine')
    await service.create({ id: 'theirs', originSession: 'other', by: 'test' })

    const own = await run('queue')
    expect((own as { text: string }).text).toMatch(/mine/)
    expect((own as { text: string }).text).not.toMatch(/theirs/)

    const all = await run('queue --all')
    expect((all as { text: string }).text).toMatch(/mine/)
    expect((all as { text: string }).text).toMatch(/theirs/)
  })

  it('--bucket filters the projection; an unknown bucket is an error', async () => {
    await seed('a')
    await seed('b')
    await service.transition('b', 'active', { by: 'test' })

    const done = await run('queue --bucket done')
    expect(done).toMatchObject({ kind: 'success' })
    expect((done as { text: string }).text).toMatch(/no missions/)

    const active = await run('queue --bucket active')
    const text = (active as { text: string }).text
    expect(text).toMatch(/b\s+—\s+active/)
    expect(text).not.toMatch(/a\s+—\s+ready/)

    const bogus = await run('queue --bucket bogus')
    expect(bogus.kind).toBe('error')
    expect((bogus as { text: string }).text).toMatch(/unknown bucket/)
  })

  it('--run shows a named run regardless of origin session', async () => {
    await service.create({ id: 'x', originSession: 'other', by: 'test' })
    const result = await run('queue --run session-other')
    expect((result as { text: string }).text).toMatch(/x\s+—\s+ready/)

    const missing = await run('queue --run nope')
    expect(missing.kind).toBe('error')
    expect((missing as { text: string }).text).toMatch(/run nope does not exist/)
  })
})

describe('/mission run', () => {
  it('run list: empty state, then one line per run', async () => {
    const empty = await run('run list')
    expect((empty as { text: string }).text).toMatch(/no runs yet/)

    await seed('a')
    const result = await run('run list')
    const text = (result as { text: string }).text
    expect(text).toMatch(/session-sess-1/)
    expect(text).toMatch(/state=active missions=1 origin=sess-1/)
  })

  it('run status renders the shared projection table', async () => {
    await seed('a')
    await seed('b', { dependsOn: ['a'] })
    const result = await run('run status session-sess-1')
    expect(result).toMatchObject({ kind: 'success' })
    const text = (result as { text: string }).text
    expect(text).toMatch(/run session-sess-1 .* state=active missions=2/)
    expect(text).toMatch(/a\s+ready\s+queued/)
    expect(text).toMatch(/b\s+blocked\s+queued/)
    expect(text).toMatch(/buckets:.*ready=1.*blocked=1/)
  })

  it('run status without an id is a usage error; an unknown run is an error', async () => {
    const usage = await run('run status')
    expect(usage.kind).toBe('error')
    expect((usage as { text: string }).text).toMatch(/run status requires a RUN_ID/)

    const missing = await run('run status nope')
    expect(missing.kind).toBe('error')
    expect((missing as { text: string }).text).toMatch(/run nope does not exist/)
  })

  it('run create builds a run from a template file and records the origin session', async () => {
    const template = {
      name: 'two-step',
      states: ['queued', 'active', 'done'],
      transitions: [{ from: 'queued', to: 'active' }, { from: 'active', to: 'done' }],
      missions: [{ id: 'm1', labels: { layer: 'ods' } }],
    }
    writeFileSync(join(dir, 't.json'), JSON.stringify(template))
    const result = await run(`run create --template ${join(dir, 't.json')} --id r1 --meta '{"purpose": "check"}'`)
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toMatch(/run r1: 1 mission\(s\)/)

    const summary = service.runList().find(r => r.id === 'r1')
    expect(summary?.originSession).toBe(SESSION)
    expect(summary?.templateName).toBe('two-step')
    const status = service.runStatus('r1')
    expect(status.run.meta).toEqual({ purpose: 'check' })
  })

  it('run create without --template is a usage error; lint errors refuse', async () => {
    const usage = await run('run create')
    expect(usage.kind).toBe('error')
    expect((usage as { text: string }).text).toMatch(/requires --template/)

    const bad = {
      states: ['work', 'releasable'],
      transitions: [{ from: 'work', to: 'releasable' }],
      releasableStates: ['releasable'],
    }
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
    const refused = await run(`run create --template ${join(dir, 'bad.json')}`)
    expect(refused.kind).toBe('error')
    expect((refused as { text: string }).text).toMatch(/failed lint/)
    expect(service.runList()).toEqual([])
  })

  it('run create with invalid --meta JSON is an error', async () => {
    writeFileSync(join(dir, 't.json'), JSON.stringify({
      states: ['a'], transitions: [], missions: [],
    }))
    const result = await run(`run create --template ${join(dir, 't.json')} --meta '{invalid'`)
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toMatch(/invalid JSON for --meta/)
  })
})

describe('/mission retry', () => {
  it('opens a new attempt and keeps the old one immutable', async () => {
    await seed('a')
    await service.transition('a', 'active', { by: 'test' })
    const result = await run('retry a --reason "requested another pass" --category operator')
    expect(result).toMatchObject({ kind: 'success', text: 'attempt 2 opened' })

    const { mission } = service.get('a')
    expect(mission.currentAttempt).toBe(2)
    expect(mission.attempts[0]?.state).toBe('active')
    expect(mission.attempts[1]?.state).toBe('queued')
  })

  it('records the slash caller in later history attribution', async () => {
    await seed('a')
    await run('retry a --reason "resource interrupted" --category infrastructure')
    await service.transition('a', 'active', { by: 'test' })
    const { mission } = service.get('a')
    expect(mission.attempts[1]?.history[0]?.by).toBe('slash:sess-1')
    expect(mission.attempts[1]?.history[1]?.by).toBe('test')
  })

  it('without an id is a usage error; an unknown mission is an error', async () => {
    const usage = await run('retry')
    expect(usage.kind).toBe('error')
    expect((usage as { text: string }).text).toMatch(/retry requires a MISSION_ID/)

    const missing = await run('retry nope --reason "requested another pass" --category operator')
    expect(missing.kind).toBe('error')
    expect((missing as { text: string }).text).toMatch(/mission nope does not exist/)
  })

  it('--run disambiguates a mission id present in several runs', async () => {
    await seed('dup')
    await service.create({ id: 'dup', originSession: 'other', by: 'test' })
    const ambiguous = await run('retry dup --reason "requested another pass" --category operator')
    expect(ambiguous.kind).toBe('error')
    expect((ambiguous as { text: string }).text).toMatch(/several runs/)

    const result = await run('retry dup --run session-other --reason "resource interrupted" --category infrastructure')
    expect(result).toMatchObject({ kind: 'success', text: 'attempt 2 opened' })
  })
})
