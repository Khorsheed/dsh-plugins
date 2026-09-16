import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkAgainstEffective, flattenEffective, type EffectiveSnapshot } from '../src/effective.ts'
import { hashConditionDocument, hashHome } from '../src/hash.ts'
import { EvalProvisionRefused, loginCommandFor, provisionCondition } from '../src/provision.ts'
import { LOCK_SCHEMA, validateJson } from '../src/schema.ts'
import type { LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus } from '../src/faces.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

/**
 * T31 — `conditions provision`, the one writer of a condition lock.
 *
 * Each of its five steps is a stop, and each stop is pinned here: the scoped
 * home it resolves, the credential it refuses to proceed without, the
 * field-by-field check against that scope, the home hash, and the lock itself.
 */

const CODEX_CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: [] },
} as const

/** The codex scope that agrees with {@link CODEX_CONDITION} on every field. */
function agreeingSettings(over: Partial<LocalAgentEffectiveSettingsFace> = {}): LocalAgentEffectiveSettingsFace {
  return {
    drive: 'exec',
    sandbox: 'workspace-write',
    reasoningEffort: 'default',
    baseUrlSet: false,
    cliVersion: '0.144.0',
    model: 'gpt-5.6-sol',
    ...over,
  }
}

interface FakeOptions {
  credentialState?: LocalAgentScopeStatus['credentialState']
  settings?: LocalAgentEffectiveSettingsFace | undefined
  /** Drop a method off the face entirely (a facade predating it). */
  without?: 'homeDir' | 'statusOf' | 'effectiveSettings'
}

/** A local-agent face over a real directory, with the three read verbs provision uses. */
function fakeLocalAgent(homesRoot: string, options: FakeOptions = {}): LocalAgentFace & { asked: string[] } {
  const asked: string[] = []
  const face = {
    asked,
    start: () => Promise.reject(new Error('provision never delegates')),
    resume: () => Promise.reject(new Error('provision never delegates')),
    cancel: () => false,
    get: () => undefined,
    homeDir(harness: string, scope?: string): string {
      const dir = join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)
      mkdirSync(dir, { recursive: true }) // reading it materializes it, as the family does
      return dir
    },
    statusOf(harness: string, scope?: string): Promise<LocalAgentScopeStatus> {
      asked.push(`status:${harness}${scope === undefined ? '' : `@${scope}`}`)
      return Promise.resolve({
        name: harness,
        homeDir: face.homeDir(harness, scope),
        credentialState: options.credentialState ?? 'present-unverified',
        ...(scope === undefined ? {} : { scope }),
        loginable: true,
      })
    },
    effectiveSettings(harness: string, scope?: string): Promise<LocalAgentEffectiveSettingsFace | undefined> {
      asked.push(`effective:${harness}${scope === undefined ? '' : `@${scope}`}`)
      return Promise.resolve('settings' in options ? options.settings : agreeingSettings())
    },
  } as LocalAgentFace & { asked: string[] }
  if (options.without !== undefined) delete (face as Record<string, unknown>)[options.without]
  return face
}

/** A repo working copy holding one condition, plus a homes root. */
function tree(condition: Record<string, unknown> = { ...CODEX_CONDITION }): {
  repo: string
  homesRoot: string
  conditionPath: string
  lockPath: string
} {
  const root = tmpTree()
  const repo = join(root, 'repo')
  const conditions = join(repo, 'datasets', 'ds', 'conditions')
  const conditionPath = writeJson(conditions, 'c1.json', condition)
  return { repo, homesRoot: join(root, 'homes'), conditionPath, lockPath: join(conditions, 'c1.lock.json') }
}

