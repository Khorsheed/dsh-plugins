import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli-core.ts'
import { cleanupTmp, captureIo, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const FIXTURE_DATASET = join(import.meta.dirname, 'fixtures/dataset/datasets/harness-comparison')
const T1_PLAN = join(FIXTURE_DATASET, 'plans/i1-walk.json')
const T1_CONDITION = join(FIXTURE_DATASET, 'conditions/dsh-exec.json')

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { io, stdout, stderr } = captureIo()
  const code = await runCli(args, io)
  return { code, stdout: stdout(), stderr: stderr() }
}

describe('dsh-eval validate', () => {
  it('the T1 plan validates: exit 0, report on stdout, summary on stderr', async () => {
    const { code, stdout, stderr } = await run(['validate', T1_PLAN])
    expect(code).toBe(0)
    const report = JSON.parse(stdout) as { ok: boolean; errors: unknown[]; warnings: Array<{ code: string }> }
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.map(w => w.code)).toContain('LOCK_MISSING')
    expect(stderr).toContain('valid')
    expect(stderr).toContain('4 warning(s)')
  })

  it('an invalid plan exits 1 with the report still on stdout', async () => {
    const planPath = writeJson(tmpTree(), 'plan.json', {
      schema: 'dataseek.plan/1',
      dataset: { repo: '~/repo', commit: null, id: 'ds', items: ['I1'] },
      conditions: ['c1'],
      reps: 1,
      stages: ['stage1'],
      order: { seed: 1, interleave: false },
      budget: { activeMinutes: 10, turns: 5 },
      expectedNs: ['script', 'llm-draft'], // no judge
    })
    const { code, stdout, stderr } = await run(['validate', planPath])
    expect(code).toBe(1)
    const report = JSON.parse(stdout) as { errors: Array<{ code: string }> }
    expect(report.errors.map(e => e.code)).toContain('JUDGE_REQUIRED_FOR_LLM_DRAFT')
    expect(stderr).toContain('INVALID')
  })

  it('unreadable and malformed plans exit 1, the report carries the code', async () => {
    const missing = await run(['validate', join(tmpTree(), 'nope.json')])
    expect(missing.code).toBe(1)
    expect(missing.stdout).toContain('PLAN_UNREADABLE')

    const dir = tmpTree()
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ nope')
    const malformed = await run(['validate', path])
    expect(malformed.code).toBe(1)
    expect(malformed.stdout).toContain('PLAN_MALFORMED')
  })
})

describe('dsh-eval conditions hash', () => {
  it('prints id, sha and unresolved warnings; two runs agree', async () => {
    const first = await run(['conditions', 'hash', T1_CONDITION])
    expect(first.code).toBe(0)
    const out = JSON.parse(first.stdout) as { id: string; sha: string; warnings: Array<{ code: string }> }
    expect(out.id).toBe('dsh-exec')
    expect(out.sha).toMatch(/^[0-9a-f]{64}$/)
    // model.endpoint + home.sha; harness.version and model.declared were
    // filled from the live instance snapshot (T8b).
    expect(out.warnings.map(w => w.code)).toEqual(['UNRESOLVED_FIELD', 'UNRESOLVED_FIELD'])

    const second = await run(['conditions', 'hash', T1_CONDITION])
    expect((JSON.parse(second.stdout) as { sha: string }).sha).toBe(out.sha)
  })

  it('an invalid condition document exits 1 with the violations on stderr', async () => {
    const condition = JSON.parse(readFileSync(T1_CONDITION, 'utf8')) as Record<string, unknown>
    condition['permissions'] = 'skip' // claude's word, dsh's condition
    const path = writeJson(tmpTree(), 'broken.json', condition)
    const { code, stdout, stderr } = await run(['conditions', 'hash', path])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('PERMISSION_NOT_FOR_HARNESS')
  })

  it('missing and malformed files exit 1', async () => {
    const missing = await run(['conditions', 'hash', join(tmpTree(), 'nope.json')])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('cannot read condition')

    const dir = tmpTree()
    const path = join(dir, 'bad.json')
    writeFileSync(path, '[not json')
    const malformed = await run(['conditions', 'hash', path])
    expect(malformed.code).toBe(1)
    expect(malformed.stderr).toContain('cannot read condition')
  })
})

