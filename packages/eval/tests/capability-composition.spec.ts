/**
 * The bound member's capability-composition evidence.
 *
 * A condition declaring a preset gets its capability face measured at three
 * consumption points — provision's admission, validation/display's lock
 * record, the readiness gate's freshness. With the evidence face carrying
 * `capabilityComposition`, the measurement is the already-bound member's own
 * (produced where the member runs): the home's roster read and the
 * management-instance catalog are never consulted for those scopes, the
 * record lands in the lock as its OWN kind, and freshness compares sha,
 * descriptor, identity pair and completeness — each drift refusing with its
 * own code.
 *
 * Pinned here: the record's shape and kind; the no-fallback rule (throwing
 * catalog and roster spies stay silent); the completeness floor
 * (partial/unavailable = not verified, never admitted); the coded refusal
 * vocabulary; the identity pin with home evidence and mount planning (the E3
 * vocabulary, three answers about one home); the JSON round-trip; and the
 * structural fact that a condition cannot self-declare the evidence (the
 * contract has no such field — a smuggled one is a schema error).
 *
 * The local default is pinned by the whole pre-existing suite: the catalog
 * probe path runs whenever the verb is absent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { incompleteSections, readCapabilityCompositionShape } from '../src/capability-composition.ts'
import { conditionDiagnostics } from '../src/contract/validate.ts'
import { LOCK_SCHEMA, validateJson } from '../src/contract/schema.ts'
import { hashConditionDocument } from '../src/contract/hash.ts'
import { EvalProvisionRefused, provisionCondition } from '../src/provision.ts'
import { capabilityRefusal, checkReadiness, type ReadinessSubject } from '../src/run/readiness.ts'
import { planScopedHomeMount } from '../src/run/unit.ts'
import { EvalService } from '../src/service.ts'
import { CAPABILITY_COMPOSITION_FORMAT } from '../src/faces.ts'
import type {
  CapabilityCompositionEvidence, ExecutionHomePort, LocalAgentEffectiveSettingsFace, LocalAgentFace,
  ScopedHomeEvidenceFace,
} from '../src/faces.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const FIXED_NOW = 1_757_500_000_000
const COMPOSITION_SHA = 'd'.repeat(64)

const CONDITION = {
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

/** A valid composition answer: member m-1, target-1, everything measured complete. */
function composition(over: Partial<CapabilityCompositionEvidence> = {}): CapabilityCompositionEvidence {
  return {
    measurement: { kind: 'preset-composition', presetId: 'eval-lean', revision: 'rev-1' },
    sha: COMPOSITION_SHA,
    completeness: {
      skills: { state: 'complete' },
      tools: { state: 'complete' },
      mcpServers: { state: 'complete' },
      channels: { state: 'complete' },
    },
    coverage: { directories: ['/target/preset'], services: ['skills', 'tools'] },
    providerFormat: CAPABILITY_COMPOSITION_FORMAT,
    homeIdentity: 'target-1',
    binding: 'member-1',
    ...over,
  }
}

/** The dsh scope's effective settings, agreeing with {@link CONDITION}. */
function agreeingSettings(): LocalAgentEffectiveSettingsFace {
  return { drive: 'exec', sandbox: 'danger-full-access', baseUrlSet: false, cliVersion: '0.1.5', model: 'deepseek-v4' }
}

/** A face answering the composition channel; the other channels track evidence-face.spec's defaults. */
function faceWith(compositionAnswer: CapabilityCompositionEvidence | undefined | Error, over: Partial<ScopedHomeEvidenceFace> = {}): ScopedHomeEvidenceFace {
  return {
    homeHash: async () => ({ homeDir: '/target/homes/dsh@eval-b', sha: 'b'.repeat(64), files: 2, denied: 1, homeIdentity: 'target-1' }),
    credentialGrade: async () => 'present-unverified',
    effectiveSettings: async () => agreeingSettings(),
    rosteredPreset: vi.fn(async () => 'shared-roster-preset'),
    capabilityComposition: compositionAnswer instanceof Error
      ? async () => { throw compositionAnswer }
      : async () => compositionAnswer,
    ...over,
  }
}