describe('conditions provision — step 1: the scoped home', () => {
  it('resolves the condition\'s (harness, scope) and materializes that directory', async () => {
    const { repo, homesRoot, conditionPath } = tree({ ...CODEX_CONDITION, scope: 'eval-b' })
    const localAgent = fakeLocalAgent(homesRoot)
    const report = await provisionCondition(conditionPath, { repo, localAgent })

    expect(report.scope).toBe('eval-b')
    expect(report.homeDir).toBe(join(homesRoot, 'codex@eval-b'))
    expect(existsSync(report.homeDir)).toBe(true)
    // Every read went to the NAMED scope — probing the default one would
    // prove another account's login.
    expect(localAgent.asked).toEqual(['status:codex@eval-b', 'effective:codex@eval-b'])
  })

  it('refuses a declaration outside the --repo working copy', async () => {
    const { homesRoot, conditionPath } = tree()
    const elsewhere = join(tmpTree(), 'other-repo')
    mkdirSync(elsewhere, { recursive: true })
    await expect(provisionCondition(conditionPath, { repo: elsewhere, localAgent: fakeLocalAgent(homesRoot) }))
      .rejects.toThrow(/not inside the dataset repository working copy/)
  })

  it('refuses a declaration that violates the contract — a lock on it would mean nothing', async () => {
    // `skip` is claude-code's word, not codex's — in the schema's union, out
    // of this harness's vocabulary.
    const { repo, homesRoot, conditionPath } = tree({ ...CODEX_CONDITION, permissions: 'skip' })
    const refused = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })
      .catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(EvalProvisionRefused)
    expect((refused as EvalProvisionRefused).diagnostics.map(d => d.code)).toContain('PERMISSION_NOT_FOR_HARNESS')
  })

  it('refuses a facade that cannot resolve a scoped home, rather than guessing one', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    await expect(provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot, { without: 'homeDir' }) }))
      .rejects.toThrow(/has no homeDir/)
  })
})

describe('conditions provision — step 2: the credential', () => {
  it.each([
    ['absent', 'CREDENTIAL_ABSENT'],
    ['rejected', 'CREDENTIAL_REJECTED'],
  ] as const)('stops on credentialState %s and prints the login command', async (credentialState, code) => {
    const { repo, homesRoot, conditionPath, lockPath } = tree({ ...CODEX_CONDITION, scope: 'eval-b' })
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot, { credentialState }) })

    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual([code])
    expect(report.errors[0]?.message).toContain('/codex login --scope eval-b')
    // It stopped BEFORE reading settings or hashing anything.
    expect(report.checks).toEqual([])
    expect(report.home).toBeNull()
  })

  it.each(['present-unverified', 'verified'] as const)('proceeds on credentialState %s', async (credentialState) => {
    const { repo, homesRoot, conditionPath } = tree()
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot, { credentialState }) })
    expect(report.written).toBe(true)
  })

  it('names the default scope without a --scope flag', () => {
    expect(loginCommandFor('codex', null)).toBe('/codex login')
    expect(loginCommandFor('codex', 'eval-b')).toBe('/codex login --scope eval-b')
  })

  it('refuses a facade that cannot grade a credential', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    await expect(provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot, { without: 'statusOf' }) }))
      .rejects.toThrow(/has no statusOf/)
  })
})

