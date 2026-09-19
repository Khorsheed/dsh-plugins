/**
 * T32 — the capability face as a checkable fact.
 *
 * Three seams meet here: the contract (a `preset` only a composable harness
 * may declare), the lock (`provisioned.capabilities`, what provision
 * measured), and the readiness gate (the claim must have a measurement
 * behind it, checked before any delegation is spent).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { provisionCondition, type ProvisionedCapabilities } from '../src/provision.ts'
import { conditionDiagnostics, resolveConditionReadiness } from '../src/validate.ts'
import { capabilityRefusal, checkReadiness, type ReadinessSubject } from '../src/readiness.ts'
import { hashPresetTree } from '../src/preset-snapshot.ts'
import { LOCK_SCHEMA, PRESET_CAPABLE_HARNESSES, validateJson } from '../src/schema.ts'
import type { LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus } from '../src/faces.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const CAPS_SHA = 'a'.repeat(64)
const HOME_SHA = 'b'.repeat(64)

function conditionDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'dataseek.condition/1',
    harness: { name: 'dsh', version: '0.1.5-rc.1', drive: 'exec' },
    model: { declared: 'deepseek-official/deepseek-v4-pro', endpoint: 'default' },
    reasoning: { effort: 'high' },
    permissions: 'unrestricted',
    instructions: 'none',
    preset: null,
    skills: { pack: null },
    home: { sha: HOME_SHA },
    env: { keys: ['DSH_HOME'] },
    ...over,
  }
}

/** A dsh scope whose effective settings agree with {@link conditionDoc}. */
function agreeingSettings(): LocalAgentEffectiveSettingsFace {
  return {
    drive: 'exec',
    baseUrlSet: false,
    reasoningEffort: 'high',
    cliVersion: '0.1.5-rc.1',
    model: 'deepseek-official/deepseek-v4-pro',
  }
}

