/**
 * The `/eval` slash face: a thin wrapper over the service verb. `run
 * --dry-run` works anywhere (the offline kernel needs no host); a live run
 * outside a host context is refused, honestly.
 */
import { describe, expect, it } from 'vitest'
import { handleEvalCommand } from '../src/slash.ts'
import { EvalService } from '../src/service.ts'

const FIXTURE_DATASET = join(import.meta.dirname, 'fixtures/dataset/datasets/harness-comparison')
const T1_PLAN = join(FIXTURE_DATASET, 'plans/i1-walk.json')

import { join } from 'node:path'

function invocation(rawInput: string): Parameters<typeof handleEvalCommand>[1] {
  return { rawInput, agent: { session: { id: 'sess-eval-slash' } } } as Parameters<typeof handleEvalCommand>[1]
}

describe('/eval', () => {
  it('run --dry-run prints the rehearsal from the invoking session', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run`))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('dry-run')
    expect(result.text).toContain('p0-placeholder-dsh-exec-rep1')
  })

  it('run without arguments, unknown verbs, and bad flags answer with usage or errors', async () => {
    const bare = await handleEvalCommand(new EvalService(), invocation('run'))
    expect(bare.kind).toBe('error')
    expect(bare.text).toContain('exactly one plan path')

    const unknown = await handleEvalCommand(new EvalService(), invocation('deploy something'))
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('unknown /eval verb')

    const badConcurrency = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --concurrency zero`))
    expect(badConcurrency.kind).toBe('error')
    expect(badConcurrency.text).toContain('--concurrency')
  })

  it('a live run outside a host context is refused (decision 1: the session is the origin)', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN}`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no host context')
  })
})

describe('/eval finalize', () => {
  /** A host whose `mission` service is the finalize face the verb needs. */
  const hostWith = (rows: Array<{ id: string; state: string }>): { get(name: string): unknown } => {
    const states = new Map(rows.map(row => [row.id, row.state]))
    const mission = {
      runStatus: () => ({ rows: [...states].map(([id, state]) => ({ id, state })) }),
      transition: async (id: string, to: string) => {
        const declared: Record<string, string> = { archived: 'releasable', releasable: 'released' }
        if (declared[states.get(id) ?? ''] !== to) throw new Error(`transition to ${to} is not declared`)
        states.set(id, to)
        return { changed: true }
      },
      annotate: async () => ({ added: true }),
    }
    return { get: (name: string) => (name === 'mission' ? mission : undefined) }
  }

  it('walks the archived cells and prints why every other cell was skipped', async () => {
    const service = new EvalService(hostWith([
      { id: 'cell-a', state: 'archived' },
      { id: 'cell-b', state: 'released' },
      { id: 'cell-c', state: 'stage-2' },
      { id: 'cell-d', state: 'pending' },
    ]))
    const result = await handleEvalCommand(service, invocation('finalize run-1'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('1 released, 0 gate-refused, 3 skipped')
    expect(result.text).toContain('1 released（已终结）跳过、1 中断（未走到 archived）跳过、1 pending（未开跑）跳过')
    expect(result.text).toContain('cell-a: archived → released')
    expect(result.text).toContain('cell-c: skipped (stage-2)')
  })

  it('refuses honestly when the composition has no mission service', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation('finalize run-1'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no mission service')
  })

  it('wants exactly one run id', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation('finalize'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('exactly one run id')
  })
})

describe('/eval run — the subset flags', () => {
  it('--only and --max-cells reach the kernel and are echoed as the subset', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --max-cells 1`))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('subset: --max-cells 1 — 1 of 1 cell(s)')
  })

  it('a full-matrix run prints no subset line', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run`))
    expect(result.text).not.toContain('subset:')
  })

  it('rejects a --max-cells that is not a positive integer', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --max-cells 0`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('--max-cells must be a positive integer')
  })

  it('--only takes a comma-separated list and refuses an id the matrix lacks', async () => {
    const result = await handleEvalCommand(new EvalService(), invocation(`run ${T1_PLAN} --dry-run --only nope-1,nope-2`))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('2 cell(s) the plan')
  })
})