/** A facade whose evidence verbs must never be called on the evidence path. */
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
    provisionScope: vi.fn(async () => ({ homeDir: '/target/homes/dsh@eval-b', preset: 'eval-lean', presetSnapshot: { matchesSource: true } })),
  } as never
}

/** A condition library (a state root) holding one condition document. */
function libraryRoot(condition: Record<string, unknown>): { stateRoot: string; conditionPath: string; lockPath: string } {
  const stateRoot = tmpTree()
  const conditionPath = writeJson(stateRoot, 'conditions/c1.json', condition)
  return { stateRoot, conditionPath, lockPath: join(stateRoot, 'conditions', 'c1.lock.json') }
}

/** The management catalog: throws if ever called (the no-fallback pin). */
function throwingCatalog(): { snapshotFor: ReturnType<typeof vi.fn> } {
  return { snapshotFor: vi.fn(async (): Promise<never> => { throw new Error('the management catalog must never be called for these scopes') }) }
}

describe('provision records the composition as its own kind', () => {
  it('the lock carries capabilityComposition verbatim, no capabilities key — and the catalog and roster stay silent', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const face = faceWith(composition())
    const catalog = throwingCatalog()
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'),
      localAgent: spyLocalAgent(),
      evidence: face,
      capabilities: async () => {
        await catalog.snapshotFor()
        return undefined
      },
      now: () => FIXED_NOW,
    })

    expect(report.written).toBe(true)
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { provisioned: Record<string, unknown> }
    // The evidence is recorded as its OWN kind — alongside, never merged
    // into, the catalog record (which is absent: the probe never ran).
    expect(lock.provisioned).toHaveProperty('capabilityComposition')
    expect(lock.provisioned).not.toHaveProperty('capabilities')
    const recorded = lock.provisioned['capabilityComposition'] as Record<string, unknown>
    expect(recorded).toEqual(composition())
    // And the lock still validates against the contract.
    expect(validateJson(LOCK_SCHEMA, lock)).toEqual([])
    // The management catalog and the home roster were never consulted: the
    // member's measurement is the only one these scopes get.
    expect(catalog.snapshotFor).not.toHaveBeenCalled()
    expect(face.rosteredPreset).not.toHaveBeenCalled()
  })

  it('the identity pin: home evidence and composition naming different targets refuse before the lock', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const face = faceWith(composition(), {
      homeHash: async () => ({ homeDir: '/target-2/homes/dsh@eval-b', sha: 'b'.repeat(64), files: 2, denied: 1, homeIdentity: 'target-2' }),
    })
    await expect(provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: face, now: () => FIXED_NOW,
    })).rejects.toThrow(/EXECUTION_HOME_IDENTITY_MISMATCH/)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('a partial section is "not verified": no lock, coded CAPABILITY_COMPOSITION_INCOMPLETE', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const incomplete = composition({
      completeness: {
        skills: { state: 'complete' },
        tools: { state: 'partial', reason: 'registry read timed out' },
        mcpServers: { state: 'complete' },
        channels: { state: 'complete' },
      },
    })
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: faceWith(incomplete), now: () => FIXED_NOW,
    })
    expect(report.written).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(report.errors.map(e => e.code)).toEqual(['CAPABILITY_COMPOSITION_INCOMPLETE'])
    expect(report.errors[0]?.message).toContain('tools')
    expect(report.errors[0]?.message).toContain('registry read timed out')
  })

  it('an answer that is not evidence refuses coded and never falls back to the catalog', async () => {
    const { conditionPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const catalog = throwingCatalog()
    for (const bad of [
      undefined,
      { ...composition(), sha: 'not-hex' },
      { ...composition(), providerFormat: 'someone-else/evidence@9' },
      { ...composition(), measurement: { kind: 'other' } },
      { ...composition(), binding: '' },
    ]) {
      await expect(provisionCondition(conditionPath, {
        repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: faceWith(bad as never), now: () => FIXED_NOW,
      })).rejects.toThrow(EvalProvisionRefused)
      await expect(provisionCondition(conditionPath, {
        repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: faceWith(bad as never), now: () => FIXED_NOW,
      })).rejects.toThrow(/CAPABILITY_COMPOSITION_INVALID/)
    }
    expect(catalog.snapshotFor).not.toHaveBeenCalled()
  })

  it('a measurement under another preset records what was measured and warns — the gate refuses the pair', async () => {
    const { conditionPath, lockPath } = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const other = composition({ measurement: { kind: 'preset-composition', presetId: 'other-preset' } })
    const report = await provisionCondition(conditionPath, {
      repo: join(conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: faceWith(other), now: () => FIXED_NOW,
    })
    expect(report.written).toBe(true)
    expect(report.warnings.map(w => w.code)).toContain('CAPABILITIES_PRESET_MISMATCH')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { provisioned: { capabilityComposition: CapabilityCompositionEvidence } }
    const refusal = capabilityRefusal({
      id: 'c1', harnessName: 'dsh', declaredModel: null, provider: 'dsh-local',
      preset: 'eval-lean',
      capabilities: { sha: other.sha, preset: 'other-preset', composition: lock.provisioned.capabilityComposition },
    })
    expect(refusal).toContain('another subject')
  })

  it('the JSON round-trip: evidence over the wire provisions identically', async () => {
    const wireA = libraryRoot({ ...CONDITION, scope: 'eval-b' })
    const direct = composition()
    const wired = JSON.parse(JSON.stringify(direct)) as CapabilityCompositionEvidence
    expect(readCapabilityCompositionShape(wired)).toEqual(direct)
    const report = await provisionCondition(wireA.conditionPath, {
      repo: join(wireA.conditionPath, '..', '..'), localAgent: spyLocalAgent(), evidence: faceWith(wired), now: () => FIXED_NOW,
    })
    expect(report.written).toBe(true)
    const lock = JSON.parse(readFileSync(wireA.lockPath, 'utf8')) as { provisioned: Record<string, unknown> }
    expect(lock.provisioned['capabilityComposition']).toEqual(direct)
  })

  it('a condition cannot self-declare the evidence — a smuggled field is a schema error, not a measurement', () => {
    const smuggled = { ...CONDITION, capabilityComposition: composition() }
    const { errors } = conditionDiagnostics(smuggled)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('the readiness gate compares the recorded measurement', () => {
  function subjectWith(record: CapabilityCompositionEvidence): ReadinessSubject {
    return {
      id: 'c1', harnessName: 'dsh', declaredModel: null, provider: 'dsh-local', scope: 'eval-b',
      preset: 'eval-lean',
      capabilities: { sha: record.sha, preset: record.measurement.presetId ?? null, composition: record },
    }
  }

  function completingAgent(): { agent: LocalAgentFace; start: ReturnType<typeof vi.fn> } {
    const start = vi.fn(() => Promise.resolve({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed' }) }))
    return {
      start,
      agent: { start, resume: () => Promise.reject(new Error('no resume')), cancel: () => false, get: () => undefined } as unknown as LocalAgentFace,
    }
  }

  it('a fresh answer identical to the record passes the gate', async () => {
    const record = composition()
    const { agent, start } = completingAgent()
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subjectWith(record)],
      parentSessionId: 'p1',
      probeDirBase: tmpTree(),
      readbackWaitMs: 0,
      evidence: faceWith(composition()),
    })
    expect(records[0]?.ok).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['sha drift', () => composition({ sha: 'e'.repeat(64) }), 'CAPABILITY_COMPOSITION_STALE'],
    ['a section now partial', () => composition({
      completeness: {
        skills: { state: 'complete' }, tools: { state: 'unavailable', reason: 'gone' },
        mcpServers: { state: 'complete' }, channels: { state: 'complete' },
      },
    }), 'CAPABILITY_COMPOSITION_INCOMPLETE'],
    ['revision moved', () => composition({ measurement: { kind: 'preset-composition', presetId: 'eval-lean', revision: 'rev-2' } }), 'CAPABILITY_COMPOSITION_MEASUREMENT_MISMATCH'],
    ['homeIdentity moved', () => composition({ homeIdentity: 'target-2' }), 'CAPABILITY_COMPOSITION_HOME_MISMATCH'],
    ['binding moved', () => composition({ binding: 'member-2' }), 'CAPABILITY_COMPOSITION_BINDING_MISMATCH'],
  ])('freshness drift — %s — refuses coded, before any delegation', async (_name, drift, code) => {
    const { agent, start } = completingAgent()
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subjectWith(composition())],
      parentSessionId: 'p1',
      probeDirBase: tmpTree(),
      evidence: faceWith(drift()),
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.reason).toContain(code)
    expect(start).not.toHaveBeenCalled()
  })

  it('the face throwing at freshness is CAPABILITY_COMPOSITION_INVALID — no local fallback', async () => {
    const { agent, start } = completingAgent()
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subjectWith(composition())],
      parentSessionId: 'p1',
      probeDirBase: tmpTree(),
      evidence: faceWith(new Error('target unreachable')),
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.reason).toContain('CAPABILITY_COMPOSITION_INVALID')
    expect(start).not.toHaveBeenCalled()
  })
})

