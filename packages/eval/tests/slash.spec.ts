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
