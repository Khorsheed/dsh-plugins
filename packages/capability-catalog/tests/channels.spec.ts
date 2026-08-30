import { describe, expect, it } from 'vitest'
import { attributeToolChannel, resolveMcpServerName, skillChannelLabel, MCP_TOOL_PREFIX } from '../src/channels.ts'
import { collectCommunityToolOwners } from '../src/community-tools.ts'

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

  it('attributes a declared community tool to plugin (exact, owner)', () => {
    const community = new Map([['subagent_kimi', '@khorsheed/dsh-local-agent-tool-subagent']])
    const r = attributeToolChannel('subagent_kimi', OFFICIAL, [], false, community)
    expect(r).toMatchObject({ channel: 'plugin', confidence: 'exact', owner: '@khorsheed/dsh-local-agent-tool-subagent' })
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

describe('collectCommunityToolOwners', () => {
  it('maps @khorsheed/* tool rows to the declaring module', () => {
    const loader = {
      entries: () => ([
        { options: { name: '@khorsheed/dsh-local-agent-kimi' } },
        { options: { name: '@khorsheed/dsh-local-agent-tool-subagent', config: { provider: 'kimi-cli', toolName: 'subagent_kimi' } } },
        { options: { name: '@deepseek-ai/dsh-base-tool', config: { toolName: 'run_code' } } },
        { options: { name: '@khorsheed/dsh-local-agent-tool-subagent', config: { toolName: 'subagent_dsh' } } },
      ]),
    }
    const owners = collectCommunityToolOwners(loader as never)
    expect(owners.get('subagent_kimi')).toBe('@khorsheed/dsh-local-agent-tool-subagent')
    expect(owners.get('subagent_dsh')).toBe('@khorsheed/dsh-local-agent-tool-subagent')
    expect(owners.has('run_code')).toBe(false)  // official scope excluded
    expect(owners.has('does-not-exist')).toBe(false)
  })

  it('degrades to empty when the loader/entries seam is absent', () => {
    expect(collectCommunityToolOwners(undefined)).toEqual(new Map())
    expect(collectCommunityToolOwners({} as never)).toEqual(new Map())
  })
})
