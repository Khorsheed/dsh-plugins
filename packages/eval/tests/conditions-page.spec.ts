/**
 * The conditions page's two WRITES (I5·T58), and the rule that keeps the
 * repository a human's choice.
 *
 * Step 4 of the walkthrough cost six human actions where it should cost two,
 * and four of the six were this page's missing half: `model.endpoint` had no
 * input anywhere (G6), and provisioning took two runs with a 64-character
 * digest copied between them (G7). Both are one click here, and neither is
 * reachable from a model tool — provisioning decides what a subject IS, which
 * R1 keeps beside 批准并启动 and 终评.
 *
 * The third thing pinned here is `resolveRepoScope`'s agent narrowing (G1):
 * a `repo` argument from a model tool may only restate the session's binding,
 * including when the two are spelled differently.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashConditionDocument } from '../src/hash.ts'
import { EvalService } from '../src/service.ts'
import { EvalConditionEditRefused } from '../src/condition-edit.ts'
import { normalizeRepoPath, sameRepoPath } from '../src/validate.ts'
import type { LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus } from '../src/faces.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

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

/** A repository whose session `s1` is bound to it, with one condition in it. */
function bound(overrides: Record<string, unknown> = {}): {
  repo: string
  homesRoot: string
  conditionPath: string
  service: EvalService
} {
  const root = tmpTree()
  const repo = join(root, 'repo')
  const homesRoot = join(root, 'homes')
  const conditionPath = writeJson(join(repo, 'datasets', 'ds', 'conditions'), 'dsh-exec.json', { ...DSH_EXEC, ...overrides })
  const datasets = { binding: (session: { id: string }) => (session.id === 's1' ? { repoPath: repo } : undefined) }
  const localAgent = fakeLocalAgent(homesRoot)
  const service = new EvalService({
    get: (name: string) => (name === 'datasets' ? datasets : name === 'localAgent' ? localAgent : undefined),
  })
  return { repo, homesRoot, conditionPath, service }
}

const SESSION = { session: { id: 's1' } }

describe('provisionCondition — one click, and the condition is ready (G7)', () => {
  it('corrects home.sha in the declaration and locks the corrected document', async () => {
    const { conditionPath, service } = bound()

    const view = await service.provisionCondition({ dataset: 'ds', condition: 'dsh-exec' }, SESSION)

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
      { dataset: 'ds', condition: 'dsh-exec', keepDeclaration: true },
      SESSION,
    )

    expect(readFileSync(conditionPath, 'utf8')).toBe(before)
    expect(view.homeShaWritten).toBe(false)
    // And the condition is NOT ready, which is the state that used to need a
    // second provision to leave.
    expect(view.row?.status).not.toBe('ready')
  })

  it('answers with the same ok / warn / error lines the plan-review page renders', async () => {
    const { service } = bound()
    const view = await service.provisionCondition({ dataset: 'ds', condition: 'dsh-exec' }, SESSION)

    expect(view.checks.length).toBeGreaterThan(0)
    for (const check of view.checks) expect(['ok', 'warn', 'error']).toContain(check.severity)
    expect(view.checks.some(check => check.code === 'HOME_SHA_WRITTEN')).toBe(true)
  })

  it('never puts a tick beside a field the declaration left null', async () => {
    // `model.endpoint: null` is the reason the readiness gate refuses this
    // condition, and provision reports it with no severity only because there
    // was nothing to compare it against (I5·T58 · G6).
    const { service } = bound()
    const view = await service.provisionCondition({ dataset: 'ds', condition: 'dsh-exec' }, SESSION)
    const endpoint = view.checks.find(check => check.message.startsWith('model.endpoint:'))

    expect(endpoint).toMatchObject({ severity: 'warn', code: 'UNRESOLVED_FIELD' })
  })

  it('refuses a condition id that is not a file name, and an unbound session', async () => {
    const { service } = bound()

    await expect(service.provisionCondition({ dataset: 'ds', condition: '../../escape' }, SESSION))
      .rejects.toThrow(/not a usable name/)
    await expect(service.provisionCondition({ dataset: 'ds', condition: 'dsh-exec' }, { session: { id: 's2' } }))
      .rejects.toThrow(/\/datasets bind/)
  })
})

