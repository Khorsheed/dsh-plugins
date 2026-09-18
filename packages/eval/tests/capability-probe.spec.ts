/**
 * T32b — the capability probe `conditions provision` runs inside a live
 * instance, and the freshness re-measure the readiness gate does with it.
 *
 * T32 wrote the hook and nothing filled it. What is pinned here is the two
 * halves of filling it honestly: the probe measures only what it can stand
 * behind (and names the step that declined otherwise), and a lock whose
 * preset changed underneath it stops reading as verified.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { instanceCapabilityProbe, scopeKeepsOwnPreset } from '../src/capability-probe.ts'
import { presetFromPatch, readScopePreset } from '../src/sub-profile.ts'
import { compositionAbsolutePaths, hashPresetTree, scopePresetDir } from '../src/preset-snapshot.ts'
import { capabilityRefusal, checkReadiness, type ReadinessSubject } from '../src/readiness.ts'
import type { CapabilityCatalogFace, CapabilitySnapshotFace } from '../src/faces.ts'
import type { CapabilityProbeInput } from '../src/provision.ts'
import { EvalService } from '../src/service.ts'

const LEAN_SHA = 'a'.repeat(64)
const FULL_SHA = 'c'.repeat(64)
const SNAPSHOT_SHA = 'b'.repeat(64)

/** The patch shape `@khorsheed/dsh-local-agent-dsh` generates for a rostered scope. */
function generatedPatch(preset: string): string {
  return `- id: system-prompt
  config:
    persona: >-
      You are a coding agent powered by the {{model}} model.

- id: tools
  config:
    mode: !!js process.env.DSH_TOOLS_MODE

- insert:
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'

    - id: member-bridge
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        command: !!js process.execPath
        args:
          - !!js process.env.DSH_MEMBER_BRIDGE_ENTRY || ''
        env:
          DSH_MEMBER_SOCKET: !!js process.env.DSH_MEMBER_SOCKET ?? ''

# --- preset roster (written by local-agent-dsh provisioning) ---
- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: ${JSON.stringify(preset)}
`
}

/** A scoped home whose sub-profile rosters `preset` (or none). */
function scopeHome(preset?: string, options: { profileName?: string; ownPresetDir?: string; composition?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'eval-scope-'))
  const profile = join(home, 'profiles', options.profileName ?? 'headless-local-agent-dsh')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), preset === undefined ? '- id: tools\n' : generatedPatch(preset))
  if (options.ownPresetDir !== undefined) {
    const dir = join(home, '.agent-presets', options.ownPresetDir)
    mkdirSync(join(dir, 'skills', 'eval-planning'), { recursive: true })
    writeFileSync(join(dir, 'agent.cordis.yml'), options.composition ?? RELOCATABLE_COMPOSITION)
    writeFileSync(join(dir, 'skills', 'eval-planning', 'SKILL.md'), 'Draft the plan. One stage, then stop and report.\n')
  }
  return home
}

/** The composition shape a preset must have to be a factor: no absolute path. */
const RELOCATABLE_COMPOSITION = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
`

/** The shape pilot D shipped first: a skills root pinned to one machine's path. */
const ABSOLUTE_COMPOSITION = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - "/opt/dsh-lab/.agent-presets/eval-lean/skills"
`

function face(over: Partial<CapabilitySnapshotFace> = {}): CapabilitySnapshotFace {
  return { sha: LEAN_SHA, preset: 'eval-lean', skills: [{}, {}], tools: [{}, {}, {}], ...over }
}

function catalogOf(answer: (presetId?: string) => Promise<CapabilitySnapshotFace>): CapabilityCatalogFace {
  return { snapshotFor: (presetId?: string) => answer(presetId) }
}

function probeInput(homeDir: string, over: Partial<CapabilityProbeInput> = {}): CapabilityProbeInput {
  return { condition: 'dsh-lean', harness: 'dsh', scope: 'lean', homeDir, preset: 'eval-lean', ...over }
}

