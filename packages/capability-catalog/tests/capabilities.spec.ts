import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  CAPS_TAG_PREFIX, canonicalCapabilities, canonicalJson, capsTag, hashOf, hashSkillBody,
} from '../src/capabilities.ts'
import { catalogSnapshot } from '../src/remote.ts'
import { resolvePresetScope } from '../src/preset-scope.ts'
import type { CapabilityCatalogSnapshot, CatalogSkillRow, CatalogToolRow } from '../src/types.ts'

function skill(name: string, extra: Partial<CatalogSkillRow> = {}): CatalogSkillRow {
  return {
    name,
    description: `the ${name} skill`,
    source: 'user-dsh',
    provider: 'filesystem',
    modelInvocable: true,
    userInvocable: true,
    bodySha: hashSkillBody(`# ${name}\n`),
    ...extra,
  }
}

function tool(name: string, extra: Partial<CatalogToolRow> = {}): CatalogToolRow {
  return {
    name,
    description: `the ${name} tool`,
    channel: 'builtin',
    confidence: 'exact',
    parameters: { path: { type: 'string' } },
    ...extra,
  }
}

function snapshotOf(
  skills: readonly CatalogSkillRow[],
  tools: readonly CatalogToolRow[],
  mcpServers: readonly { name: string; toolCount: number }[] = [],
): CapabilityCatalogSnapshot {
  return {
    skills,
    tools,
    mcpServers,
    channels: [{ channel: 'skill', count: skills.length }, { channel: 'tool', count: tools.length }],
  }
}

describe('canonicalJson', () => {
  it('sorts object keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 4, c: 5 }] })).toBe('{"a":[3,{"c":5,"d":4}],"b":1}')
  })

  it('agrees with the eval contract copy on the shapes a capability face uses', () => {
    // Pinned literally: the two canonicalJson copies (here and in
    // @khorsheed/dsh-eval) may never drift, because a `caps:` tag crosses
    // between them.
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson([])).toBe('[]')
    expect(canonicalJson({})).toBe('{}')
    expect(canonicalJson({ 'B': 1, 'a': 2 })).toBe('{"B":1,"a":2}')
  })
})

describe('canonicalCapabilities', () => {
  it('sorts every list by name, whatever the registration order', () => {
    const canonical = canonicalCapabilities(snapshotOf(
      [skill('zeta'), skill('alpha')],
      [tool('write'), tool('bash')],
    ))
    expect(canonical.skills.map(row => row.name)).toEqual(['alpha', 'zeta'])
    expect(canonical.tools.map(row => row.name)).toEqual(['bash', 'write'])
  })

  it('keeps only name/source/body per skill and name/channel/parameters per tool', () => {
    const canonical = canonicalCapabilities(snapshotOf([skill('alpha')], [tool('bash')]))
    expect(Object.keys(canonical.skills[0] as object).sort()).toEqual(['body', 'name', 'source'])
    expect(Object.keys(canonical.tools[0] as object).sort()).toEqual(['channel', 'name', 'parameters'])
  })

  it('records a missing body sha and a missing parameter schema as null', () => {
    const canonical = canonicalCapabilities(snapshotOf(
      [skill('remote', { bodySha: undefined })],
      [tool('ask_user', { parameters: undefined })],
    ))
    expect(canonical.skills[0]?.body).toBeNull()
    expect(canonical.tools[0]?.parameters).toBeNull()
  })

  it('gives each MCP server its tool NAMES, not its tool count', () => {
    const canonical = canonicalCapabilities(snapshotOf([], [
      tool('mcp__fs__write', { channel: 'mcp', serverName: 'fs' }),
      tool('mcp__fs__read', { channel: 'mcp', serverName: 'fs' }),
      tool('bash'),
    ], [{ name: 'fs', toolCount: 2 }]))
    expect(canonical.mcpServers).toEqual([{ name: 'fs', tools: ['mcp__fs__read', 'mcp__fs__write'] }])
  })

  it('reduces the channel summary to sorted names', () => {
    const canonical = canonicalCapabilities(snapshotOf([skill('a')], [tool('b')]))
    expect(canonical.channels).toEqual(['skill', 'tool'])
  })
})

