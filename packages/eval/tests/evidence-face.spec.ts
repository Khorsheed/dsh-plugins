/**
 * The injectable execution-target evidence face.
 *
 * Provision, the readiness gate and the freshness checks anchor eval's
 * fairness evidence on the scoped home the rounds actually run against. When
 * the service is mounted with `evidence`, that evidence arrives as plain data
 * from the execution target instead of being read off this process's
 * filesystem — on the topology the face exists for, the same-named local
 * directory is a different environment.
 *
 * What is pinned here: PARITY (the face's answers are byte-identical to the
 * local reads over the same fixture scoped home, locks included), the
 * FAIL-CLOSED matrix (every missing/invalid/mismatched answer lands exactly
 * where the corresponding local failure lands), the CROSS-PROCESS shape (the
 * producer's answers cross a JSON boundary before the consumer sees them),
 * and the composition with the instance stateRoot seam (the condition library
 * is the instance's, the evidence is the target's).
 *
 * The local default is pinned by the whole pre-existing suite — every
 * provision/capability/readiness spec runs the face-absent path unmodified.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { instanceCapabilityProbe } from '../src/capability-probe.ts'
import { hashConditionDocument, hashHome } from '../src/contract/hash.ts'
import { produceScopedHomeEvidence } from '../src/evidence.ts'
import { hashPresetTree, scopePresetDir, scopePresetProblem } from '../src/preset-snapshot.ts'
import { EvalProvisionRefused, provisionCondition } from '../src/provision.ts'
import { checkReadiness, type ReadinessSubject } from '../src/run/readiness.ts'
import { EvalService } from '../src/service.ts'
import { readScopePreset } from '../src/sub-profile.ts'
import type {
  CapabilityCatalogFace, LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus,
  ScopedHomeEvidenceFace,
} from '../src/faces.ts'
import { cleanupTmp, tmpTree, useDshHome, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const FIXED_NOW = 1_757_500_000_000
const CAPS_SHA = 'a'.repeat(64)

const CONDITION = {
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

const PRESET_CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.5', drive: 'exec' },
  model: { declared: 'deepseek-v4', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: 'eval-lean',
  skills: { pack: null },
  home: { sha: null },
  env: { keys: ['DEEPSEEK_API_KEY'] },
} as const

/** The codex scope that agrees with {@link CONDITION} on every field. */
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

/** The dsh scope that agrees with {@link PRESET_CONDITION} on every field. */
function agreeingDshSettings(): LocalAgentEffectiveSettingsFace {
  return {
    drive: 'exec',
    sandbox: 'danger-full-access',
    baseUrlSet: false,
    cliVersion: '0.1.5',
    model: 'deepseek-v4',
  }
}

/** The composition shape a preset must have to be a factor: no absolute path. */
const RELOCATABLE_COMPOSITION = `- insert:
    - id: preset-eval-lean
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: eval-lean
        plugins: []
`

/**
 * A scoped home fixture: two config files, a denied credentials dir, and —
 * with `preset` — a sub-profile rostering it plus (unless `copy: false`) the
 * scope's own copy of the preset package.
 */
function fixtureHome(options: { preset?: string; harness?: string; copy?: boolean; composition?: string } = {}): string {
  const harness = options.harness ?? 'codex'
  const home = join(tmpTree(), `${harness}@eval-b`)
  writeJson(home, 'config.json', { model: 'gpt-5.6-sol', sandbox: 'workspace-write' })
  writeFileSync(join(home, 'settings.yml'), 'model: gpt-5.6-sol\n', 'utf8')
  writeJson(home, 'credentials/token.json', { token: 'never-hashed' })
  if (options.preset !== undefined) {
    const profile = join(home, 'profiles', 'headless')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'cordis.patch.yml'),
      `- insert:\n    - id: agent-preset-registry\n      name: '@deepseek-ai/dsh-agent-preset-registry'\n      config:\n        default: ${JSON.stringify(options.preset)}\n`,
      'utf8',
    )
    if (options.copy !== false) {
      const dir = scopePresetDir(home, options.preset)
      mkdirSync(join(dir, 'skills', 'eval-planning'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@dataseek-eval/preset-eval-lean', version: '0.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      writeFileSync(join(dir, 'cordis.patch.yml'), options.composition ?? RELOCATABLE_COMPOSITION)
      writeFileSync(join(dir, 'skills', 'eval-planning', 'SKILL.md'), 'Draft the plan. One stage, then stop and report.\n')
    }
  }
  return home
}

