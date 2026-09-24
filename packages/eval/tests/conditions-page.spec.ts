/**
 * The conditions page's two WRITES (I5·T58).
 *
 * Step 4 of the walkthrough cost six human actions where it should cost two,
 * and four of the six were this page's missing half: `model.endpoint` had no
 * input anywhere (G6), and provisioning took two runs with a 64-character
 * digest copied between them (G7). Both are one click here, and neither is
 * reachable from a model tool — provisioning decides what a subject IS, which
 * R1 keeps beside 批准并启动 and 终评.
 *
 * Both write into the deployment's condition library
 * (`$DSH_HOME/state/eval/conditions/`, T73) — there is no bound repository to
 * pick any more, so neither takes a dataset or a session.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalService } from '../src/service.ts'
import { EvalConditionEditRefused } from '../src/condition-edit.ts'
import type { LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus } from '../src/faces.ts'
import { cleanupTmp, tmpTree, useDshHome, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const DSH_EXEC = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: null, drive: 'exec' },
  model: { declared: 'deepseek-v4-flash', endpoint: null },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: ['DEEPSEEK_API_KEY'] },
} as const

/** A local-agent face over a real homes root — the three read verbs provision uses. */
function fakeLocalAgent(homesRoot: string): LocalAgentFace {
  return {
    start: () => Promise.reject(new Error('the conditions page never delegates')),
    resume: () => Promise.reject(new Error('the conditions page never delegates')),
    cancel: () => false,
    get: () => undefined,
    homeDir(harness: string, scope?: string): string {
      const dir = join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'settings.json'), '{"written by /dsh login": true}\n')
      return dir
    },
    statusOf(harness: string, scope?: string): Promise<LocalAgentScopeStatus> {
      return Promise.resolve({
        name: harness,
        homeDir: this.homeDir?.(harness, scope) ?? '',
        credentialState: 'present-unverified',
        ...(scope === undefined ? {} : { scope }),
        loginable: true,
      })
    },
    effectiveSettings(): Promise<LocalAgentEffectiveSettingsFace | undefined> {
      // dsh-shaped: a harness with no snapshot at all, so every field reads
      // `unknown` and nothing errors. This spec is about the WRITES.
      return Promise.resolve(undefined)
    },
  } as LocalAgentFace
}

/** A deployment whose condition library holds one condition. */
function bound(overrides: Record<string, unknown> = {}): {
  library: string
  homesRoot: string
  conditionPath: string
  service: EvalService
} {
  const { stateRoot } = useDshHome()
  const library = join(stateRoot, 'conditions')
  const homesRoot = join(tmpTree(), 'homes')
  const conditionPath = writeJson(library, 'dsh-exec.json', { ...DSH_EXEC, ...overrides })
  const localAgent = fakeLocalAgent(homesRoot)
  const service = new EvalService({
    get: (name: string) => (name === 'localAgent' ? localAgent : undefined),
  })
  return { library, homesRoot, conditionPath, service }
}