describe('presetFromPatch — the roster read-back', () => {
  it('reads the roster default out of a generated sub-profile patch', () => {
    expect(presetFromPatch(generatedPatch('eval-lean'))).toBe('eval-lean')
    expect(presetFromPatch(generatedPatch('eval-full'))).toBe('eval-full')
  })

  it('tolerates the loader\'s !!js expression tags rather than choking on them', () => {
    // The patch is full of them and none is ours to evaluate; a reader that
    // rejected the document over a tag on a row it never looks at would read
    // every real sub-profile as "no roster".
    expect(generatedPatch('eval-lean')).toContain('!!js')
    expect(presetFromPatch(generatedPatch('eval-lean'))).toBe('eval-lean')
  })

  it('reads nothing from a patch that mounts no roster, and from junk', () => {
    expect(presetFromPatch('- id: tools\n')).toBeUndefined()
    expect(presetFromPatch('')).toBeUndefined()
    expect(presetFromPatch('not: [a, list')).toBeUndefined()
    // A roster row with no default names no preset.
    expect(presetFromPatch("- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n")).toBeUndefined()
  })

  it('keys on the roster PACKAGE, not on the generated comment or the row id', () => {
    const renamed = generatedPatch('eval-lean')
      .replace('# --- preset roster (written by local-agent-dsh provisioning) ---', '# hand-written')
      .replace('- id: agent-presets', '- id: presets-of-mine')
    expect(presetFromPatch(renamed)).toBe('eval-lean')
  })
})

describe('readScopePreset — every profile under the scoped home', () => {
  it('reads the roster of a sub-profile whatever its directory is called', () => {
    expect(readScopePreset(scopeHome('eval-lean'))).toBe('eval-lean')
    expect(readScopePreset(scopeHome('eval-full', { profileName: 'renamed-by-config' }))).toBe('eval-full')
  })

  it('reads nothing from a scope with no profiles, or none that rosters', () => {
    expect(readScopePreset(mkdtempSync(join(tmpdir(), 'eval-scope-')))).toBeUndefined()
    expect(readScopePreset(scopeHome())).toBeUndefined()
  })

  it('reads nothing when two profiles roster two different presets — nobody can pick', () => {
    const home = scopeHome('eval-lean')
    const second = join(home, 'profiles', 'another')
    mkdirSync(second, { recursive: true })
    writeFileSync(join(second, 'cordis.patch.yml'), generatedPatch('eval-full'))
    expect(readScopePreset(home)).toBeUndefined()
  })
})

describe('scopeKeepsOwnPreset', () => {
  it('is false when the scope defers to the deployment\'s preset root', () => {
    expect(scopeKeepsOwnPreset(scopeHome('eval-lean'), 'eval-lean')).toBe(false)
  })

  it('is true when the scope holds its own copy — the arrangement a unit needs', () => {
    expect(scopeKeepsOwnPreset(scopeHome('eval-lean', { ownPresetDir: 'eval-lean' }), 'eval-lean')).toBe(true)
  })
})