/**
 * The PRODUCER — what runs on the execution target. The three fs-derived
 * channels come from the package's own evidence factory (this seam's whole
 * point: the producer reuses the algorithms, never copies them); the
 * credential grade and effective settings stay the producer's own auth
 * implementation, exactly as the factory's contract says. The bundle is
 * plain data; nothing in it is callable.
 */
async function produceEvidence(
  home: string,
  preset: string | undefined,
  settings: LocalAgentEffectiveSettingsFace | undefined,
): Promise<Record<string, unknown>> {
  const produced = await produceScopedHomeEvidence(home, preset === undefined ? {} : { preset })
  return {
    homeHash: produced.home,
    credentialGrade: 'present-unverified',
    effectiveSettings: settings,
    rosteredPreset: produced.rosteredPreset,
    ...(produced.presetSnapshot === undefined ? {} : { presetSnapshot: produced.presetSnapshot }),
  }
}

/** The process boundary: structured bytes in, structured bytes out. */
function overTheWire(bundle: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>
}

/** The CONSUMER face: serves the wire bundle verbatim, and counts what it was asked. */
function evidenceFrom(wire: Record<string, unknown>): { face: ScopedHomeEvidenceFace; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    face: {
      homeHash: async (harness, scope) => {
        asked.push(`home:${harness}${scope === undefined ? '' : `@${scope}`}`)
        return wire['homeHash'] as never
      },
      credentialGrade: async (harness, scope) => {
        asked.push(`credential:${harness}${scope === undefined ? '' : `@${scope}`}`)
        return wire['credentialGrade'] as never
      },
      effectiveSettings: async (harness, scope) => {
        asked.push(`effective:${harness}${scope === undefined ? '' : `@${scope}`}`)
        return wire['effectiveSettings'] as never
      },
      rosteredPreset: async (harness, scope) => {
        asked.push(`rostered:${harness}${scope === undefined ? '' : `@${scope}`}`)
        return wire['rosteredPreset'] as never
      },
      presetSnapshot: async (harness, scope, preset) => {
        asked.push(`snapshot:${harness}${scope === undefined ? '' : `@${scope}`}:${preset}`)
        return wire['presetSnapshot'] as never
      },
    },
  }
}

/**
 * A facade whose evidence verbs must never be called on the evidence path —
 * they throw if one slips through. `provisionScope` stays: composing the
 * scope is a write the facade owns, not evidence.
 */
function spyLocalAgent(): LocalAgentFace & {
  homeDir: ReturnType<typeof vi.fn>
  statusOf: ReturnType<typeof vi.fn>
  effectiveSettings: ReturnType<typeof vi.fn>
  provisionScope: ReturnType<typeof vi.fn>
} {
  const forbidden = (verb: string) => vi.fn(() => { throw new Error(`${verb}: a local scoped-home read on the evidence path`) })
  return {
    start: () => Promise.reject(new Error('provision never delegates')),
    resume: () => Promise.reject(new Error('provision never delegates')),
    cancel: () => false,
    get: () => undefined,
    homeDir: forbidden('homeDir'),
    statusOf: forbidden('statusOf'),
    effectiveSettings: forbidden('effectiveSettings'),
    provisionScope: vi.fn(async (harness: string, scope?: string, options?: { preset?: string }) => ({
      homeDir: join(tmpTree(), 'unused'),
      preset: options?.preset,
      presetSnapshot: { matchesSource: true },
    })),
  } as never
}

/** A local facade over the fixture home — the pre-seam shape (provision.spec's fake). */
function localLocalAgent(home: string, harness: string, settings: LocalAgentEffectiveSettingsFace | undefined): LocalAgentFace {
  return {
    start: () => Promise.reject(new Error('provision never delegates')),
    resume: () => Promise.reject(new Error('provision never delegates')),
    cancel: () => false,
    get: () => undefined,
    homeDir: () => home,
    statusOf: (): Promise<LocalAgentScopeStatus> => Promise.resolve({
      name: harness, homeDir: home, credentialState: 'present-unverified', scope: 'eval-b', loginable: true,
    }),
    effectiveSettings: () => Promise.resolve(settings),
    provisionScope: async (_harness: string, _scope?: string, options?: { preset?: string }) => ({
      homeDir: home,
      preset: options?.preset,
      presetSnapshot: { matchesSource: true },
    }),
  }
}

