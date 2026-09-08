import { describe, expect, it } from 'vitest'
import {
  canonicalJson, componentsFor, hashComponents, isComposite,
  normalizeCpus, normalizeMemory, parseComponents, shortFingerprint,
} from '../src/fingerprint.ts'
import type { FingerprintComponents } from '../src/types.ts'

describe('ceiling normalization', () => {
  it('reads equal CPU counts written differently as one literal', () => {
    expect(normalizeCpus('2')).toBe('2')
    expect(normalizeCpus(2)).toBe('2')
    expect(normalizeCpus('2.0')).toBe('2')
    expect(normalizeCpus('2.00')).toBe('2')
    expect(normalizeCpus(' 0.50 ')).toBe('0.5')
  })

  it('reads equal memory ceilings written in different units as one byte count', () => {
    expect(normalizeMemory('4g')).toBe('4294967296')
    expect(normalizeMemory('4G')).toBe('4294967296')
    expect(normalizeMemory('4gb')).toBe('4294967296')
    expect(normalizeMemory('4096m')).toBe('4294967296')
    expect(normalizeMemory(4_294_967_296)).toBe('4294967296')
    expect(normalizeMemory('1.5g')).toBe('1610612736')
  })

  it('refuses what it cannot normalize rather than hashing the raw literal', () => {
    expect(() => normalizeCpus('many')).toThrow(/resources\.cpus/)
    expect(() => normalizeCpus('0')).toThrow(/greater than zero/)
    expect(() => normalizeCpus('-1')).toThrow(/resources\.cpus/)
    expect(() => normalizeMemory('4 gigs')).toThrow(/resources\.memory/)
    expect(() => normalizeMemory('4tb')).toThrow(/resources\.memory/)
    expect(() => normalizeMemory('0g')).toThrow(/whole number of bytes/)
  })
})