describe('instanceCapabilityProbe', () => {
  it('measures the preset the SCOPE rosters and reports the digest with its counts', async () => {
    const asked: (string | undefined)[] = []
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async (id) => { asked.push(id); return face() }),
    })
    const measured = await probe(probeInput(scopeHome('eval-lean')))
    expect(asked).toEqual(['eval-lean'])
    // No copy of its own: the deployment's root is what was measured, which
    // is honest and host-only.
    expect(measured).toEqual({ sha: LEAN_SHA, preset: 'eval-lean', skills: 2, tools: 3, source: 'instance-root' })
  })

  it('measures what the SCOPE rosters even when the declaration says otherwise', async () => {
    // Recording the declaration here would erase the only evidence the two
    // disagree; provision warns on it and the readiness gate refuses.
    const asked: (string | undefined)[] = []
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async (id) => { asked.push(id); return face({ sha: FULL_SHA, preset: 'eval-full' }) }),
    })
    const measured = await probe(probeInput(scopeHome('eval-full'), { preset: 'eval-lean' }))
    expect(asked).toEqual(['eval-full'])
    expect(measured?.preset).toBe('eval-full')
    expect(measured?.sha).toBe(FULL_SHA)
  })

  it('measures nothing when the scope rosters no readable preset, and says which step declined', async () => {
    const lines: string[] = []
    const probe = instanceCapabilityProbe({ catalog: catalogOf(async () => face()), log: line => lines.push(line) })
    expect(await probe(probeInput(scopeHome()))).toBeUndefined()
    expect(lines.join('\n')).toMatch(/rosters no readable preset/)
  })

  it('measures nothing when the scope keeps a copy nothing vouched for — the silent-wrong-hash case', async () => {
    const lines: string[] = []
    let called = false
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async () => { called = true; return face() }),
      log: line => lines.push(line),
    })
    // No `snapshot` on the input: this provision did not compose the scope,
    // so nothing establishes that the copy is the deployment's.
    expect(await probe(probeInput(scopeHome('eval-lean', { ownPresetDir: 'eval-lean' })))).toBeUndefined()
    // The catalog is never even asked: its answer would be another preset
    // that happens to share the name.
    expect(called).toBe(false)
    expect(lines.join('\n')).toMatch(/its own eval-lean preset directory and nothing vouched for it/)
  })

  it('measures nothing when the provisioning says the copy does NOT match the deployment\'s', async () => {
    const lines: string[] = []
    let called = false
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async () => { called = true; return face() }),
      log: line => lines.push(line),
    })
    const input = probeInput(scopeHome('eval-lean', { ownPresetDir: 'eval-lean' }), { snapshot: { matchesSource: false } })
    expect(await probe(input)).toBeUndefined()
    expect(called).toBe(false)
    expect(lines.join('\n')).toMatch(/nothing vouched for it/)
  })

  it('measures a vouched-for copy and records its digest and its source', async () => {
    const home = scopeHome('eval-lean', { ownPresetDir: 'eval-lean' })
    const probe = instanceCapabilityProbe({ catalog: catalogOf(async () => face()) })
    const measured = await probe(probeInput(home, { snapshot: { matchesSource: true } }))
    expect(measured?.source).toBe('scope-snapshot')
    expect(measured?.sha).toBe(LEAN_SHA)
    // The snapshot digest is the scope's own copy, hashed here — not the
    // capability face, and not anything the catalog said.
    expect(measured?.snapshot?.sha).toBe((await hashPresetTree(scopePresetDir(home, 'eval-lean')))?.sha)
  })

  it('refuses a vouched-for copy whose composition names an absolute path', async () => {
    const lines: string[] = []
    let called = false
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async () => { called = true; return face() }),
      log: line => lines.push(line),
    })
    const home = scopeHome('eval-lean', { ownPresetDir: 'eval-lean', composition: ABSOLUTE_COMPOSITION })
    expect(await probe(probeInput(home, { snapshot: { matchesSource: true } }))).toBeUndefined()
    expect(called).toBe(false)
    expect(lines.join('\n')).toMatch(/names absolute path\(s\) "\/opt\/dsh-lab/)
  })

  it('measures nothing when the catalog refuses the preset, and carries the reason', async () => {
    const lines: string[] = []
    const probe = instanceCapabilityProbe({
      catalog: catalogOf(async () => { throw new Error('cannot fingerprint preset "eval-lean": failed to mount') }),
      log: line => lines.push(line),
    })
    expect(await probe(probeInput(scopeHome('eval-lean')))).toBeUndefined()
    expect(lines.join('\n')).toMatch(/failed to mount/)
  })

  it('measures nothing when the face carries no digest, rather than inventing one', async () => {
    const probe = instanceCapabilityProbe({ catalog: catalogOf(async () => face({ sha: undefined })) })
    expect(await probe(probeInput(scopeHome('eval-lean')))).toBeUndefined()
  })

  it('falls back to hashOf for a catalog whose snapshot predates the stamp', async () => {
    const probe = instanceCapabilityProbe({
      catalog: {
        snapshotFor: async () => face({ sha: undefined }),
        hashOf: () => FULL_SHA,
      },
    })
    expect((await probe(probeInput(scopeHome('eval-lean'))))?.sha).toBe(FULL_SHA)
  })
})

