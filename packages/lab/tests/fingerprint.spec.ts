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
    })
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