/** A condition library (a state root) holding one condition document. */
function libraryRoot(condition: Record<string, unknown>): { stateRoot: string; conditionPath: string; lockPath: string } {
  const stateRoot = tmpTree()
  const conditionPath = writeJson(stateRoot, 'conditions/c1.json', condition)
  return { stateRoot, conditionPath, lockPath: join(stateRoot, 'conditions', 'c1.lock.json') }
}

/** The instance catalog the capability probe measures through (both paths share it). */
const CATALOG: CapabilityCatalogFace = {
  snapshotFor: (preset?: string) => Promise.resolve({ sha: CAPS_SHA, preset, skills: [], tools: [] }),
}

describe('parity: evidence answers are the local reads, byte for byte', () => {
  it('a preset-less condition provisions to the identical lock through the face and through local reads', async () => {
    const home = fixtureHome()
    const settings = agreeingSettings()
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const options = { repo: join(conditionPath, '..', '..'), now: () => FIXED_NOW }

    // The local path, exactly as before the seam.
    const localReport = await provisionCondition(conditionPath, { ...options, localAgent: localLocalAgent(home, 'codex', settings) })
    const localLock = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown

    // The condition document was corrected by write-back; restore it so the
    // evidence run reads the same declaration.
    writeJson(join(conditionPath, '..'), 'c1.json', { ...CONDITION, scope: 'eval-b' })
    const wire = overTheWire(await produceEvidence(home, undefined, settings))
    const { face, asked } = evidenceFrom(wire)
    const localAgent = spyLocalAgent()
    const evidenceReport = await provisionCondition(conditionPath, { ...options, localAgent, evidence: face })
    const evidenceLock = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown

    // The locks are byte-identical — the fingerprint, the credential grade,
    // the effective-settings record, all of it — and the identity the report
    // records is the producer's.
    expect(evidenceLock).toEqual(localLock)
    expect(evidenceReport.home).toEqual(localReport.home)
    expect(evidenceReport.homeDir).toBe(home)
    expect(evidenceReport.credentialState).toBe('present-unverified')
    expect(evidenceReport.checks).toEqual(localReport.checks)
    // No local evidence read happened: the facade's evidence verbs were never
    // touched, and every face verb answered for the condition's own scope.
    expect(localAgent.homeDir).not.toHaveBeenCalled()
    expect(localAgent.statusOf).not.toHaveBeenCalled()
    expect(localAgent.effectiveSettings).not.toHaveBeenCalled()
    expect(asked).toEqual(['home:codex@eval-b', 'credential:codex@eval-b', 'effective:codex@eval-b'])
  })

  it('a preset condition locks the identical capability record — the scope copy digest crosses as data', async () => {
    const home = fixtureHome({ preset: 'eval-lean', harness: 'dsh' })
    const settings = agreeingDshSettings()
    const { conditionPath, lockPath } = libraryRoot({ ...PRESET_CONDITION, scope: 'eval-b' })
    const options = { repo: join(conditionPath, '..', '..'), now: () => FIXED_NOW }

    const localReport = await provisionCondition(conditionPath, {
      ...options,
      localAgent: localLocalAgent(home, 'dsh', settings),
      capabilities: instanceCapabilityProbe({ catalog: CATALOG }),
    })
    const localLock = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown
    expect(localReport.written).toBe(true)

    writeJson(join(conditionPath, '..'), 'c1.json', { ...PRESET_CONDITION, scope: 'eval-b' })
    const wire = overTheWire(await produceEvidence(home, 'eval-lean', settings))
    const { face, asked } = evidenceFrom(wire)
    const localAgent = spyLocalAgent()
    const evidenceReport = await provisionCondition(conditionPath, {
      ...options,
      localAgent,
      evidence: face,
      capabilities: instanceCapabilityProbe({ catalog: CATALOG, evidence: face }),
    })
    const evidenceLock = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown

    // The capability record — roster read-back, arrangement, the copy's
    // digest — is identical, and the digest is the real tree hash of the
    // fixture, computed by the PRODUCER.
    expect(evidenceReport.written).toBe(true)
    expect(evidenceLock).toEqual(localLock)
    const capabilities = (evidenceLock as { provisioned: { capabilities: { snapshot?: { sha: string } } } }).provisioned.capabilities
    expect(capabilities.snapshot?.sha).toBe((await hashPresetTree(scopePresetDir(home, 'eval-lean')))?.sha)
    expect(asked).toEqual([
      'home:dsh@eval-b', 'credential:dsh@eval-b', 'effective:dsh@eval-b',
      'rostered:dsh@eval-b', 'snapshot:dsh@eval-b:eval-lean',
    ])
    expect(localAgent.homeDir).not.toHaveBeenCalled()
  })
})