/** The read-only local-agent face provision uses, over a real homes root. */
function fakeLocalAgent(homesRoot: string): LocalAgentFace {
  const homeDir = (harness: string, scope?: string): string => {
    const dir = join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return {
    start: () => Promise.reject(new Error('provision never delegates')),
    resume: () => Promise.reject(new Error('provision never delegates')),
    cancel: () => false,
    get: () => undefined,
    homeDir,
    statusOf: (harness: string, scope?: string): Promise<LocalAgentScopeStatus> => Promise.resolve({
      name: harness,
      homeDir: homeDir(harness, scope),
      credentialState: 'present-unverified',
      ...(scope === undefined ? {} : { scope }),
      loginable: true,
    }),
    effectiveSettings: () => Promise.resolve(agreeingSettings()),
  } as unknown as LocalAgentFace
}

/** A repo working copy holding one dsh condition, plus a homes root. */
function tree(condition: Record<string, unknown>): { repo: string; homesRoot: string; conditionPath: string; datasetRoot: string } {
  const root = tmpTree()
  const repo = join(root, 'repo')
  const datasetRoot = join(repo, 'datasets', 'ds')
  const conditionPath = writeJson(join(datasetRoot, 'conditions'), 'dsh-lean.json', condition)
  return { repo, homesRoot: join(root, 'homes'), conditionPath, datasetRoot }
}

describe('the preset field is only for a harness this family composes', () => {
  it('accepts a preset on dsh — its sub-profile is what the instance writes', () => {
    const { errors } = conditionDiagnostics(conditionDoc({ preset: 'eval-lean' }))
    expect(errors).toEqual([])
    expect(PRESET_CAPABLE_HARNESSES).toEqual(['dsh'])
  })

  for (const harness of ['codex', 'claude-code', 'kimi'] as const) {
    it(`refuses a preset on ${harness} — an external CLI brings its own composition`, () => {
      const permissions = { codex: 'read-only', 'claude-code': 'normal', kimi: 'auto-approve' }[harness]
      const { errors } = conditionDiagnostics(conditionDoc({
        harness: { name: harness, version: '1.0.0', drive: 'exec' },
        permissions,
        preset: 'eval-lean',
      }))
      expect(errors.map(error => error.code)).toContain('PRESET_NOT_FOR_HARNESS')
      // The message has to name the alternative, or the author's next move is a guess.
      expect(errors.find(error => error.code === 'PRESET_NOT_FOR_HARNESS')?.message).toMatch(/skills\.pack/)
    })

    it(`accepts null on ${harness} — the only legal value there`, () => {
      const permissions = { codex: 'read-only', 'claude-code': 'normal', kimi: 'auto-approve' }[harness]
      const { errors } = conditionDiagnostics(conditionDoc({
        harness: { name: harness, version: '1.0.0', drive: 'exec' },
        permissions,
        preset: null,
      }))
      expect(errors).toEqual([])
    })
  }

  it('leaves an unknown harness alone — degrade, do not explode', () => {
    const { errors } = conditionDiagnostics(conditionDoc({
      harness: { name: 'some-future-cli', version: '1.0.0', drive: 'exec' },
      preset: 'eval-lean',
    }))
    expect(errors.map(error => error.code)).not.toContain('PRESET_NOT_FOR_HARNESS')
  })
})

describe('conditions provision — the capability face it records', () => {
  const probe = (over: Partial<ProvisionedCapabilities> = {}) =>
    async (): Promise<ProvisionedCapabilities> => ({ sha: CAPS_SHA, preset: 'eval-lean', skills: 3, tools: 11, ...over })

  it('records the measured face, and validate reads it back as ready', async () => {
    const document = conditionDoc({ preset: 'eval-lean', home: { sha: null } })
    const { repo, homesRoot, conditionPath, datasetRoot } = tree(document)
    const report = await provisionCondition(conditionPath, {
      repo, localAgent: fakeLocalAgent(homesRoot), capabilities: probe(),
    })
    expect(report.written).toBe(true)
    const lock = report.lock as { provisioned: Record<string, unknown> }
    expect(lock.provisioned['preset']).toBe('eval-lean')
    expect(lock.provisioned['capabilities']).toEqual({ sha: CAPS_SHA, preset: 'eval-lean', skills: 3, tools: 11 })
    expect(validateJson(LOCK_SCHEMA, report.lock)).toEqual([])
    expect(readFileSync(report.lockPath, 'utf8').endsWith('\n')).toBe(true)

    // The same file, through the reader every other surface uses.
    const readiness = await resolveConditionReadiness('dsh-lean', datasetRoot)
    expect(readiness.entry.lock?.capabilities).toEqual({ sha: CAPS_SHA, preset: 'eval-lean' })
    expect(readiness.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_NOT_PROVISIONED')
  })

  it('records nothing about capabilities for a condition that declares no preset', async () => {
    const { repo, homesRoot, conditionPath } = tree(conditionDoc({ home: { sha: null } }))
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot), capabilities: probe() })
    const provisioned = (report.lock as { provisioned: Record<string, unknown> }).provisioned
    // Silence, not `preset: null`: "measured, and it composes nothing" is a
    // different claim from "nothing was claimed".
    expect('preset' in provisioned).toBe(false)
    expect('capabilities' in provisioned).toBe(false)
  })

  it('warns by name when a preset claim goes unmeasured — no probe supplied', async () => {
    const { repo, homesRoot, conditionPath, datasetRoot } = tree(conditionDoc({ preset: 'eval-lean', home: { sha: null } }))
    const report = await provisionCondition(conditionPath, { repo, localAgent: fakeLocalAgent(homesRoot) })
    // The lock is still written — the scope WAS checked — but it carries no
    // capability record, and both ends say so.
    expect(report.written).toBe(true)
    expect(report.warnings.map(warning => warning.code)).toContain('CAPABILITIES_UNMEASURED')
    const provisioned = (report.lock as { provisioned: Record<string, unknown> }).provisioned
    expect(provisioned['preset']).toBe('eval-lean')
    expect('capabilities' in provisioned).toBe(false)

    const readiness = await resolveConditionReadiness('dsh-lean', datasetRoot)
    expect(readiness.warnings.map(warning => warning.code)).toContain('CAPABILITIES_NOT_PROVISIONED')
  })

  it('a probe that throws is a warning, not a crashed provision', async () => {
    const { repo, homesRoot, conditionPath } = tree(conditionDoc({ preset: 'eval-lean', home: { sha: null } }))
    const report = await provisionCondition(conditionPath, {
      repo,
      localAgent: fakeLocalAgent(homesRoot),
      capabilities: async () => { throw new Error('the sub-profile would not boot') },
    })
    expect(report.written).toBe(true)
    const warning = report.warnings.find(row => row.code === 'CAPABILITIES_UNMEASURED')
    expect(warning?.message).toMatch(/would not boot/)
  })

  it('records what was MEASURED when it disagrees with the declaration, and says so', async () => {
    const { repo, homesRoot, conditionPath, datasetRoot } = tree(conditionDoc({ preset: 'eval-lean', home: { sha: null } }))
    const report = await provisionCondition(conditionPath, {
      repo, localAgent: fakeLocalAgent(homesRoot), capabilities: probe({ preset: 'eval-full' }),
    })
    expect(report.warnings.map(warning => warning.code)).toContain('CAPABILITIES_PRESET_MISMATCH')
    const provisioned = (report.lock as { provisioned: Record<string, unknown> }).provisioned
    // What was built, not what was asked for.
    expect(provisioned['preset']).toBe('eval-full')

    const readiness = await resolveConditionReadiness('dsh-lean', datasetRoot)
    expect(readiness.warnings.map(warning => warning.code)).toContain('CAPABILITIES_PRESET_MISMATCH')
  })

  it('reads the scope\'s preset copy back offline, and reports one that changed after provision', async () => {
    // T32b recorded this as a gap it could not close: validate is offline and
    // cannot measure a capability face, so a lock whose preset was edited
    // afterwards read `ready` here while the run refused it. The face still
    // needs a live catalog; the scope's own COPY needs only the directory.
    const { repo, homesRoot, conditionPath, datasetRoot } = tree(conditionDoc({ preset: 'eval-lean', home: { sha: null } }))
    const presetDir = join(homesRoot, 'dsh', '.agent-presets', 'eval-lean')
    mkdirSync(join(presetDir, 'skills'), { recursive: true })
    writeFileSync(join(presetDir, 'agent.cordis.yml'), '- id: skill-filesystem\n')
    writeFileSync(join(presetDir, 'skills', 'SKILL.md'), 'Draft the plan. One stage.\n')
    const snapshot = await hashPresetTree(presetDir)
    const report = await provisionCondition(conditionPath, {
      repo,
      localAgent: fakeLocalAgent(homesRoot),
      capabilities: probe({ source: 'scope-snapshot', snapshot: { sha: snapshot?.sha ?? '' } }),
    })
    expect(report.written).toBe(true)
    const scopeHomeDir = (harness: string, scope?: string): string =>
      join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)

    // Unchanged: ready, and the resolver is what makes the check possible.
    const fresh = await resolveConditionReadiness('dsh-lean', datasetRoot, { scopeHomeDir })
    expect(fresh.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_SNAPSHOT_STALE')

    // A skill BODY edit: `home.sha` does not move (it hashes config-suffixed
    // files) and nothing else offline would see it.
    writeFileSync(join(presetDir, 'skills', 'SKILL.md'), 'Draft the plan. TWO stages.\n')
    const stale = await resolveConditionReadiness('dsh-lean', datasetRoot, { scopeHomeDir })
    expect(stale.warnings.map(warning => warning.code)).toContain('CAPABILITIES_SNAPSHOT_STALE')
    // Without a resolver the reader is exactly as offline as it always was.
    const blind = await resolveConditionReadiness('dsh-lean', datasetRoot)
    expect(blind.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_SNAPSHOT_STALE')
  })
})