describe('hashOf', () => {
  it('is stable across registration order — same content, same digest', () => {
    const a = hashOf(snapshotOf([skill('alpha'), skill('zeta')], [tool('bash'), tool('write')]))
    const b = hashOf(snapshotOf([skill('zeta'), skill('alpha')], [tool('write'), tool('bash')]))
    expect(a).toBe(b)
  })

  it('ignores a reworded tool description — prose is not a capability', () => {
    const before = hashOf(snapshotOf([], [tool('bash', { description: 'Run a command.' })]))
    const after = hashOf(snapshotOf([], [tool('bash', { description: 'Runs a shell command in the workspace.' })]))
    expect(after).toBe(before)
  })

  it('ignores a reworded skill description and a touched mtime', () => {
    const before = hashOf(snapshotOf([skill('planning', { description: 'Plan things', updatedAt: 1 })], []))
    const after = hashOf(snapshotOf([skill('planning', { description: 'Draft an evaluation plan', updatedAt: 999 })], []))
    expect(after).toBe(before)
  })

  it('MOVES when a tool gains a parameter — the tool can now do something else', () => {
    const before = hashOf(snapshotOf([], [tool('bash', { parameters: { command: { type: 'string' } } })]))
    const after = hashOf(snapshotOf([], [tool('bash', { parameters: { command: { type: 'string' }, timeout: { type: 'number' } } })]))
    expect(after).not.toBe(before)
  })

  it('MOVES when a skill body changes — the body is the procedure', () => {
    const before = hashOf(snapshotOf([skill('planning', { bodySha: hashSkillBody('step one\n') })], []))
    const after = hashOf(snapshotOf([skill('planning', { bodySha: hashSkillBody('step one\nstep two\n') })], []))
    expect(after).not.toBe(before)
  })

  it('MOVES when a tool is added, removed, or re-attributed to another channel', () => {
    const base = snapshotOf([], [tool('bash')])
    expect(hashOf(snapshotOf([], [tool('bash'), tool('write')]))).not.toBe(hashOf(base))
    expect(hashOf(snapshotOf([], []))).not.toBe(hashOf(base))
    expect(hashOf(snapshotOf([], [tool('bash', { channel: 'plugin' })]))).not.toBe(hashOf(base))
  })

  it('ignores a `sha` already on the snapshot — hashing is idempotent', () => {
    const snapshot = snapshotOf([skill('alpha')], [tool('bash')])
    const sha = hashOf(snapshot)
    expect(hashOf({ ...snapshot, sha })).toBe(sha)
    expect(hashOf({ ...snapshot, preset: 'eval' })).toBe(sha)
  })

  it('is the sha256 of the canonical form, verbatim', () => {
    const snapshot = snapshotOf([skill('alpha')], [tool('bash')])
    const expected = createHash('sha256').update(canonicalJson(canonicalCapabilities(snapshot))).digest('hex')
    expect(hashOf(snapshot)).toBe(expected)
    expect(hashOf(snapshot)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('capsTag', () => {
  it('prefixes the digest', () => {
    expect(capsTag('abc')).toBe('caps:abc')
    expect(CAPS_TAG_PREFIX).toBe('caps:')
  })
})

describe('catalogSnapshot fingerprint mode', () => {
  const registry = {
    snapshot: async () => ({
      skills: [{
        name: 'planning',
        description: 'Draft a plan',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user-dsh',
        provider: 'filesystem',
      }],
      complete: true,
    }),
    get: async (name: string) => ({
      name,
      description: 'Draft a plan',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      provider: 'filesystem',
      content: '# planning\nstep one\n',
    }),
  }
  const schemas = [{ name: 'bash', description: 'Run', parameters: { command: { type: 'string' } } }]

  it('listing mode leaves the rows body-less and stamps no sha', async () => {
    const listing = await catalogSnapshot(undefined, registry, schemas, [], new Set())
    expect(listing.sha).toBeUndefined()
    expect(listing.skills[0]?.bodySha).toBeUndefined()
  })

  it('fingerprint mode loads the bodies and stamps the digest', async () => {
    const face = await catalogSnapshot(undefined, registry, schemas, [], new Set(), [undefined], new Map(), {
      fingerprint: true,
      preset: 'eval',
    })
    expect(face.preset).toBe('eval')
    expect(face.skills[0]?.bodySha).toBe(hashSkillBody('# planning\nstep one\n'))
    expect(face.sha).toBe(hashOf(face))
  })

  it('a skill the registry declines to load contributes no body sha, and does not throw', async () => {
    const declining = { ...registry, get: async () => { throw new Error('no body here') } }
    const face = await catalogSnapshot(undefined, declining, schemas, [], new Set(), [undefined], new Map(), { fingerprint: true })
    expect(face.skills[0]?.bodySha).toBeUndefined()
    expect(face.sha).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('resolvePresetScope — a listing degrades, a fingerprint does not', () => {
  const key = Symbol('standing-scope')
  const healthy = { defaultId: 'eval-lean', standingKeyFor: async (id?: string) => (id === 'ghost' ? undefined : key) }
  const broken = {
    defaultId: 'eval-lean',
    standingKeyFor: async (): Promise<unknown> => { throw new Error('preset "eval-lean" failed to mount: invalid config') },
  }

  it('resolves the named preset and labels the reading with it', async () => {
    expect(await resolvePresetScope(healthy, 'eval-full', true)).toEqual({ scope: key, preset: 'eval-full' })
    expect(await resolvePresetScope(healthy, undefined, true)).toEqual({ scope: key, preset: 'eval-lean' })
  })

  it('degrades a LISTING to the global layer, and labels it with NOTHING', async () => {
    // The label is the whole point: a global-layer reading carrying a preset
    // name would claim rows that do not belong to that preset.
    expect(await resolvePresetScope(broken, 'eval-lean', false)).toEqual({ scope: undefined, preset: undefined })
    expect(await resolvePresetScope(healthy, 'ghost', false)).toEqual({ scope: undefined, preset: undefined })
    expect(await resolvePresetScope(undefined, 'eval-lean', false)).toEqual({ scope: undefined, preset: undefined })
  })

  it('a FINGERPRINT throws instead, naming the preset and the reason', async () => {
    // Measured on a real sub-dsh: with this degrading, two scopes rostering
    // two different presets produced one identical hash, silently.
    await expect(resolvePresetScope(broken, 'eval-lean', true)).rejects.toThrow(/cannot fingerprint preset "eval-lean".*failed to mount/s)
    await expect(resolvePresetScope(healthy, 'ghost', true)).rejects.toThrow(/resolved no standing scope for preset "ghost"/)
    await expect(resolvePresetScope(undefined, 'eval-lean', true)).rejects.toThrow(/mounts no agent-preset roster/)
  })

  it('a rosterless composition may still be fingerprinted for its DEFAULT face', async () => {
    // There is no preset to misreport, so the global layer is the honest
    // answer — and it carries no label.
    expect(await resolvePresetScope(undefined, undefined, true)).toEqual({ scope: undefined, preset: undefined })
    expect(await resolvePresetScope({ defaultId: 'x' }, undefined, true)).toEqual({ scope: undefined, preset: undefined })
  })
})

describe('resolvePresetScope — the rc.1 leased roster face', () => {
  const key = Symbol('standing-scope')

  /** A lease as the rc.1 roster hands it out: the key, and the release on `Symbol.asyncDispose`. */
  function leaseOf(keyValue: unknown, onRelease: () => void): unknown {
    return { key: keyValue, [Symbol.asyncDispose]: async () => { onRelease() } }
  }

  it('resolves through acquireScope when standingKeyFor is absent, and labels the preset', async () => {
    let releases = 0
    const roster = { defaultId: 'eval-lean', acquireScope: async () => leaseOf(key, () => { releases += 1 }) }
    const resolved = await resolvePresetScope(roster, 'eval-full', false)
    expect(resolved.scope).toBe(key)
    expect(resolved.preset).toBe('eval-full')
    // The lease rides the result: the caller reads first, then releases ONCE.
    expect(typeof resolved.dispose).toBe('function')
    expect(releases).toBe(0)
    await resolved.dispose?.()
    expect(releases).toBe(1)
  })

  it('releases a keyless lease itself on the degrade path — no caller ever sees it', async () => {
    let releases = 0
    const roster = { acquireScope: async () => leaseOf(undefined, () => { releases += 1 }) }
    expect(await resolvePresetScope(roster, 'ghost', false)).toEqual({ scope: undefined, preset: undefined })
    expect(releases).toBe(1)
    await expect(resolvePresetScope(roster, 'ghost', true)).rejects.toThrow(/resolved no standing scope for preset "ghost"/)
    expect(releases).toBe(2)
  })

  it('a broken or unknown preset degrades a listing and refuses a fingerprint — the 0.1.5 wording', async () => {
    const invalid = {
      defaultId: 'eval-lean',
      acquireScope: async (): Promise<unknown> => { throw new Error('agent-preset/invalid: preset "eval-lean" failed to mount: invalid config') },
    }
    expect(await resolvePresetScope(invalid, 'eval-lean', false)).toEqual({ scope: undefined, preset: undefined })
    await expect(resolvePresetScope(invalid, 'eval-lean', true)).rejects.toThrow(/cannot fingerprint preset "eval-lean".*failed to mount/s)
    const missing = {
      acquireScope: async (): Promise<unknown> => { throw new Error('agent-preset/not-found: Unknown agent preset: ghost') },
    }
    expect(await resolvePresetScope(missing, 'ghost', false)).toEqual({ scope: undefined, preset: undefined })
    await expect(resolvePresetScope(missing, 'ghost', true)).rejects.toThrow(/cannot fingerprint preset "ghost".*Unknown agent preset: ghost/s)
  })

  it('prefers the lease-free 0.1.5 face when a roster offers both', async () => {
    const acquireScope = vi.fn(async () => leaseOf(key, () => {}))
    const standingKeyFor = vi.fn(async (): Promise<unknown> => key)
    const resolved = await resolvePresetScope({ standingKeyFor, acquireScope }, undefined, true)
    expect(standingKeyFor).toHaveBeenCalledOnce()
    expect(acquireScope).not.toHaveBeenCalled()
    expect(resolved).toEqual({ scope: key, preset: undefined })
  })
})