describe('dsh-eval usage', () => {
  it('no arguments exits 2 with usage on stdout', async () => {
    const { code, stdout } = await run([])
    expect(code).toBe(2)
    expect(stdout).toContain('dsh-eval <verb>')
  })

  it('help exits 0', async () => {
    expect((await run(['help'])).code).toBe(0)
    expect((await run(['--help'])).code).toBe(0)
  })

  it('unknown verbs and missing arguments exit 2 with usage on stderr', async () => {
    const unknown = await run(['frobnicate'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('unknown verb')

    const noPath = await run(['validate'])
    expect(noPath.code).toBe(2)
    expect(noPath.stderr).toContain('validate wants a plan path')

    const noSub = await run(['conditions'])
    expect(noSub.code).toBe(2)
    expect(noSub.stderr).toContain('conditions wants a verb')

    const badSub = await run(['conditions', 'provision', 'x'])
    expect(badSub.code).toBe(2)
    expect(badSub.stderr).toContain('unknown conditions verb')

    const extra = await run(['validate', T1_PLAN, 'extra'])
    expect(extra.code).toBe(2)
    expect(extra.stderr).toContain('unexpected argument')
  })
})

describe('dsh-eval run --dry-run', () => {
  it('rehearses offline: plan sha, resolved conditions, seeded order, and the template on stdout', async () => {
    const { code, stdout, stderr } = await run(['run', T1_PLAN, '--dry-run'])
    expect(code).toBe(0)
    const out = JSON.parse(stdout) as {
      planSha: string
      conditions: Array<{ id: string; sha: string }>
      order: { seed: number; sequence: string[] }
      concurrency: number
      template: { states: string[]; transitions: unknown[]; releasableStates: string[] }
    }
    expect(out.planSha).toMatch(/^[0-9a-f]{64}$/)
    expect(out.conditions).toHaveLength(1)
    expect(out.conditions[0]?.id).toBe('dsh-exec')
    expect(out.order).toEqual({ seed: 42, sequence: ['p0-placeholder-dsh-exec-rep1'] })
    expect(out.concurrency).toBe(1)
    expect(out.template.states).toContain('stage-1')
    expect(stderr).toContain('dry-run ok — 1 cell(s)')
  })

  it('the dry-run report is a stable snapshot for the same plan', async () => {
    const { stdout } = await run(['run', T1_PLAN, '--dry-run'])
    const out = JSON.parse(stdout) as Record<string, unknown>
    // Deterministic end to end: the plan sha, the condition hash, the seeded
    // order, and the generated template. Any drift shows here.
    expect(out).toMatchInlineSnapshot(`
      {
        "concurrency": 1,
        "conditions": [
          {
            "id": "dsh-exec",
            "sha": "d81ebc695e3b15e0594eaccf96056369617a060e9fbfa1a8e664f7e475a78f79",
          },
        ],
        "order": {
          "seed": 42,
          "sequence": [
            "p0-placeholder-dsh-exec-rep1",
          ],
        },
        "planSha": "67e3b85dabf68c63ca5a682ee443c3cd8a3fd2d583aedb3bf3167529335f2b3d",
        "template": {
          "missions": [
            {
              "id": "p0-placeholder-dsh-exec-rep1",
              "labels": {
                "condition": "dsh-exec",
                "rep": "1",
                "task": "P0-placeholder",
              },
              "title": "P0-placeholder × dsh-exec × rep1",
            },
          ],
          "name": "harness-comparison-v1",
          "releasableStates": [
            "releasable",
          ],
          "states": [
            "pending",
            "ws-ready",
            "stage-1",
            "stage-2",
            "judged",
            "halted",
            "archived",
            "releasable",
            "released",
          ],
          "transitions": [
            {
              "from": "pending",
              "guard": {
                "inputFrom": "run-meta",
                "schemaPath": "../schemas/run-meta.json",
                "type": "schema-check",
              },
              "to": "ws-ready",
            },
            {
              "from": "ws-ready",
              "to": "stage-1",
            },
            {
              "from": "stage-1",
              "guard": {
                "schemaPath": "../schemas/stage1.json",
                "type": "schema-check",
              },
              "to": "stage-2",
            },
            {
              "from": "stage-2",
              "guard": {
                "schemaPath": "../schemas/stage2.json",
                "type": "schema-check",
              },
              "to": "judged",
            },
            {
              "from": "judged",
              "to": "archived",
            },
            {
              "from": "halted",
              "to": "archived",
            },
            {
              "from": "archived",
              "guard": {
                "dir": "archive",
                "expectedFiles": [
                  "workspace/",
                  "verdicts/",
                ],
                "type": "file-check",
              },
              "to": "releasable",
            },
            {
              "from": "releasable",
              "to": "released",
            },
            {
              "from": "stage-2",
              "guard": {
                "schemaPath": "../schemas/stage2-halted.json",
                "type": "schema-check",
              },
              "to": "halted",
            },
          ],
        },
      }
    `)
  })

  it('without --dry-run the CLI refuses: a run starts from a live session', async () => {
    const { code, stdout, stderr } = await run(['run', T1_PLAN])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('refusing')
    expect(stderr).toContain('/eval run')
  })

  it('unknown flags to run exit 2', async () => {
    const { code, stderr } = await run(['run', T1_PLAN, '--dry-run', '--boom'])
    expect(code).toBe(2)
    expect(stderr).toContain('--boom')
  })
})

describe('dsh-eval template', () => {
  it('generates the manifest template; a stage subset matches the hand-written bench-v1 machine', async () => {
    const { code, stdout, stderr } = await run(['template', join(FIXTURE_DATASET, 'manifest.yml'), '--stages', 'stage1,stage2'])
    expect(code).toBe(0)
    const template = JSON.parse(stdout) as { states: string[]; transitions: Array<Record<string, unknown>>; releasableStates: string[] }
    const bench = JSON.parse(readFileSync(join(FIXTURE_DATASET, 'templates', 'bench-v1.json'), 'utf8')) as {
      states: string[]
      transitions: Array<Record<string, unknown>>
      releasableStates: string[]
    }
    expect(template.states).toEqual(bench.states)
    expect(template.transitions).toEqual(bench.transitions)
    expect(template.releasableStates).toEqual(bench.releasableStates)
    expect(stderr).toContain('9 states')
  })

  it('the full manifest refuses: stage3/stage4 still carry the retired inline draft notation', async () => {
    const { code, stdout, stderr } = await run(['template', join(FIXTURE_DATASET, 'manifest.yml')])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('stage3')
    expect(stderr).toContain('structured schema file reference')
  })
})
