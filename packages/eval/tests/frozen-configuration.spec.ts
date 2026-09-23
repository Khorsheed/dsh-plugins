import { describe, expect, it } from 'vitest'
import { declaredEffort, effortEvidence, frozenConfigurationOptions, parseEffortEvidence, requireEffortAdmission } from '../src/frozen-configuration.ts'
import type { DelegationConfiguration, LocalAgentFace } from '../src/faces.ts'
import { hashConditionDocument } from '../src/hash.ts'

const admitted: DelegationConfiguration = { revision: 4, selection: { model: { mode: 'inherit' }, effort: { mode: 'inherit' } }, resolved: { effort: 'high' } }
describe('frozen configuration', () => {
  it('does not reinterpret or rewrite the legacy default declaration/hash', () => {
    const document = { schema: 'dataseek.condition/1', reasoning: { effort: 'default' } }
    const hash = hashConditionDocument(document)
    expect(declaredEffort(document)).toBe('default')
    expect(frozenConfigurationOptions(hash, 'default')).toEqual({ configurationLock: `Frozen evaluation condition ${hash}` })
    expect(hashConditionDocument(document)).toBe(hash)
    expect(hashConditionDocument({ ...document, reasoning: { effort: 'high' } })).not.toBe(hash)
  })
  it('refuses explicit effort with a legacy facade instead of silently dropping it', () => {
    expect(() => requireEffortAdmission({} as LocalAgentFace, 'native', 'high')).toThrow('no generation was started')
    expect(() => requireEffortAdmission({} as LocalAgentFace, 'native', 'default')).not.toThrow()
  })
  it('records missing native evidence without filling it from the admission snapshot', () => {
    expect(effortEvidence('high', admitted, undefined)).toMatchObject({ requested: 'high', resolved: 'high', observed: null, status: 'unverified', revision: 4 })
  })
  it('rejects both a mismatched admitted effort and a mismatched native observation', () => {
    expect(effortEvidence('low', admitted, 'low').status).toBe('mismatch')
    expect(effortEvidence('high', admitted, 'low').status).toBe('mismatch')
    expect(effortEvidence('high', admitted, 'high').status).toBe('verified')
  })
  it('does not trust a forged verified status in an imported annotation', () => {
    expect(parseEffortEvidence({ declared: 'high', resolved: 'high', observed: 'low', revision: 4, status: 'verified' })?.status).toBe('mismatch')
    expect(parseEffortEvidence(undefined)).toBeUndefined()
  })
})