describe('setConditionEndpoint — the field the readiness gate refuses (G6)', () => {
  it('writes it, re-hashes the condition, and says the lock beside it is now stale', async () => {
    const { conditionPath, service } = bound()
    // A locked, ready condition: the edit is what makes its lock stale.
    await service.provisionCondition({ dataset: 'ds', condition: 'dsh-exec' }, SESSION)

    const view = await service.setConditionEndpoint(
      { dataset: 'ds', condition: 'dsh-exec', endpoint: 'default' },
      SESSION,
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
      { dataset: 'ds', condition: 'dsh-exec', endpoint: 'default' },
      SESSION,
    )

    expect(view.written).toBe(false)
    expect(readFileSync(conditionPath, 'utf8')).toBe(before)
  })

  it('an empty value declares "not resolved yet", which is legal and not ready', async () => {
    const { service } = bound({ model: { declared: 'deepseek-v4-flash', endpoint: 'default' } })

    const view = await service.setConditionEndpoint({ dataset: 'ds', condition: 'dsh-exec', endpoint: '' }, SESSION)

    expect(view.after).toBeNull()
    expect(view.row?.unresolved).toContain('model.endpoint')
  })

  it('touches only model.endpoint, leaving every other field byte for byte', async () => {
    const { conditionPath, service } = bound()
    const before = JSON.parse(readFileSync(conditionPath, 'utf8')) as Record<string, unknown>

    await service.setConditionEndpoint({ dataset: 'ds', condition: 'dsh-exec', endpoint: 'default' }, SESSION)

    const after = JSON.parse(readFileSync(conditionPath, 'utf8')) as Record<string, unknown>
    expect({ ...after, model: undefined }).toEqual({ ...before, model: undefined })
    expect(Object.keys(after)).toEqual(Object.keys(before))
  })

  it('refuses a declaration nothing else would accept either', async () => {
    const { repo, service } = bound()
    writeJson(join(repo, 'datasets', 'ds', 'conditions'), 'broken.json', { schema: 'dataseek.condition/1' })

    await expect(service.setConditionEndpoint({ dataset: 'ds', condition: 'broken', endpoint: 'default' }, SESSION))
      .rejects.toThrow(EvalConditionEditRefused)
  })
})

describe('the repo argument an agent may pass (G1)', () => {
  it('accepts a spelling of the binding that differs from the recorded one', async () => {
    const { repo, service } = bound()
    // A symlink to the same directory: the shape a binding recorded as
    // `~/…` and an argument typed as an absolute path arrive in.
    const alias = join(tmpTree(), 'alias')
    symlinkSync(repo, alias)

    expect(sameRepoPath(alias, repo)).toBe(true)
    expect(normalizeRepoPath(`${repo}/`)).toBe(normalizeRepoPath(repo))

    const report = await service.conditions({ ...SESSION, agent: true, repo: alias })
    expect(report.conditions.map(condition => condition.id)).toEqual(['dsh-exec'])
  })

  it('refuses a repository that is not the binding, and names both', async () => {
    const { repo, service } = bound()
    const elsewhere = join(tmpTree(), 'shared-checkout')
    mkdirSync(join(elsewhere, 'datasets'), { recursive: true })

    await expect(service.conditions({ ...SESSION, agent: true, repo: elsewhere }))
      .rejects.toThrow(new RegExp(`is not this session's bound dataset repository \\(${repo}\\)`))
  })

  it('still lets a HUMAN caller name one — the CLI flag and the tab are not the agent', async () => {
    const { repo, service } = bound()
    const report = await service.conditions({ repo })
    expect(report.conditions.map(condition => condition.id)).toEqual(['dsh-exec'])
  })

  it('normalizes a path that does not exist rather than refusing to compare', () => {
    const missing = join(tmpTree(), 'not-created-yet')
    expect(normalizeRepoPath(missing)).toBe(missing)
    expect(sameRepoPath(missing, `${missing}/`)).toBe(true)
  })
})