describe('capabilityRefusal — freshness', () => {
  const locked: ReadinessSubject = {
    id: 'dsh-lean',
    harnessName: 'dsh',
    declaredModel: null,
    provider: 'dsh-cli',
    preset: 'eval-lean',
    capabilities: { sha: LEAN_SHA, preset: 'eval-lean' },
  }

  it('passes when the face still measures what the lock recorded', () => {
    expect(capabilityRefusal(locked, LEAN_SHA)).toBeUndefined()
  })

  it('refuses when the preset changed after provision', () => {
    const reason = capabilityRefusal(locked, FULL_SHA)
    expect(reason).toMatch(/changed after provision/)
    expect(reason).toMatch(/conditions provision/)
  })

  it('leaves the locked record standing when nothing could be re-measured', () => {
    // The absence of a measurement is evidence about the catalog, not about
    // the subject — refusing on it would fail runs for an unrelated reason.
    expect(capabilityRefusal(locked, undefined)).toBeUndefined()
  })

  const withSnapshot: ReadinessSubject = {
    ...locked,
    capabilities: { sha: LEAN_SHA, preset: 'eval-lean', snapshot: { sha: SNAPSHOT_SHA } },
  }

  it('passes when the scope\'s own copy still hashes to what the lock recorded', () => {
    expect(capabilityRefusal(withSnapshot, LEAN_SHA, SNAPSHOT_SHA)).toBeUndefined()
  })

  it('refuses when the scope\'s copy changed — the subject itself, checked without a catalog', () => {
    // This is the check `home.sha` cannot do (it hashes config-suffixed files,
    // and a skill body is not one) and the capability face can only do with a
    // live instance.
    const reason = capabilityRefusal(withSnapshot, LEAN_SHA, 'd'.repeat(64))
    expect(reason).toMatch(/the preset this scope runs changed after provision/)
    expect(reason).toMatch(/conditions provision/)
  })

  it('leaves the locked record standing when the copy could not be re-hashed', () => {
    expect(capabilityRefusal(withSnapshot, LEAN_SHA, undefined)).toBeUndefined()
  })
})

