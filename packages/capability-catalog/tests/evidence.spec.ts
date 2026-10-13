import { describe, expect, it } from 'vitest'
import { hashOf, hashSkillBody } from '../src/capabilities.ts'
import { produceCapabilityEvidence } from '../src/evidence.ts'
import { catalogSnapshot, type CatalogSnapshotReport } from '../src/remote.ts'
import { collectToolFace } from '../src/tool-face.ts'
import type { RegistrySlice } from '../src/skills.ts'
import type { CatalogToolsSlice, ToolSchemaLike } from '../src/tool-face.ts'
import { setToolOrigin } from '../src/tool-origin.ts'

/** A skills-registry fixture: two skills with loadable bodies, overridable per test. */
function skillsFixture(overrides: Partial<RegistrySlice> = {}): RegistrySlice {
  const bodies: Record<string, string> = {
    planning: '# planning\nstep one\n',
    reviewing: '# reviewing\nlook twice\n',
  }
  return {
    snapshot: async () => ({
      skills: Object.keys(bodies).map(name => ({
        name,
        description: `the ${name} skill`,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user-dsh',
        provider: 'filesystem',
      })),
      complete: true,
    }),
    get: async (name: string) => {
      const content = bodies[name]
      if (content === undefined) return undefined
      return {
        name,
        description: `the ${name} skill`,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user-dsh',
        provider: 'filesystem',
        content,
      }
    },
    ...overrides,
  }
}

/** A tools-registry fixture: one builtin, one origin-tagged plugin tool, one MCP tool. */
function toolsFixture(overrides: Partial<CatalogToolsSlice> = {}): CatalogToolsSlice {
  const schemas: ToolSchemaLike[] = [
    { name: 'bash', description: 'Run a command', parameters: { command: { type: 'string' } } },
    { name: 'my_tool', description: 'A plugin tool', parameters: {} },
    { name: 'mcp__fs__read', description: 'Read a file', parameters: { path: { type: 'string' } } },
  ]
  const definitions: Record<string, object> = {
    bash: { name: 'bash' },
    my_tool: setToolOrigin({ name: 'my_tool' }, { channel: 'plugin', owner: '@khorsheed/dsh-fixture' }),
    'mcp__fs__read': { name: 'mcp__fs__read' },
  }
  return {
    schemas: () => schemas,
    get: (name: string) => definitions[name],
    ...overrides,
  }
}

const COVERAGE = { directories: ['/home/user/skills'], services: ['skills', 'tools'] } as const