describe('validation and display read the same measurement object', () => {
  it('the conditions list surfaces the recorded composition, and a drift warns coded', async () => {
    const record = composition()
    const stateRoot = tmpTree()
    writeJson(stateRoot, 'conditions/c1.json', CONDITION)
    writeJson(stateRoot, 'conditions/c1.lock.json', {
      schema: 'dataseek.condition-lock/1',
      condition: 'c1',
      sha: hashConditionDocument(CONDITION),
      home: { sha: 'e'.repeat(64) },
      provisioned: {
        at: FIXED_NOW,
        cliVersion: '0.1.5',
        effective: { model: 'deepseek-v4', reasoningEffort: 'default', permissions: 'unrestricted', endpoint: 'default' },
        preset: 'eval-lean',
        capabilityComposition: record,
      },
    })

    // Display: the record rides the lock, verbatim — the same measurement
    // object provision wrote and the gate compares.
    const drifted = composition({ sha: 'e'.repeat(64) })
    const service = new EvalService({ get: () => undefined }, { stateRoot, evidence: faceWith(drifted) })
    const report = await service.conditions()
    expect(report.conditions[0]?.lock.provisioned?.capabilityComposition).toEqual(record)
    expect(report.conditions[0]?.warnings.map(w => w.code)).toContain('CAPABILITY_COMPOSITION_STALE')

    // A matching answer: fresh, no drift warning.
    const freshService = new EvalService({ get: () => undefined }, { stateRoot, evidence: faceWith(composition()) })
    const freshReport = await freshService.conditions()
    expect(freshReport.conditions[0]?.warnings.map(w => w.code) ?? []).not.toContain('CAPABILITY_COMPOSITION_STALE')
  })
})