describe('conditions provision — step 3: the declaration against the scope', () => {
  it('writes no lock when permissions disagree — the approval boundary is the subject', async () => {
    const { repo, homesRoot, conditionPath, lockPath } = tree()
    const localAgent = fakeLocalAgent(homesRoot, { settings: agreeingSettings({ sandbox: 'danger-full-access' }) })
    const report = await provisionCondition(conditionPath, { repo, localAgent })

    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual(['EFFECTIVE_MISMATCH'])
    expect(report.errors[0]?.message).toContain('permissions')
    expect(report.errors[0]?.message).toContain('danger-full-access')
  })

  it('writes no lock when the endpoint disagrees', async () => {
    const { repo, homesRoot, conditionPath, lockPath } = tree()
    const localAgent = fakeLocalAgent(homesRoot, { settings: agreeingSettings({ baseUrlSet: true, baseUrlHost: 'proxy.internal' }) })
    const report = await provisionCondition(conditionPath, { repo, localAgent })

    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors[0]?.message).toContain('model.endpoint')
    expect(report.errors[0]?.message).toContain('proxy.internal')
  })

  it('still writes the lock when the model, effort or CLI version disagree — those are warnings', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    const localAgent = fakeLocalAgent(homesRoot, {
      settings: agreeingSettings({ model: 'gpt-5.6-terra', reasoningEffort: 'high', cliVersion: '0.145.0' }),
    })
    const report = await provisionCondition(conditionPath, { repo, localAgent })

    expect(report.written).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.filter(w => w.code === 'EFFECTIVE_MISMATCH').map(w => w.message.split(':')[0]))
      .toEqual(['harness.version', 'model.declared', 'reasoning.effort'])
  })

  it('back-fills a null harness.version into the lock, never into the condition document', async () => {
    const { repo, homesRoot, conditionPath } = tree({
      ...CODEX_CONDITION,
      harness: { name: 'codex', version: null, drive: 'exec' },
    })
    const report = await provisionCondition(conditionPath, {
      repo,
      localAgent: fakeLocalAgent(homesRoot),
      // The write-back is about home.sha and ONLY home.sha; asking for it off
      // keeps this test about the version back-fill.
      writeBack: false,
    })

    expect(report.checks.find(row => row.field === 'harness.version')?.status).toBe('backfilled')
    expect((report.lock?.['provisioned'] as { cliVersion: string }).cliVersion).toBe('0.144.0')
    // The detected version lands in the lock; the declaration still says null,
    // because what a CLI reports about itself is a measurement, not a claim the
    // condition's author made.
    const document = JSON.parse(readFileSync(conditionPath, 'utf8')) as { harness: { version: string | null } }
    expect(document.harness.version).toBeNull()
  })

  it('records an uncomparable field as a warning, never as agreement', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    // dsh-shaped: a harness with no snapshot at all.
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot, { settings: undefined }) })

    expect(report.written).toBe(true)
    expect(report.checks.map(row => row.status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown'])
    expect(report.warnings.filter(w => w.code === 'EFFECTIVE_UNCOMPARABLE')).toHaveLength(5)
    expect((report.lock?.['provisioned'] as { effective: Record<string, unknown> }).effective).toEqual({
      model: null, reasoningEffort: null, permissions: null, endpoint: null,
    })
  })

  it('reduces a declared endpoint URL to its host before comparing', () => {
    const snapshot = flattenEffective('codex', agreeingSettings({ baseUrlSet: true, baseUrlHost: 'api.anthropic.com' }))
    const rows = checkAgainstEffective({ ...CODEX_CONDITION, model: { declared: null, endpoint: 'https://api.anthropic.com/v1' } }, snapshot)
    expect(rows.find(row => row.field === 'model.endpoint')?.status).toBe('match')
  })

  it.each([
    ['claude-code', { permissionMode: 'skip' }, 'skip'],
    ['kimi', { autoApprove: true }, 'auto-approve'],
    ['kimi', { autoApprove: false }, 'no-auto-approve'],
    // dsh answers nothing until its deployment pins a boundary…
    ['dsh', {}, null],
    // …and `unrestricted` is earned by exactly one preset (T59).
    ['dsh', { sandbox: 'danger-full-access' }, 'unrestricted'],
    // A scope still confining its sub-dsh reads as itself, so a condition
    // claiming the container is the boundary mismatches loudly.
    ['dsh', { sandbox: 'workspace-write' }, 'workspace-write'],
  ] as const)('spells %s\'s permission knob in the condition vocabulary', (harness, over, expected) => {
    const snapshot = flattenEffective(harness, { drive: 'exec', baseUrlSet: false, ...over })
    expect(snapshot.permissions).toBe(expected)
  })
})