describe('provisionCondition — one click, and the condition is ready (G7)', () => {
  it('corrects home.sha in the declaration and locks the corrected document', async () => {
    const { conditionPath, service } = bound()

    const view = await service.provisionCondition({ condition: 'dsh-exec' })

    expect(view.written).toBe(true)
    expect(view.homeShaWritten).toBe(true)
    const document = JSON.parse(readFileSync(conditionPath, 'utf8')) as { home: { sha: string } }
    expect(document.home.sha).toBe(view.homeSha)
    expect(view.sha).toBe(hashConditionDocument(document))
    // The row comes back with the answer, so the table never has to re-read a
    // directory to learn what its own click produced.
    expect(view.row).toMatchObject({ id: 'dsh-exec', status: 'ready', lock: { present: true, matches: true } })
  })

  it('leaves the declaration alone when the caller asks for the two-step shape', async () => {
    const { conditionPath, service } = bound()
    const before = readFileSync(conditionPath, 'utf8')

    const view = await service.provisionCondition(
      { condition: 'dsh-exec', keepDeclaration: true }
    )

    expect(readFileSync(conditionPath, 'utf8')).toBe(before)
    expect(view.homeShaWritten).toBe(false)
    // And the condition is NOT ready, which is the state that used to need a
    // second provision to leave.
    expect(view.row?.status).not.toBe('ready')
  })

  it('answers with the same ok / warn / error lines the plan-review page renders', async () => {
    const { service } = bound()
    const view = await service.provisionCondition({ condition: 'dsh-exec' })

    expect(view.checks.length).toBeGreaterThan(0)
    for (const check of view.checks) expect(['ok', 'warn', 'error']).toContain(check.severity)
    expect(view.checks.some(check => check.code === 'HOME_SHA_WRITTEN')).toBe(true)
  })

  it('never puts a tick beside a field the declaration left null', async () => {
    // `model.endpoint: null` is the reason the readiness gate refuses this
    // condition, and provision reports it with no severity only because there
    // was nothing to compare it against (I5·T58 · G6).
    const { service } = bound()
    const view = await service.provisionCondition({ condition: 'dsh-exec' })
    const endpoint = view.checks.find(check => check.message.startsWith('model.endpoint:'))

    expect(endpoint).toMatchObject({ severity: 'warn', code: 'UNRESOLVED_FIELD' })
  })

  it('refuses a condition id that is not a file name', async () => {
    const { service } = bound()

    await expect(service.provisionCondition({ condition: '../../escape' }))
      .rejects.toThrow(/not a usable name/)
  })
})

describe('setConditionEndpoint — the field the readiness gate refuses (G6)', () => {
  it('writes it, re-hashes the condition, and says the lock beside it is now stale', async () => {
    const { conditionPath, service } = bound()
    // A locked, ready condition: the edit is what makes its lock stale.
    await service.provisionCondition({ condition: 'dsh-exec' })

    const view = await service.setConditionEndpoint(
      { condition: 'dsh-exec', endpoint: 'default' }
    )

    expect(view.written).toBe(true)
    expect(view).toMatchObject({ before: null, after: 'default', lockStale: true })
    const document = JSON.parse(readFileSync(conditionPath, 'utf8')) as { model: { endpoint: string } }
    expect(document.model.endpoint).toBe('default')
    expect(view.sha).toBe(hashConditionDocument(document))
    expect(view.row?.unresolved).not.toContain('model.endpoint')
  })

  it('writes nothing when the value is already what was asked for', async () => {
    const { conditionPath, service } = bound({ model: { declared: 'deepseek-v4-flash', endpoint: 'default' } })
    const before = readFileSync(conditionPath, 'utf8')

    const view = await service.setConditionEndpoint(
      { condition: 'dsh-exec', endpoint: 'default' }
    )

    expect(view.written).toBe(false)
    expect(readFileSync(conditionPath, 'utf8')).toBe(before)
  })

  it('an empty value declares "not resolved yet", which is legal and not ready', async () => {
    const { service } = bound({ model: { declared: 'deepseek-v4-flash', endpoint: 'default' } })

    const view = await service.setConditionEndpoint({ condition: 'dsh-exec', endpoint: '' })

    expect(view.after).toBeNull()
    expect(view.row?.unresolved).toContain('model.endpoint')
  })

  it('touches only model.endpoint, leaving every other field byte for byte', async () => {
    const { conditionPath, service } = bound()
    const before = JSON.parse(readFileSync(conditionPath, 'utf8')) as Record<string, unknown>

    await service.setConditionEndpoint({ condition: 'dsh-exec', endpoint: 'default' })

    const after = JSON.parse(readFileSync(conditionPath, 'utf8')) as Record<string, unknown>
    expect({ ...after, model: undefined }).toEqual({ ...before, model: undefined })
    expect(Object.keys(after)).toEqual(Object.keys(before))
  })

  it('refuses a declaration nothing else would accept either', async () => {
    const { library, service } = bound()
    writeJson(library, 'broken.json', { schema: 'dataseek.condition/1' })

    await expect(service.setConditionEndpoint({ condition: 'broken', endpoint: 'default' }))
      .rejects.toThrow(EvalConditionEditRefused)
  })
})