describe('the E3 pin, three answers about one home', () => {
  const INPUT = {
    planUnit: { image: 'eval-env:pinned' },
    conditionId: 'c1',
    condition: { ...CONDITION, unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } }, env: { keys: ['DSH_HOME'] } },
    harnessName: 'dsh',
    unitUid: 1000,
  } as const
  const PORT: ExecutionHomePort = {
    planScopedHome: async () => ({ mount: { source: 'vol-eval-dsh', type: 'volume' }, homeIdentity: 'target-1' }),
  }

  it('home fingerprint, composition and mount plan naming one target pass', async () => {
    const planned = await planScopedHomeMount(PORT, faceWith(composition()), { ...INPUT })
    expect(planned.ok).toBe(true)
  })

  it('the composition pinning another target refuses EXECUTION_HOME_IDENTITY_MISMATCH', async () => {
    const planned = await planScopedHomeMount(PORT, faceWith(composition({ homeIdentity: 'target-2' })), { ...INPUT })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_IDENTITY_MISMATCH'])
  })

  it('the composition answer missing (or unusable) refuses EXECUTION_HOME_EVIDENCE_MISSING', async () => {
    const planned = await planScopedHomeMount(PORT, faceWith(undefined), { ...INPUT })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.diagnostics.map(d => d.code)).toEqual(['EXECUTION_HOME_EVIDENCE_MISSING'])
  })
})

describe('the completeness vocabulary itself', () => {
  it('measured-zero is complete — only failure modes are partial or unavailable', () => {
    expect(incompleteSections(composition())).toEqual([])
    expect(incompleteSections(composition({
      completeness: {
        skills: { state: 'partial' },
        tools: { state: 'complete' },
        mcpServers: { state: 'unavailable' },
        channels: { state: 'complete' },
      },
    }))).toEqual(['skills', 'mcpServers'])
  })
})