describe('fail-closed: every missing or wrong answer lands where the local failure lands', () => {
  function faceWith(patch: Partial<ScopedHomeEvidenceFace>): ScopedHomeEvidenceFace {
    return {
      homeHash: async () => ({ homeDir: '/target/homes/codex@eval-b', sha: 'b'.repeat(64), files: 2, denied: 1 }),
      credentialGrade: async () => 'present-unverified',
      effectiveSettings: async () => agreeingSettings(),
      ...patch,
    }
  }

  it('a face without homeHash refuses like a facade without homeDir', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const face = faceWith({})
    delete (face as { homeHash?: unknown }).homeHash
    await expect(provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: face,
    })).rejects.toThrow(/has no homeHash/)
  })

  it('an absent or misshapen home fingerprint refuses — the local "cannot read the home" outcome', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const options = { repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent() }
    await expect(provisionCondition(conditionPath, { ...options, evidence: faceWith({ homeHash: async () => undefined }) }))
      .rejects.toThrow(EvalProvisionRefused)
    await expect(provisionCondition(conditionPath, {
      ...options,
      evidence: faceWith({ homeHash: async () => ({ homeDir: '/target/h', sha: 'not-hex', files: 1, denied: 0 }) }),
    })).rejects.toThrow(/no usable home fingerprint/)
  })

  it('a face without credentialGrade refuses — a lock is never written against an ungraded credential', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const face = faceWith({})
    delete (face as { credentialGrade?: unknown }).credentialGrade
    await expect(provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: face,
    })).rejects.toThrow(/has no credentialGrade/)
  })

  it('credential grade "absent" stops the provision with CREDENTIAL_ABSENT, exactly as the local grade does', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'),
      localAgent: spyLocalAgent(),
      evidence: faceWith({ credentialGrade: async () => 'absent' }),
    })
    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual(['CREDENTIAL_ABSENT'])
  })

  it('a grade outside the four words refuses as invalid evidence', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    await expect(provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'),
      localAgent: spyLocalAgent(),
      evidence: faceWith({ credentialGrade: async () => 'trusted' as never }),
    })).rejects.toThrow(/not one of the four grades/)
  })

  it('a mismatching effective settings answer refuses the lock with EFFECTIVE_MISMATCH — the local mismatch outcome', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'),
      localAgent: spyLocalAgent(),
      evidence: faceWith({ effectiveSettings: async () => agreeingSettings({ sandbox: 'danger-full-access' }) }),
    })
    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors.map(e => e.code)).toContain('EFFECTIVE_MISMATCH')
  })

  it('an absent effective-settings answer records uncomparable fields — it never fabricates a match', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'),
      localAgent: spyLocalAgent(),
      evidence: faceWith({ effectiveSettings: async () => undefined }),
    })
    // Today's "the harness declares no snapshot" semantics: uncomparable
    // warnings, and the lock records the absence rather than guessing.
    expect(report.written).toBe(true)
    expect(report.warnings.map(w => w.code)).toContain('EFFECTIVE_UNCOMPARABLE')
    expect(report.checks.every(row => row.status === 'unknown' || row.status === 'backfilled')).toBe(true)
  })

  it('a drifted preset-copy digest fails the readiness gate before any delegation — the local drift outcome', async () => {
    const start = vi.fn()
    const localAgent = {
      start, resume: () => Promise.reject(new Error('no resume')), cancel: () => false, get: () => undefined,
    } as unknown as LocalAgentFace
    const subject: ReadinessSubject = {
      id: 'c1', harnessName: 'dsh', declaredModel: null, provider: 'dsh-local', scope: 'eval-b',
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', snapshot: { sha: 'b'.repeat(64) } },
    }
    const drifted: ScopedHomeEvidenceFace = {
      presetSnapshot: async () => ({ keepsCopy: true, snapshot: { sha: 'd'.repeat(64), files: 4 } }),
    }
    const records = await checkReadiness({
      localAgent, conditions: [subject], parentSessionId: 'p1', probeDirBase: tmpTree(), evidence: drifted,
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.reason).toContain('changed after provision')
    // The gate fired before a single delegation was spent.
    expect(start).not.toHaveBeenCalled()
  })

  it('a matching digest passes the gate and the probe delegates (the run starts)', async () => {
    const lockedSha = 'b'.repeat(64)
    const localAgent = {
      start: () => Promise.resolve({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed' }) }),
      resume: () => Promise.reject(new Error('no resume')),
      cancel: () => false,
      get: () => undefined,
    } as unknown as LocalAgentFace
    const subject: ReadinessSubject = {
      id: 'c1', harnessName: 'dsh', declaredModel: null, provider: 'dsh-local', scope: 'eval-b',
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', snapshot: { sha: lockedSha } },
    }
    const evidence: ScopedHomeEvidenceFace = {
      presetSnapshot: async () => ({ keepsCopy: true, snapshot: { sha: lockedSha, files: 4 } }),
    }
    const records = await checkReadiness({
      localAgent, conditions: [subject], parentSessionId: 'p1', probeDirBase: tmpTree(), readbackWaitMs: 0, evidence,
    })
    expect(records[0]?.ok).toBe(true)
  })

  it('an evidence face without presetSnapshot leaves the locked record standing — never a guessed digest', async () => {
    const start = vi.fn(() => Promise.resolve({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed' }) }))
    const localAgent = {
      start, resume: () => Promise.reject(new Error('no resume')), cancel: () => false, get: () => undefined,
    } as unknown as LocalAgentFace
    const subject: ReadinessSubject = {
      id: 'c1', harnessName: 'dsh', declaredModel: null, provider: 'dsh-local', scope: 'eval-b',
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', snapshot: { sha: 'b'.repeat(64) } },
    }
    const records = await checkReadiness({
      localAgent, conditions: [subject], parentSessionId: 'p1', probeDirBase: tmpTree(), readbackWaitMs: 0, evidence: {},
    })
    expect(records[0]?.ok).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('composition with the instance stateRoot', () => {
  it('provisionLibraryCondition writes the lock under the instance root while every evidence read goes to the face', async () => {
    const home = fixtureHome()
    const settings = agreeingSettings()
    const { stateRoot } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const wire = overTheWire(await produceEvidence(home, undefined, settings))
    const { face } = evidenceFrom(wire)
    const localAgent = spyLocalAgent()
    const service = new EvalService(
      { get: (name: string) => (name === 'localAgent' ? localAgent : undefined) },
      { stateRoot, evidence: face },
    )

    const report = await service.provisionLibraryCondition('c1')

    expect(report.written).toBe(true)
    // The lock landed in the INSTANCE's condition library…
    const lock = JSON.parse(readFileSync(join(stateRoot, 'conditions', 'c1.lock.json'), 'utf8')) as { home: { sha: string } }
    // …and the fingerprint it anchors is the TARGET's, byte-identical to the
    // producer's read of the fixture home.
    expect(lock.home.sha).toBe((await hashHome(home)).sha)
    expect(localAgent.homeDir).not.toHaveBeenCalled()
    expect(localAgent.statusOf).not.toHaveBeenCalled()
    expect(localAgent.effectiveSettings).not.toHaveBeenCalled()
  })

  it('the freshness check reads the target\'s digest, and a drift there is CAPABILITIES_SNAPSHOT_STALE', async () => {
    const lockedSha = 'b'.repeat(64)
    const stateRoot = tmpTree()
    const condition = { ...PRESET_CONDITION, scope: 'eval-b' }
    writeJson(stateRoot, 'conditions/c1.json', condition)
    writeJson(stateRoot, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1',
      condition: 'c1',
      sha: hashConditionDocument(condition),
      home: { sha: 'e'.repeat(64) },
      provisioned: {
        at: FIXED_NOW,
        cliVersion: '0.144.0',
        effective: { model: 'gpt-5.6-sol', reasoningEffort: 'default', permissions: 'workspace-write', endpoint: 'default' },
        preset: 'eval-lean',
        capabilities: { sha: CAPS_SHA, preset: 'eval-lean', source: 'scope-snapshot', snapshot: { sha: lockedSha } },
      },
    })
    const snapshot = vi.fn(async (): Promise<{ keepsCopy: true; snapshot: { sha: string; files: number } }> => ({
      keepsCopy: true, snapshot: { sha: 'd'.repeat(64), files: 4 },
    }))
    // No localAgent in this composition at all: the resolver must not need one.
    const service = new EvalService({ get: () => undefined }, { stateRoot, evidence: { presetSnapshot: snapshot } })

    const drifted = await service.conditions()
    expect(drifted.conditions[0]?.warnings.map(w => w.code)).toContain('CAPABILITIES_SNAPSHOT_STALE')
    expect(snapshot).toHaveBeenCalledWith('dsh', 'eval-b', 'eval-lean')

    // The target answering the locked digest reads fresh.
    const fresh = new EvalService({ get: () => undefined }, {
      stateRoot,
      evidence: { presetSnapshot: async () => ({ keepsCopy: true, snapshot: { sha: lockedSha, files: 4 } }) },
    })
    const report = await fresh.conditions()
    expect(report.conditions[0]?.warnings.map(w => w.code) ?? []).not.toContain('CAPABILITIES_SNAPSHOT_STALE')
  })
})

describe('the target-side evidence factory', () => {
  it('answers byte-identical evidence to the local algorithms over the same home', async () => {
    const home = fixtureHome({ preset: 'eval-lean', harness: 'dsh' })
    const produced = await produceScopedHomeEvidence(home, { preset: 'eval-lean' })

    expect(produced.home).toEqual({ homeDir: home, ...(await hashHome(home)) })
    expect(produced.rosteredPreset).toBe(readScopePreset(home))
    expect(produced.rosteredPreset).toBe('eval-lean')
    expect(produced.presetSnapshot).toEqual({
      keepsCopy: true,
      snapshot: await hashPresetTree(scopePresetDir(home, 'eval-lean')),
    })
  })

  it('a scope rostering a preset but keeping no copy answers keepsCopy false — the instance-root arrangement', async () => {
    const home = fixtureHome({ preset: 'eval-lean', harness: 'dsh', copy: false })
    const produced = await produceScopedHomeEvidence(home, { preset: 'eval-lean' })
    expect(produced.rosteredPreset).toBe('eval-lean')
    expect(produced.presetSnapshot).toEqual({ keepsCopy: false })
  })

  it('a home with no roster answers rosteredPreset undefined, and a preset copy question gets keepsCopy false', async () => {
    const home = fixtureHome()
    const produced = await produceScopedHomeEvidence(home, { preset: 'eval-lean' })
    expect(produced.rosteredPreset).toBeUndefined()
    expect(produced.presetSnapshot).toEqual({ keepsCopy: false })
    // No preset asked, no snapshot key at all.
    expect(await produceScopedHomeEvidence(home)).not.toHaveProperty('presetSnapshot')
  })

  it('a copy that cannot be a subject carries scopePresetProblem\'s text and NO digest — the consumer\'s own order', async () => {
    const pinned = `- insert:\n    - id: preset-eval-lean\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: eval-lean\n        plugins:\n          - id: skill-filesystem\n            config:\n              customSkillDirs:\n                - /abs/path/skills\n`
    const home = fixtureHome({ preset: 'eval-lean', harness: 'dsh', composition: pinned })
    const produced = await produceScopedHomeEvidence(home, { preset: 'eval-lean' })
    expect(produced.presetSnapshot).toEqual({
      keepsCopy: true,
      problem: await scopePresetProblem(scopePresetDir(home, 'eval-lean')),
    })
    expect(produced.presetSnapshot?.problem).toContain('/abs/path/skills')
  })

  it('a copy that is not a plain tree carries no digest — hashPresetTree\'s own undefined', async () => {
    const home = fixtureHome({ preset: 'eval-lean', harness: 'dsh' })
    symlinkSync(join(home, 'settings.yml'), join(scopePresetDir(home, 'eval-lean'), 'linked.yml'))
    const produced = await produceScopedHomeEvidence(home, { preset: 'eval-lean' })
    expect(await hashPresetTree(scopePresetDir(home, 'eval-lean'))).toBeUndefined()
    expect(produced.presetSnapshot).toEqual({ keepsCopy: true })
  })

  it('refuses a relative home path, and a missing home propagates hashHome\'s own throw', async () => {
    await expect(produceScopedHomeEvidence('relative/home')).rejects.toThrow(/absolute/)
    await expect(produceScopedHomeEvidence(join(tmpTree(), 'nope'))).rejects.toThrow(/does not exist/)
  })

  it('reads only the named home — a second tree and DSH_HOME are never consulted', async () => {
    useDshHome()
    const a = fixtureHome()
    const b = join(tmpTree(), 'decoy-home')
    writeJson(b, 'config.json', { different: 'content entirely' })
    process.env['DSH_HOME'] = b

    const produced = await produceScopedHomeEvidence(a)
    expect(produced.home).toEqual({ homeDir: a, ...(await hashHome(a)) })
    expect(produced.home.sha).not.toBe((await hashHome(b)).sha)
  })
})
