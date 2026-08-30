import { describe, expect, it } from 'vitest'
import { attributeToolChannel, resolveMcpServerName, skillChannelLabel, MCP_TOOL_PREFIX } from '../src/channels.ts'

const OFFICIAL = new Set(['bash', 'write', 'edit', 'read', 'glob', 'web_search'])

describe('attributeToolChannel', () => {
  it('attributes mcp__ prefix tools to mcp channel with serverName', () => {
    const r = attributeToolChannel('mcp__memory__search', OFFICIAL, ['memory'], false)
    expect(r.channel).toBe('mcp')
    expect(r.confidence).toBe('exact')
    expect(r.serverName).toBe('memory')
  })

  it('attributes whitelist hits to builtin (exact)', () => {
    const r = attributeToolChannel('bash', OFFICIAL, [], false)
    expect(r).toMatchObject({ channel: 'builtin', confidence: 'exact' })
  })

  it('attributes self-registered tool to plugin (exact)', () => {
    const r = attributeToolChannel('list_capabilities', OFFICIAL, [], false)
    expect(r).toMatchObject({ channel: 'plugin', confidence: 'exact' })
  })

  it('attributes baseline-but-unknown to builtin? (inferred)', () => {
    const r = attributeToolChannel('session_search', OFFICIAL, [], false)
    expect(r).toMatchObject({ channel: 'builtin', confidence: 'inferred' })
  })

  it('attributes post-apply unknown to plugin (inferred)', () => {
    const r = attributeToolChannel('mystery_tool', OFFICIAL, [], true)
    expect(r).toMatchObject({ channel: 'plugin', confidence: 'inferred' })
  })

  it('resolves longest-match serverName for underscore charset', () => {
    expect(resolveMcpServerName('mcp__a__b__query', ['a', 'a__b'])).toBe('a__b')
    expect(resolveMcpServerName('mcp__a__b__query', ['a'])).toBe('a')
  })

  it('falls back to first-segment serverName when no configured match', () => {
    expect(resolveMcpServerName('mcp__weird__tool', [])).toBe('weird')
  })
})

describe('skillChannelLabel', () => {
  it('maps each source bucket to a human label', () => {
    expect(skillChannelLabel('bundled')).toBe('官方 · bundled')
    expect(skillChannelLabel('runtime')).toBe('插件 · runtime')
    expect(skillChannelLabel('user-dsh')).toBe('用户 · dsh')
    expect(skillChannelLabel('unknown-thing')).toBe('unknown-thing')
  })
})