describe('capabilityRefusal — the readiness gate on the preset claim', () => {
  const base: ReadinessSubject = { id: 'dsh-lean', harnessName: 'dsh', declaredModel: null, provider: 'dsh-cli' }

  it('passes a condition that claims no preset', () => {
    expect(capabilityRefusal(base)).toBeUndefined()
    expect(capabilityRefusal({ ...base, preset: null })).toBeUndefined()
  })

  it('refuses a declared preset with no measured face', () => {
    expect(capabilityRefusal({ ...base, preset: 'eval-lean' })).toMatch(/never measured/)
  })

  it('refuses a face measured under another preset', () => {
    const reason = capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA, preset: 'eval-full' } })
    expect(reason).toMatch(/another subject/)
  })

  it('passes when the measurement agrees, and when it names no preset at all', () => {
    expect(capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA, preset: 'eval-lean' } })).toBeUndefined()
    expect(capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA } })).toBeUndefined()
  })
})

describe('checkReadiness spends no delegation on an unmeasured preset', () => {
  const localAgent = {
    start: async (): Promise<never> => { throw new Error('the readiness probe must not delegate here') },
    cancel: (): void => {},
    get: (): undefined => undefined,
    delegationOf: (): undefined => undefined,
  }

  it('fails the condition before any start, and carries the reason', async () => {
    const records = await checkReadiness({
      localAgent: localAgent as never,
      conditions: [{ id: 'dsh-lean', harnessName: 'dsh', declaredModel: null, provider: 'dsh-cli', preset: 'eval-lean' }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.childSessionId).toBeNull()
    expect(records[0]?.reason).toMatch(/never measured/)
  })

  it('records the measured fingerprint on the verdict when it agrees', async () => {
    const started: string[] = []
    const facade = {
      ...localAgent,
      start: async (parent: string) => {
        started.push(parent)
        return { id: 'child-1', result: Promise.resolve({ stopReason: 'completed' as const, text: 'READY' }) }
      },
    }
    const records = await checkReadiness({
      localAgent: facade as never,
      conditions: [{
        id: 'dsh-lean',
        harnessName: 'dsh',
        declaredModel: null,
        provider: 'dsh-cli',
        preset: 'eval-lean',
        capabilities: { sha: CAPS_SHA, preset: 'eval-lean' },
      }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
      readbackWaitMs: 0,
    })
    expect(started).toEqual(['session-1'])
    expect(records[0]?.ok).toBe(true)
    expect(records[0]?.capabilities).toEqual({ sha: CAPS_SHA, preset: 'eval-lean' })
  })
})