describe('produceCapabilityEvidence — the completeness matrix', () => {
  it('a clean scan is complete on every section', async () => {
    const evidence = await produceCapabilityEvidence({
      presetId: 'eval-lean',
      workdir: '/home/user/project',
      skills: skillsFixture(),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.completeness).toEqual({
      skills: { state: 'complete' },
      tools: { state: 'complete' },
      mcpServers: { state: 'complete' },
      channels: { state: 'complete' },
    })
  })

  it('zero found is complete-with-zero, not a failure', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture({
        snapshot: async () => ({ skills: [], complete: true }),
        get: async () => undefined,
      }),
      tools: { schemas: () => [], get: () => undefined },
      coverage: { services: ['skills', 'tools'] },
    })
    expect(evidence.completeness.skills).toEqual({ state: 'complete' })
    expect(evidence.completeness.tools).toEqual({ state: 'complete' })
    expect(evidence.completeness.mcpServers).toEqual({ state: 'complete' })
    expect(evidence.completeness.channels).toEqual({ state: 'complete' })
    expect(evidence.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a registry-flagged incomplete discovery is partial, naming the class', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture({
        snapshot: async () => ({
          skills: [{
            name: 'planning',
            description: 'the planning skill',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'user-dsh',
            provider: 'filesystem',
          }],
          complete: false,
        }),
      }),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.skills.state).toBe('partial')
    expect(evidence.completeness.skills.reason).toContain('incomplete skill discovery')
    expect(evidence.completeness.channels).toEqual({
      state: 'partial',
      reason: 'summarizes sections that are not fully measured (skills: partial, tools: complete)',
    })
    expect(evidence.completeness.tools).toEqual({ state: 'complete' })
  })

  it('an unreadable skill body is partial, naming the class and the count', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture({
        get: async () => { throw new Error('read EACCES /home/user/secret/path') },
      }),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.skills.state).toBe('partial')
    expect(evidence.completeness.skills.reason).toBe('2 skill bodies could not be read')
    // The reason names the class, never the error text (which may carry paths).
    expect(evidence.completeness.skills.reason).not.toContain('EACCES')
    expect(evidence.completeness.skills.reason).not.toContain('/home/user/secret')
  })

  it('a failed skills read (the only scope) is unavailable, not empty', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture({
        snapshot: async () => { throw new Error('permission denied') },
      }),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.skills.state).toBe('unavailable')
    expect(evidence.completeness.skills.reason).toContain('read failed')
    expect(evidence.completeness.tools).toEqual({ state: 'complete' })
  })

  it('an absent skills service is unavailable, and confirmed-empty stays distinct from it', async () => {
    const absent = await produceCapabilityEvidence({
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(absent.completeness.skills).toEqual({ state: 'unavailable', reason: 'the skills service is not installed' })
    const empty = await produceCapabilityEvidence({
      skills: { snapshot: async () => ({ skills: [], complete: true }), get: async () => undefined },
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(empty.completeness.skills).toEqual({ state: 'complete' })
    // The two digests are equally well-formed; only the descriptor tells
    // "measured, zero found" from "not installed". They hash alike — which is
    // exactly why the consumer must read the completeness, not the digest.
    expect(absent.sha).toBe(empty.sha)
  })

  it('an origin tag that cannot be read is partial (heuristic attribution), never a hard failure', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture(),
      tools: toolsFixture({
        get: (name: string) => (name === 'my_tool' ? undefined : { name }),
      }),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.tools.state).toBe('partial')
    expect(evidence.completeness.tools.reason).toContain('origin tags unreadable for 1 visible tools')
    expect(evidence.completeness.mcpServers).toEqual({
      state: 'partial',
      reason: 'derived from a partially measured tools section',
    })
  })

  it('a throwing tools.get degrades to the same partial instead of failing the measurement', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture(),
      tools: toolsFixture({
        get: () => { throw new Error('registry raced') },
      }),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.tools.state).toBe('partial')
    expect(evidence.completeness.tools.reason).toContain('origin tags unreadable')
    expect(evidence.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a failed tools read is unavailable, and the MCP section inherits it', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture(),
      tools: {
        schemas: () => { throw new Error('read failed') },
        get: () => undefined,
      },
      coverage: COVERAGE,
    })
    expect(evidence.completeness.tools).toEqual({ state: 'unavailable', reason: 'the tool registry read failed' })
    expect(evidence.completeness.mcpServers).toEqual({
      state: 'unavailable',
      reason: 'MCP servers are derived from the tools section, which is unavailable',
    })
    expect(evidence.completeness.skills).toEqual({ state: 'complete' })
    expect(evidence.completeness.channels.state).toBe('partial')
  })

  it('an absent tools service is unavailable, with the derivations marked accordingly', async () => {
    const evidence = await produceCapabilityEvidence({
      skills: skillsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.completeness.tools).toEqual({ state: 'unavailable', reason: 'the tools service is not installed' })
    expect(evidence.completeness.mcpServers.state).toBe('unavailable')
    expect(evidence.completeness.channels).toEqual({
      state: 'partial',
      reason: 'summarizes sections that are not fully measured (skills: complete, tools: unavailable)',
    })
  })

  it('nothing installed at all is unavailable across the board, with a well-formed digest', async () => {
    const evidence = await produceCapabilityEvidence({ coverage: { services: [] } })
    expect(evidence.completeness).toEqual({
      skills: { state: 'unavailable', reason: 'the skills service is not installed' },
      tools: { state: 'unavailable', reason: 'the tools service is not installed' },
      mcpServers: { state: 'unavailable', reason: 'MCP servers are derived from the tools section, which is unavailable' },
      channels: { state: 'unavailable', reason: 'neither the skills nor the tools section could be measured' },
    })
    expect(evidence.sha).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('produceCapabilityEvidence — digest parity with the fingerprint verb', () => {
  it('produces the digest snapshotFor stamps over the same fixture', async () => {
    // What CapabilityCatalogService.collect(preset, workdir, true) does: read
    // the tools side at the scope, then catalogSnapshot in fingerprint mode.
    const scope = Symbol('standing-scope')
    const face = collectToolFace(toolsFixture(), scope, () => {})
    const viaVerb = await catalogSnapshot(
      '/home/user/project',
      skillsFixture(),
      face.schemas,
      face.mcpServerNames,
      new Set(),
      [scope],
      face.origins,
      { fingerprint: true, preset: 'eval-lean' },
    )
    const evidence = await produceCapabilityEvidence({
      presetId: 'eval-lean',
      workdir: '/home/user/project',
      scope,
      skills: skillsFixture(),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    expect(evidence.sha).toBe(viaVerb.sha)
    expect(evidence.sha).toBe(hashOf(viaVerb))
  })

  it('the measurement metadata does not enter the digest', async () => {
    const base = await produceCapabilityEvidence({
      skills: skillsFixture(),
      tools: toolsFixture(),
      coverage: COVERAGE,
    })
    const labelled = await produceCapabilityEvidence({
      presetId: 'eval-lean',
      workdir: '/home/user/other-project',
      revision: 'config@abc123',
      skills: skillsFixture(),
      tools: toolsFixture(),
      coverage: { directories: ['/elsewhere'], services: [] },
    })
    // presetId/workdir/revision name WHAT was measured; they are evidence
    // metadata, not capabilities — the digest moves only with the face.
    expect(labelled.sha).toBe(base.sha)
    expect(labelled.measurement).toEqual({
      kind: 'preset-composition',
      presetId: 'eval-lean',
      workdir: '/home/user/other-project',
      revision: 'config@abc123',
    })
  })
})

describe('produceCapabilityEvidence — no side effects', () => {
  it('reads only the handed slices: no mount, no registration, no other calls', async () => {
    const calls: string[] = []
    const scope = Symbol('already-resolved')
    const skills: RegistrySlice = {
      snapshot: async (options) => {
        calls.push(`skills.snapshot scope=${String(options?.scope === scope)}`)
        return { skills: [], complete: true }
      },
      get: async () => { calls.push('skills.get'); return undefined },
    }
    const tools: CatalogToolsSlice = {
      schemas: (s) => { calls.push(`tools.schemas scope=${String(s === scope)}`); return [] },
      get: () => { calls.push('tools.get'); return undefined },
    }
    const evidence = await produceCapabilityEvidence({
      presetId: 'eval-lean',
      scope,
      skills,
      tools,
      coverage: COVERAGE,
    })
    // The opaque scope is passed THROUGH to the reads — never resolved (there
    // is no roster parameter to resolve it with) and never released (the
    // caller owns the lease). Zero skills/tools means no get calls.
    expect(calls).toEqual(['tools.schemas scope=true', 'skills.snapshot scope=true'])
    expect(evidence.completeness.skills).toEqual({ state: 'complete' })
  })
})

describe('produceCapabilityEvidence — the wire form', () => {
  it('survives a JSON round-trip with measurement, completeness and coverage intact', async () => {
    const evidence = await produceCapabilityEvidence({
      presetId: 'eval-lean',
      workdir: '/home/user/project',
      revision: 'config@abc123',
      skills: skillsFixture(),
      tools: toolsFixture({
        get: (name: string) => (name === 'my_tool' ? undefined : { name }),
      }),
      coverage: COVERAGE,
    })
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence)
  })

  it('omits unset measurement fields rather than nulling them', async () => {
    const evidence = await produceCapabilityEvidence({ coverage: {} })
    expect(evidence.measurement).toEqual({ kind: 'preset-composition' })
    expect(evidence.coverage).toEqual({})
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence)
  })

  it('refuses a relative workdir, a blank presetId, and a missing coverage declaration', async () => {
    await expect(produceCapabilityEvidence({ workdir: 'relative/dir', coverage: {} }))
      .rejects.toThrow(/absolute workdir/)
    await expect(produceCapabilityEvidence({ presetId: '  ', coverage: {} }))
      .rejects.toThrow(/non-empty presetId/)
    await expect(produceCapabilityEvidence({} as never))
      .rejects.toThrow(/coverage declaration/)
  })
})

describe('catalogSnapshot — the collection-health report the verbs never ask for', () => {
  it('reports a failed scope read among several without changing the rows', async () => {
    const good = Symbol('good')
    const bad = Symbol('bad')
    const registry: RegistrySlice = {
      snapshot: async (options) => {
        if (options?.scope === bad) throw new Error('mount failed')
        return {
          skills: [{
            name: 'planning',
            description: 'the planning skill',
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'user-dsh',
            provider: 'filesystem',
          }],
          complete: true,
        }
      },
      get: async () => undefined,
    }
    const report: CatalogSnapshotReport = {}
    const snapshot = await catalogSnapshot(undefined, registry, [], [], new Set(), [good, bad], new Map(), { report })
    expect(snapshot.skills.map(row => row.name)).toEqual(['planning'])
    expect(report.skills).toEqual({ attemptedScopes: 2, failedScopes: 1, incompleteReads: 0, unreadableBodies: 0 })
    // Without the bag the same call returns the same rows and nothing else.
    const bare = await catalogSnapshot(undefined, registry, [], [], new Set(), [good, bad])
    expect(bare).toEqual(snapshot)
  })
})

describe('the snapshot completeness field and the digest', () => {
  it('completeness rides the snapshot without entering its digest', async () => {
    const snapshot = await catalogSnapshot(
      undefined, skillsFixture(), [], [], new Set(), [undefined], new Map(), { fingerprint: true },
    )
    const withCompleteness = {
      ...snapshot,
      completeness: { skills: { state: 'partial' as const, reason: 'anything' } },
    }
    expect(hashOf(withCompleteness)).toBe(snapshot.sha)
    expect(hashSkillBody('# planning\nstep one\n')).toBe(snapshot.skills[0]?.bodySha)
  })
})
