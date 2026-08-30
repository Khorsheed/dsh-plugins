import { describe, expect, it } from 'vitest'
import { attributeToolChannel, resolveMcpServerName, skillChannelLabel, MCP_TOOL_PREFIX } from '../src/channels.ts'
import { setToolOrigin, toolOrigin, isValidOrigin, TOOL_ORIGIN } from '../src/tool-origin.ts'

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

  it('honors an author-declared origin tag over the heuristics', () => {
    const origins = new Map([['subagent_kimi', { channel: 'plugin' as const, owner: '@khorsheed/dsh-local-agent-dsh' }]])
    const r = attributeToolChannel('subagent_kimi', OFFICIAL, [], false, origins)
    expect(r).toMatchObject({ channel: 'plugin', confidence: 'exact', owner: '@khorsheed/dsh-local-agent-dsh' })
  })

  it('keeps the official `subagent` tool (no tag) out of the plugin channel', () => {
    const r = attributeToolChannel('subagent', OFFICIAL, [], false)
    expect(r.channel).not.toBe('plugin')
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

describe('tool origin tag', () => {
  it('setToolOrigin/toolOrigin round-trip via the global symbol', () => {
    const def = setToolOrigin({ name: 'subagent_dsh' }, { channel: 'plugin', owner: '@khorsheed/dsh-local-agent-dsh' })
    expect(toolOrigin(def)).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-local-agent-dsh' })
    expect(def[TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-local-agent-dsh' })
    // an untagged definition reads undefined
    expect(toolOrigin({ name: 'bash' })).toBeUndefined()
  })

  it('attributes a tagged worktrees tool to plugin (the admin-reported case)', () => {
    const origins = new Map([['worktrees', { channel: 'plugin' as const, owner: '@khorsheed/dsh-worktrees' }]])
    const r = attributeToolChannel('worktrees', OFFICIAL, [], false, origins)
    expect(r).toMatchObject({ channel: 'plugin', confidence: 'exact', owner: '@khorsheed/dsh-worktrees' })
    // An untagged worktrees falls back to baseline-inferred builtin, never "neither"/unknown.
    const untagged = attributeToolChannel('worktrees', OFFICIAL, [], false)
    expect(['builtin', 'plugin']).toContain(untagged.channel)
  })
})

describe('isValidOrigin', () => {
  it('accepts known channels and rejects anything else', () => {
    expect(isValidOrigin({ channel: 'plugin' })).toBe(true)
    expect(isValidOrigin({ channel: 'builtin' })).toBe(true)
    expect(isValidOrigin({ channel: 'mcp' })).toBe(true)
    expect(isValidOrigin({ channel: 'whatever' as never })).toBe(false)
  })
})