describe('conditions provision — steps 4 and 5: the home hash and the lock', () => {
  it('writes a contract-valid lock carrying the condition hash, the home hash and the provisioned snapshot', async () => {
    const { repo, homesRoot, conditionPath, lockPath } = tree()
    const localAgent = fakeLocalAgent(homesRoot)
    const homeDir = localAgent.homeDir?.('codex') as string
    writeFileSync(join(homeDir, 'config.toml'), 'model = "gpt-5.6-sol"\n')

    const report = await provisionCondition(conditionPath, { repo, localAgent, now: () => 1_757_500_000_000 })
    expect(report.written).toBe(true)

    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>
    expect(validateJson(LOCK_SCHEMA, lock)).toEqual([])
    expect(lock['schema']).toBe('dataseek.condition-lock/1')
    expect(lock['condition']).toBe('c1')
    expect(lock['sha']).toBe(hashConditionDocument(JSON.parse(readFileSync(conditionPath, 'utf8'))))
    expect(lock['home']).toEqual({ sha: (await hashHome(homeDir)).sha })
    expect(lock['provisioned']).toEqual({
      at: 1_757_500_000_000,
      cliVersion: '0.144.0',
      effective: { model: 'gpt-5.6-sol', reasoningEffort: 'default', permissions: 'workspace-write', endpoint: 'default' },
    })
  })

  it('writes the measured home.sha back into a declaration that leaves it null, and locks the corrected document', async () => {
    const { repo, homesRoot, conditionPath, lockPath } = tree()
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })

    // The declaration on disk now says what was measured — which is the whole
    // of I5·T39 · G7: the digest used to travel from a warning to an editor by
    // hand, and provision then had to run a second time to re-anchor the lock.
    const document = JSON.parse(readFileSync(conditionPath, 'utf8')) as { home: { sha: string } }
    expect(document.home.sha).toBe(report.home?.sha)
    expect(report.homeShaWritten).toBe(true)
    expect(report.shaBeforeWriteBack).not.toBe(report.sha)
    expect(report.warnings.map(w => w.code)).toContain('HOME_SHA_WRITTEN')

    // And the lock anchors the document as it NOW reads, so one provision is
    // what makes the condition ready.
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { sha: string; home: { sha: string } }
    expect(lock.sha).toBe(hashConditionDocument(document))
    expect(lock.sha).toBe(report.sha)
    expect(lock.home.sha).toBe(report.home?.sha)
  })

  it('corrects a STALE declared home.sha the same way', async () => {
    const stale = 'a'.repeat(64)
    const { repo, homesRoot, conditionPath } = tree({ ...CODEX_CONDITION, home: { sha: stale } })
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })

    expect(report.written).toBe(true)
    expect(report.homeShaWritten).toBe(true)
    const document = JSON.parse(readFileSync(conditionPath, 'utf8')) as { home: { sha: string } }
    expect(document.home.sha).toBe(report.home?.sha)
    expect(document.home.sha).not.toBe(stale)
    expect((report.lock?.['home'] as { sha: string }).sha).not.toBe(stale)
  })

  it('leaves the declaration alone with writeBack: false, and says what it would have written', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    const before = readFileSync(conditionPath, 'utf8')
    const report = await provisionCondition(conditionPath, {
      repo,
      localAgent: fakeLocalAgent(homesRoot),
      writeBack: false,
    })

    expect(readFileSync(conditionPath, 'utf8')).toBe(before)
    expect(report.homeShaWritten).toBe(false)
    expect(report.shaBeforeWriteBack).toBeNull()
    const warning = report.warnings.find(w => w.code === 'HOME_SHA_UNDECLARED')
    expect(warning?.message).toContain(report.home?.sha as string)
  })

  it('re-provisioning a corrected condition changes nothing and writes nothing back', async () => {
    const { repo, homesRoot, conditionPath } = tree()
    const first = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })
    const after = readFileSync(conditionPath, 'utf8')

    const second = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })

    // Idempotent: the second run has nothing to correct, so the document is
    // byte-identical and the condition keeps the identity the first one gave it.
    expect(readFileSync(conditionPath, 'utf8')).toBe(after)
    expect(second.homeShaWritten).toBe(false)
    expect(second.sha).toBe(first.sha)
    expect(second.warnings.map(w => w.code)).not.toContain('HOME_SHA_WRITTEN')
  })

  it('stale declared home.sha still reports the old way when the write-back is off', async () => {
    const stale = 'a'.repeat(64)
    const { repo, homesRoot, conditionPath } = tree({ ...CODEX_CONDITION, home: { sha: stale } })
    const report = await provisionCondition(conditionPath, {
      repo,
      localAgent: fakeLocalAgent(homesRoot),
      writeBack: false,
    })

    expect(report.written).toBe(true)
    expect(report.warnings.map(w => w.code)).toContain('HOME_SHA_DECLARED_STALE')
    expect((report.lock?.['home'] as { sha: string }).sha).not.toBe(stale)
  })

  it('writes only into the --repo copy: the lock lands beside its declaration and nowhere else', async () => {
    const { repo, homesRoot, conditionPath, lockPath } = tree()
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })
    expect(report.lockPath).toBe(lockPath)
    expect(existsSync(lockPath)).toBe(true)
  })
})

describe('the declaration-versus-scope check is one function', () => {
  it('grades permissions and endpoint as errors and the rest as warnings', () => {
    const snapshot: EffectiveSnapshot = {
      cliVersion: '9.9.9',
      model: 'other-model',
      reasoningEffort: 'high',
      permissions: 'read-only',
      endpoint: 'elsewhere.example',
      available: true,
    }
    expect(checkAgainstEffective({ ...CODEX_CONDITION }, snapshot).map(row => [row.field, row.severity])).toEqual([
      ['harness.version', 'warning'],
      ['model.declared', 'warning'],
      ['reasoning.effort', 'warning'],
      ['permissions', 'error'],
      ['model.endpoint', 'error'],
    ])
  })
})