describe('canonicalJson', () => {
  it('is insensitive to key insertion order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('preserves array order — the normalizers sorted what needed sorting', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })

  it('serializes nulls rather than dropping the key', () => {
    expect(canonicalJson({ cpus: null })).toBe('{"cpus":null}')
  })
})

describe('componentsFor', () => {
  it('holds the shape fixed whether or not anything is declared', () => {
    expect(componentsFor({ image: 'app:latest' }, 'sha256:abc')).toEqual({
      version: 1,
      image: 'sha256:abc',
      resources: { cpus: null, memory: null },
      mounts: [],
      envKeys: [],
      network: null,
      user: null,
    })
  })

  it('records the declared network and user, and defaults a mount to a bind', () => {
    const components = componentsFor({
      image: 'app:latest',
      network: 'eval-net',
      user: '1000:1000',
      mounts: [{ source: 'eval-creds-codex', target: '/creds/codex', type: 'volume' }, { source: '/h/a', target: '/input' }],
    }, 'sha256:abc')
    expect(components.network).toBe('eval-net')
    expect(components.user).toBe('1000:1000')
    expect(components.mounts).toEqual([
      { target: '/creds/codex', type: 'volume', readonly: false },
      { target: '/input', type: 'bind', readonly: false },
    ])
  })

  it('records neither the host path of a bind nor the NAME of a volume', () => {
    const components = componentsFor({
      image: 'app:latest',
      mounts: [{ source: 'eval-creds-codex', target: '/creds', type: 'volume' }],
    }, 'sha256:abc')
    // The volume name is per-cell by design (one credential volume per
    // harness); the layout is what the cells must share.
    expect(JSON.stringify(components)).not.toContain('eval-creds-codex')
  })

  it('records an unresolvable image as null rather than omitting the component', () => {
    expect(componentsFor({ image: 'app:latest' }, null).image).toBeNull()
  })

  it('sorts mounts by target and env keys by name', () => {
    const components = componentsFor({
      image: 'app:latest',
      mounts: [{ source: '/h/z', target: '/z' }, { source: '/h/a', target: '/a', readonly: true }],
      env: { ZED: '1', ALPHA: '2' },
    }, 'sha256:abc')
    expect(components.mounts.map((mount) => mount.target)).toEqual(['/a', '/z'])
    expect(components.envKeys).toEqual(['ALPHA', 'ZED'])
  })
})

describe('fingerprint strings', () => {
  const components: FingerprintComponents = {
    version: 1,
    image: 'registry/app@sha256:aaa',
    resources: { cpus: '2', memory: '4294967296' },
    mounts: [],
    envKeys: [],
    network: null,
    user: null,
  }

  it('carries the scheme so a composite is distinguishable from a legacy bare digest', () => {
    const fingerprint = hashComponents(components)
    expect(fingerprint).toMatch(/^lab-env:[0-9a-f]{64}$/)
    expect(isComposite(fingerprint)).toBe(true)
    expect(isComposite('registry/app@sha256:aaa')).toBe(false)
    expect(isComposite('sha256:localimageid')).toBe(false)
  })

  it('shortens both forms to something comparable at a glance', () => {
    expect(shortFingerprint(`lab-env:${'9f2c1a2b'}0000`)).toBe('9f2c1a2b')
    expect(shortFingerprint('registry/app@sha256:aabbccddee')).toBe('aabbccdd')
    expect(shortFingerprint('bare')).toBe('bare')
  })
})

/**
 * The values below were produced by the implementation BEFORE `network` and
 * `user` existed. They are pinned, not recomputed: a fingerprint must move
 * only when the environment it describes moves, and a spec that declared no
 * network then and declares none now is running in the same place. Recording
 * the literals is the only way a future component addition gets caught
 * shifting them.
 */
describe('a spec that declares none of a later component keeps its fingerprint', () => {
  it('holds for a bare spec', () => {
    expect(hashComponents(componentsFor({ image: 'app:latest' }, 'sha256:abc')))
      .toBe('lab-env:c2e5b51960ef4672e723887406e9ebb6c4f5704d2bb2a088f3d7c564fddc3c4b')
  })

  it('holds for a spec that declares every component the initial set had', () => {
    expect(hashComponents(componentsFor({
      image: 'app:latest',
      resources: { cpus: '2', memory: '4g' },
      mounts: [{ source: '/h/a', target: '/input', readonly: true }],
      env: { B: '2', A: '1' },
    }, 'registry/app@sha256:aaa')))
      .toBe('lab-env:982547479d11ad0035bedea93d73ba0a10a35f0fb4558aee17bb343173520664')
  })

  it('holds when the components carry the later keys explicitly as null', () => {
    // An undeclared component contributes nothing: the null keys and their
    // absence are the same environment, so they must hash the same.
    const withNulls = componentsFor({ image: 'app:latest' }, 'sha256:abc')
    const { network: _network, user: _user, ...withoutKeys } = withNulls
    expect(hashComponents(withNulls)).toBe(hashComponents(withoutKeys as FingerprintComponents))
  })

  it('but moves as soon as one of them IS declared', () => {
    const bare = hashComponents(componentsFor({ image: 'app:latest' }, 'sha256:abc'))
    const networked = hashComponents(componentsFor({ image: 'app:latest', network: 'eval-net' }, 'sha256:abc'))
    const isolated = hashComponents(componentsFor({ image: 'app:latest', network: 'none' }, 'sha256:abc'))
    const asUser = hashComponents(componentsFor({ image: 'app:latest', user: '1000:1000' }, 'sha256:abc'))
    const both = hashComponents(componentsFor({ image: 'app:latest', network: 'eval-net', user: '1000:1000' }, 'sha256:abc'))
    expect(new Set([bare, networked, isolated, asUser, both]).size).toBe(5)
  })

  it('separates a volume mount from a bind at the same target', () => {
    const bind = hashComponents(componentsFor({ image: 'app:latest', mounts: [{ source: '/h/c', target: '/creds' }] }, 'sha256:abc'))
    const volume = hashComponents(componentsFor({ image: 'app:latest', mounts: [{ source: 'vol', target: '/creds', type: 'volume' }] }, 'sha256:abc'))
    expect(bind).not.toBe(volume)
  })

  it('ignores which volume NAME backs a mount — one credential volume per harness is by design', () => {
    const codex = hashComponents(componentsFor({ image: 'app:latest', mounts: [{ source: 'eval-creds-codex', target: '/creds', type: 'volume' }] }, 'sha256:abc'))
    const claude = hashComponents(componentsFor({ image: 'app:latest', mounts: [{ source: 'eval-creds-claude', target: '/creds', type: 'volume' }] }, 'sha256:abc'))
    expect(codex).toBe(claude)
  })
})

describe('parseComponents', () => {
  it('round-trips a labeled component set', () => {
    const components = componentsFor({ image: 'app:latest', env: { A: '1' } }, 'sha256:abc')
    expect(parseComponents(JSON.stringify(components))).toEqual(components)
  })

  it('degrades to "no components" rather than crashing a reconcile', () => {
    expect(parseComponents(undefined)).toBeUndefined()
    expect(parseComponents('')).toBeUndefined()
    expect(parseComponents('{not json')).toBeUndefined()
    expect(parseComponents('{"version":"one"}')).toBeUndefined()
    expect(parseComponents('{"version":1}')).toBeUndefined()
  })
})