describe('checkReadiness — the re-measure runs before any delegation', () => {
  const localAgent = {
    start: async (): Promise<never> => { throw new Error('the readiness probe must not delegate here') },
    cancel: (): void => {},
    get: (): undefined => undefined,
    delegationOf: (): undefined => undefined,
  }
  const subject: ReadinessSubject = {
    id: 'dsh-lean',
    harnessName: 'dsh',
    declaredModel: null,
    provider: 'dsh-cli',
    preset: 'eval-lean',
    capabilities: { sha: LEAN_SHA, preset: 'eval-lean' },
  }

  it('fails a condition whose scope copy changed, without starting a delegation and without a catalog', async () => {
    const homesRoot = mkdtempSync(join(tmpdir(), 'eval-homes-'))
    const dir = join(homesRoot, 'dsh', '.agent-presets', 'eval-lean')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'agent.cordis.yml'), RELOCATABLE_COMPOSITION)
    const records = await checkReadiness({
      localAgent: { ...localAgent, homeDir: (harness: string) => join(homesRoot, harness) } as never,
      conditions: [{ ...subject, capabilities: { sha: LEAN_SHA, preset: 'eval-lean', snapshot: { sha: SNAPSHOT_SHA } } }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.childSessionId).toBeNull()
    expect(records[0]?.reason).toMatch(/the preset this scope runs changed after provision/)
  })

  it('fails a condition whose preset changed, without starting a delegation', async () => {
    const records = await checkReadiness({
      localAgent: localAgent as never,
      conditions: [subject],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
      capabilitiesNow: async () => FULL_SHA,
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.childSessionId).toBeNull()
    expect(records[0]?.reason).toMatch(/changed after provision/)
  })

  it('does not re-measure a condition that declares no preset', async () => {
    let called = false
    const records = await checkReadiness({
      localAgent: {
        ...localAgent,
        start: async () => ({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed' as const, text: 'READY' }) }),
      } as never,
      conditions: [{ id: 'plain', harnessName: 'dsh', declaredModel: null, provider: 'dsh-cli' }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
      readbackWaitMs: 0,
      capabilitiesNow: async () => { called = true; return FULL_SHA },
    })
    expect(called).toBe(false)
    expect(records[0]?.ok).toBe(true)
  })

  it('a re-measure that throws leaves the condition ready on its locked record', async () => {
    const lines: string[] = []
    const records = await checkReadiness({
      localAgent: {
        ...localAgent,
        start: async () => ({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed' as const, text: 'READY' }) }),
      } as never,
      conditions: [subject],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
      readbackWaitMs: 0,
      capabilitiesNow: async () => { throw new Error('the catalog is not mounted') },
      log: line => lines.push(line),
    })
    expect(records[0]?.ok).toBe(true)
    expect(lines.join('\n')).toMatch(/could not be re-measured/)
  })
})

describe('EvalService.provision — the instance supplies the probe', () => {
  /** A repo working copy holding one rostered dsh condition, plus its scope. */
  function instanceTree(preset: string | null): { repo: string; conditionPath: string; homesRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'eval-instance-'))
    const conditions = join(root, 'repo', 'datasets', 'ds', 'conditions')
    mkdirSync(conditions, { recursive: true })
    writeFileSync(join(conditions, 'dsh-lean.json'), JSON.stringify({
      schema: 'dataseek.condition/1',
      harness: { name: 'dsh', version: '0.1.5-rc.1', drive: 'exec' },
      model: { declared: 'deepseek-official/deepseek-v4-pro', endpoint: 'default' },
      reasoning: { effort: 'high' },
      permissions: 'unrestricted',
      instructions: 'none',
      preset,
      skills: { pack: null },
      home: { sha: null },
      env: { keys: ['DSH_HOME'] },
    }, null, 2))
    return { repo: join(root, 'repo'), conditionPath: join(conditions, 'dsh-lean.json'), homesRoot: join(root, 'homes') }
  }

  /** The local-agent face provision reads, over a scope that rosters `preset`. */
  function hostsWith(
    homesRoot: string,
    rostered: string | undefined,
    catalog?: CapabilityCatalogFace,
    scopeComposer?: {
      composed: Array<{ harness: string; scope?: string; preset?: string }>
      /** What the harness reports back; a thrown error is the failure path. */
      answer?: (homeDir: string, preset?: string) => { preset?: string; presetSnapshot?: { matchesSource: boolean } }
    },
  ) {
    const homeDir = (harness: string, scope?: string): string => {
      const dir = join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)
      mkdirSync(dir, { recursive: true })
      if (rostered !== undefined) {
        const profile = join(dir, 'profiles', 'headless-local-agent-dsh')
        mkdirSync(profile, { recursive: true })
        writeFileSync(join(profile, 'cordis.patch.yml'), generatedPatch(rostered))
      }
      return dir
    }
    const localAgent = {
      start: () => Promise.reject(new Error('provision never delegates')),
      resume: () => Promise.reject(new Error('provision never delegates')),
      cancel: () => false,
      get: () => undefined,
      homeDir,
      statusOf: (harness: string, scope?: string) => Promise.resolve({
        name: harness, homeDir: homeDir(harness, scope), credentialState: 'present-unverified', loginable: true,
      }),
      effectiveSettings: () => Promise.resolve({
        drive: 'exec', baseUrlSet: false, reasoningEffort: 'high',
        cliVersion: '0.1.5-rc.1', model: 'deepseek-official/deepseek-v4-pro',
      }),
      ...(scopeComposer === undefined ? {} : {
        provisionScope: (harness: string, scope?: string, options?: { preset?: string }) => {
          scopeComposer.composed.push({ harness, ...(scope === undefined ? {} : { scope }), ...(options?.preset === undefined ? {} : { preset: options.preset }) })
          const dir = homeDir(harness, scope)
          return Promise.resolve({ homeDir: dir, ...(scopeComposer.answer?.(dir, options?.preset) ?? {}) })
        },
      }),
    }
    return {
      get: (name: string): unknown =>
        name === 'localAgent' ? localAgent : name === 'capabilityCatalog' ? catalog : undefined,
    }
  }

  it('writes the measured face into the lock when the catalog is mounted', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const service = new EvalService(hostsWith(homesRoot, 'eval-lean', catalogOf(async () => face())))
    const report = await service.provision(conditionPath, { repo })

    expect(report.written).toBe(true)
    const provisioned = (report.lock as { provisioned: Record<string, unknown> }).provisioned
    expect(provisioned['capabilities']).toEqual({ sha: LEAN_SHA, preset: 'eval-lean', skills: 2, tools: 3, source: 'instance-root' })
    expect(provisioned['preset']).toBe('eval-lean')
    expect(report.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_UNMEASURED')
  })

  it('composes the CONDITION\'s preset into the scope before it hashes the home', async () => {
    // Two things at once, and both matter. The preset is a property of the
    // subject, so the condition document is what decides it — not the
    // deployment's plugin settings, which have one answer per instance. And
    // the scope's own copy of the preset lives INSIDE the scoped home, so
    // composing it after the hash would lock a home.sha that describes a
    // directory that no longer exists.
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const composer = {
      composed: [] as Array<{ harness: string; scope?: string; preset?: string }>,
      answer: (dir: string, preset?: string) => {
        const target = join(dir, '.agent-presets', preset ?? '')
        mkdirSync(join(target, 'skills'), { recursive: true })
        writeFileSync(join(target, 'agent.cordis.yml'), RELOCATABLE_COMPOSITION)
        writeFileSync(join(target, 'skills', 'SKILL.md'), 'Draft the plan.\n')
        return { preset, presetSnapshot: { matchesSource: true } }
      },
    }
    const service = new EvalService(hostsWith(homesRoot, 'eval-lean', catalogOf(async () => face()), composer))
    const report = await service.provision(conditionPath, { repo })

    expect(composer.composed).toEqual([{ harness: 'dsh', preset: 'eval-lean' }])
    expect(report.scopeProvisioned).toEqual({ preset: 'eval-lean', snapshotMatchesSource: true })
    const provisioned = (report.lock as { provisioned: Record<string, unknown> }).provisioned
    const capabilities = provisioned['capabilities'] as Record<string, unknown>
    expect(capabilities['source']).toBe('scope-snapshot')
    expect(capabilities['snapshot']).toEqual({
      sha: (await hashPresetTree(join(homesRoot, 'dsh', '.agent-presets', 'eval-lean')))?.sha,
    })
    // The copy is inside the scoped home, so the home hash covers its config
    // files — and the write-back corrected the declaration to match.
    const declaration = JSON.parse(readFileSync(conditionPath, 'utf8')) as { home: { sha: string } }
    expect(declaration.home.sha).toBe(report.home?.sha)
  })

  it('never composes a scope for a condition that declares no preset', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree(null)
    const composer = { composed: [] as Array<{ harness: string; scope?: string; preset?: string }> }
    const service = new EvalService(hostsWith(homesRoot, undefined, catalogOf(async () => face()), composer))
    const report = await service.provision(conditionPath, { repo })
    expect(composer.composed).toEqual([])
    expect(report.scopeProvisioned).toBeNull()
    expect(report.written).toBe(true)
  })

  it('reports a scope composition that failed and still provisions from what the scope holds', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const composer = {
      composed: [] as Array<{ harness: string; scope?: string; preset?: string }>,
      answer: (): never => { throw new Error('no preset "eval-lean" in this deployment\'s preset root') },
    }
    const service = new EvalService(hostsWith(homesRoot, 'eval-lean', catalogOf(async () => face()), composer))
    const report = await service.provision(conditionPath, { repo })
    expect(report.warnings.map(warning => warning.code)).toContain('SCOPE_NOT_PROVISIONED')
    // The scope still rosters the preset and keeps no copy of its own, so the
    // face is measurable against the deployment's root — which is what the
    // read-back, not the failed call, decides.
    expect(report.written).toBe(true)
    expect(((report.lock as { provisioned: Record<string, unknown> }).provisioned['capabilities'] as Record<string, unknown>)['source'])
      .toBe('instance-root')
  })

  it('degrades to the read-back alone against a facade with no provisionScope', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const service = new EvalService(hostsWith(homesRoot, 'eval-lean', catalogOf(async () => face())))
    const report = await service.provision(conditionPath, { repo })
    expect(report.scopeProvisioned).toBeNull()
    expect(report.written).toBe(true)
  })

  it('keeps the T32 degrade when no catalog is mounted', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const report = await new EvalService(hostsWith(homesRoot, 'eval-lean')).provision(conditionPath, { repo })
    expect(report.written).toBe(true)
    expect(report.warnings.map(warning => warning.code)).toContain('CAPABILITIES_UNMEASURED')
    expect('capabilities' in (report.lock as { provisioned: Record<string, unknown> }).provisioned).toBe(false)
  })

  it('never asks the catalog for a condition that declares no preset', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree(null)
    let called = false
    const catalog = catalogOf(async () => { called = true; return face() })
    const report = await new EvalService(hostsWith(homesRoot, 'eval-lean', catalog)).provision(conditionPath, { repo })
    expect(called).toBe(false)
    expect(report.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_UNMEASURED')
  })

  it('warns rather than writing a guess when the scope rosters nothing', async () => {
    const { repo, conditionPath, homesRoot } = instanceTree('eval-lean')
    const service = new EvalService(hostsWith(homesRoot, undefined, catalogOf(async () => face())))
    const report = await service.provision(conditionPath, { repo })
    expect(report.warnings.map(warning => warning.code)).toContain('CAPABILITIES_UNMEASURED')
  })
})
