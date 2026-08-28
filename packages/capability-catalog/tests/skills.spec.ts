import { describe, expect, it } from 'vitest'
import { decodeCredentialDecls, skillRowFrom } from '../src/skills.ts'

describe('decodeCredentialDecls', () => {
  it('returns empty for missing / non-array metadata.credentials', () => {
    expect(decodeCredentialDecls(undefined)).toEqual([])
    expect(decodeCredentialDecls({})).toEqual([])
    expect(decodeCredentialDecls({ credentials: 'nope' })).toEqual([])
  })

  it('parses a credentials declaration', () => {
    const decls = decodeCredentialDecls({ credentials: [{ key: 'wechat-reading/api-key', label: '微信读书 API Key' }] })
    expect(decls).toEqual([{ key: 'wechat-reading/api-key', label: '微信读书 API Key' }])
  })

  it('drops decls without a key', () => {
    const decls = decodeCredentialDecls({ credentials: [{ label: 'no key' }] })
    expect(decls).toEqual([])
  })
})

describe('skillRowFrom', () => {
  it('projects a summary onto a wire row preserving source/provider/invocation', () => {
    const row = skillRowFrom({
      name: 'dsh-badge',
      description: 'Add the badge',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'skill-badge',
    })
    expect(row).toMatchObject({
      name: 'dsh-badge',
      source: 'bundled',
      provider: 'skill-badge',
      modelInvocable: true,
      userInvocable: true,
    })
  })

  it('carries whenToUse when present and omits absent optional fields', () => {
    const row = skillRowFrom({
      name: 'x',
      description: 'd',
      invocation: { modelInvocable: false, userInvocable: true },
      source: 'user-agents',
      provider: 'filesystem',
      whenToUse: 'when x',
    })
    expect(row.whenToUse).toBe('when x')
    expect(row.modelInvocable).toBe(false)
    expect('path' in row).toBe(false)
    expect('rank' in row).toBe(false)
  })
})
