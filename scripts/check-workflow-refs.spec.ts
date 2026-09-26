import { describe, expect, it } from 'vitest'
import { checkHarnessPinLockstep, checkWorkflow, runBlocks } from './check-workflow-refs.ts'

// The regression this checker exists for, verbatim: the step cc31c1a left
// behind when it deleted scripts/sync-harness-paths.mjs.
const RETIRED_STEP = `jobs:
  gates:
    steps:
      - name: Generate taskpilot harness type paths
        run: node scripts/sync-harness-paths.mjs
        env:
          DSH_HARNESS: \${{ github.workspace }}/deepseek-harness
`

describe('checkWorkflow', () => {
  it('flags a step invoking a script that no longer exists', () => {
    const findings = checkWorkflow('ci.yml', RETIRED_STEP, new Set())
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      step: 'Generate taskpilot harness type paths',
      reference: 'scripts/sync-harness-paths.mjs',
      reason: 'file does not exist',
    })
  })

  it('accepts a script that does exist', () => {
    const yaml = 'jobs:\n  g:\n    steps:\n      - name: Hooks\n        run: node scripts/setup-hooks.mjs\n'
    expect(checkWorkflow('ci.yml', yaml, new Set())).toEqual([])
  })

  it('flags a pnpm run target missing from package.json', () => {
    const yaml = 'jobs:\n  g:\n    steps:\n      - name: Gate\n        run: pnpm run no-such-script\n'
    expect(checkWorkflow('ci.yml', yaml, new Set(['build']))).toMatchObject([
      { reference: 'no-such-script', reason: 'not a script in package.json' },
    ])
    expect(checkWorkflow('ci.yml', yaml, new Set(['no-such-script']))).toEqual([])
  })

  it('skips steps that run inside the cloned harness checkout', () => {
    const yaml = `jobs:
  g:
    steps:
      - name: Build harness libs
        working-directory: deepseek-harness
        run: node scripts/not-ours.mjs
`
    expect(checkWorkflow('ci.yml', yaml, new Set())).toEqual([])
  })

  it('reads block scalars, where multi-command gates live', () => {
    const yaml = `jobs:
  g:
    steps:
      - name: Doc gates
        run: |
          pnpm run verify-agent-note-format
          pnpm run verify-translation-pairing
`
    const blocks = runBlocks(yaml)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.run).toContain('verify-translation-pairing')
    expect(checkWorkflow('ci.yml', yaml, new Set(['verify-agent-note-format']))).toMatchObject([
      { reference: 'verify-translation-pairing' },
    ])
  })
})

describe('checkHarnessPinLockstep', () => {
  const clone = (ref: string): string => `jobs:
  g:
    steps:
      - name: Clone deepseek-harness (type/test seed)
        uses: actions/checkout@v4
        with:
          repository: deepseek-ai/deepseek-harness
          ref: ${ref}
          path: deepseek-harness
`

  it('flags a workflow cloning the harness at a different tag than the rest', () => {
    const findings = checkHarnessPinLockstep([['ci.yml', clone('dsh-v0.1.7-rc.1')], ['publish.yml', clone('dsh-v0.1.5-rc.1')]])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ workflow: 'publish.yml', reference: 'dsh-v0.1.5-rc.1' })
    expect(findings[0]!.reason).toContain('dsh-v0.1.7-rc.1')
  })

  it('passes matching pins and ignores the dynamic next-compat lane', () => {
    const yaml = `${clone('dsh-v0.1.7-rc.1')}
      - name: Clone deepseek-harness (next)
        uses: actions/checkout@v4
        with:
          repository: deepseek-ai/deepseek-harness
          ref: \${{ steps.next.outputs.ref }}
          path: deepseek-harness-next
`
    expect(checkHarnessPinLockstep([['ci.yml', yaml], ['publish.yml', clone('dsh-v0.1.7-rc.1')]])).toEqual([])
  })

  it('passes when no workflow clones the harness at a static tag', () => {
    expect(checkHarnessPinLockstep([['ci.yml', 'jobs: {}']])).toEqual([])
  })
})
