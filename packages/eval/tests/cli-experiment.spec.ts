/**
 * T73 — the two CLI verbs an experiment brought: `run --experiment <id>` and
 * `import --from <id>@<ref>`. Both need the instance (its registry and its
 * state root), so offline they refuse and name `--instance`; through an
 * instance they pass the request through verbatim. The instance transport is
 * mocked here — what is pinned is what this process asks for, not HTTP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureIo } from './helpers.ts'

const calls = vi.hoisted(() => ({
  run: [] as unknown[],
  call: [] as Array<{ method: string; args: unknown }>,
}))

vi.mock('../src/instance.ts', () => ({
  authenticateInstance: () => Promise.resolve('cookie'),
  callInstance: (_target: unknown, method: string, args: unknown) => {
    calls.call.push({ method, args })
    return Promise.resolve({
      from: 'dataseek-eval@i4-pilot-d',
      refCommit: 'fd04079'.padEnd(40, '0'),
      experiments: [{ experimentId: 'pilot-d-preset-20260924-1a2b', name: 'pilot-d-preset', path: 'p', commit: 'c', conditions: [], created: true }],
      skipped: [],
      conditionsAdded: ['a', 'b'],
      conditionsSame: ['c'],
    })
  },
  runOnInstance: (_target: unknown, request: unknown) => {
    calls.run.push(request)
    return Promise.resolve({ status: 'running' })
  },
}))

const { runCli } = await import('../src/cli-core.ts')

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { io, stdout, stderr } = captureIo()
  const code = await runCli(args, io)
  return { code, stdout: stdout(), stderr: stderr() }
}

beforeEach(() => {
  calls.run.length = 0
  calls.call.length = 0
})

describe('dsh-eval run --experiment', () => {
  it('passes the experiment id to the instance, not a plan path', async () => {
    const result = await run(['run', '--experiment', 'pilot-d-preset-20260924-1a2b', '--instance', 'http://127.0.0.1:1', '--keep-units', '--no-follow'])
    expect(result.code).toBe(0)
    expect(calls.run).toEqual([{ experimentId: 'pilot-d-preset-20260924-1a2b', keepUnits: true }])
  })

  it('refuses offline and names --instance — the pin needs the instance\'s registry', async () => {
    const result = await run(['run', '--experiment', 'pilot-d-preset-20260924-1a2b', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--instance <url>')
    expect(calls.run).toEqual([])
  })

  it('refuses an id that is a path, and a run with neither an experiment nor a plan', async () => {
    const path = await run(['run', '--experiment', '../plans/x.json', '--instance', 'http://127.0.0.1:1'])
    expect(path.code).toBe(2)
    expect(path.stderr).toContain('--experiment wants an experiment id')

    const neither = await run(['run', '--instance', 'http://127.0.0.1:1'])
    expect(neither.code).toBe(2)
    expect(neither.stderr).toContain('run wants --experiment <id>')
  })
})

describe('dsh-eval import', () => {
  it('asks the instance to import and summarizes the counts', async () => {
    const result = await run(['import', '--from', 'dataseek-eval@i4-pilot-d', '--plan', 'pilot-d-preset', '--instance', 'http://127.0.0.1:1'])
    expect(result.code).toBe(0)
    expect(calls.call).toEqual([{
      method: 'importExperiments',
      args: { request: { from: 'dataseek-eval@i4-pilot-d', plan: 'pilot-d-preset' } },
    }])
    expect(result.stderr).toContain('1 experiment(s) created, 0 already there, 0 skipped; conditions: 2 added, 1 identical')
  })

  it('refuses offline, and without --from', async () => {
    const offline = await run(['import', '--from', 'dataseek-eval@main'])
    expect(offline.code).toBe(1)
    expect(offline.stderr).toContain('--instance <url>')

    const noFrom = await run(['import', '--instance', 'http://127.0.0.1:1'])
    expect(noFrom.code).toBe(2)
    expect(noFrom.stderr).toContain('import wants --from')
    expect(calls.call).toEqual([])
  })
})
