import { describe, expect, it } from 'vitest'
import { publicToolName, desiredMcpTools, mcpToolDefinition, extractText, reconcileRegisteredMcpTools } from '../src/mcpTools.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

describe('publicToolName', () => {
  it('keeps the clean mcp__server__tool form verbatim', () => {
    expect(publicToolName('everything', 'echo')).toBe('mcp__everything__echo')
  })
  it('normalizes invalid function-name chars and appends a collision hash', () => {
    expect(publicToolName('my server', 'a.b')).toMatch(/^mcp__my_server__a_b_[0-9a-f]{12}$/)
  })
  it('caps a very long name and keeps it <= 64 chars', () => {
    const name = publicToolName('s', 'x'.repeat(100))
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name.startsWith('mcp__s__')).toBe(true)
  })
})

describe('desiredMcpTools', () => {
  it('only includes enabled servers and enabled tools', () => {
    const desired = desiredMcpTools(
      [
        { serverName: 'on', enabled: true },
        { serverName: 'off', enabled: false },
      ],
      {
        on: [
          { name: 'a', description: 'a', enabled: true },
          { name: 'b', description: 'b', enabled: false },
        ],
        off: [{ name: 'c', description: 'c', enabled: true }],
      },
    )
    expect(desired.map(d => d.rawName)).toEqual(['a'])
    expect(desired[0]?.publicName).toBe('mcp__on__a')
  })
})

describe('mcpToolDefinition.execute', () => {
  it('forwards args and maps the MCP result to the canonical shape', async () => {
    let captured: unknown
    const def = mcpToolDefinition({
      publicName: 'mcp__s__t',
      serverName: 's',
      rawName: 't',
      description: 'a tool',
      parameters: { type: 'object', properties: { x: { type: 'string' } } },
      callTool: async (_s, _r, args) => { captured = args; return { content: [{ type: 'text', text: 'hi' }], structuredContent: { x: 1 } } },
    })
    const value = await def.execute({ x: 'y' }, {} as never)
    expect(captured).toEqual({ x: 'y' })
    expect(value).toEqual({ content: [{ type: 'text', text: 'hi' }], structuredContent: { x: 1 } })
    expect(def.name).toBe('mcp__s__t')
  })

  it('throws when the MCP result is an error', async () => {
    const def = mcpToolDefinition({
      publicName: 'mcp__s__t',
      serverName: 's',
      rawName: 't',
      description: '',
      parameters: undefined,
      callTool: async () => ({ content: [], isError: true, error: 'boom' }),
    })
    await expect(def.execute({}, {} as never)).rejects.toThrow(/boom/)
  })
})

describe('extractText', () => {
  it('joins text blocks', () => {
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'image', data: 'x' }])).toBe('a\nb')
  })
  it('falls back to JSON for non-text content', () => {
    expect(extractText([{ type: 'image', data: 'x' }])).toContain('image')
  })
  it('handles undefined', () => {
    expect(extractText(undefined)).toBe('[]')
  })
})

describe('reconcileRegisteredMcpTools', () => {
  it('registers the desired set and disposes stale ones', () => {
    const registered: string[] = []
    const disposed: string[] = []
    const disposer = (name: string) => () => { disposed.push(name) }
    const registry = { register: (def: ToolDefinition) => { registered.push(def.name); return disposer(def.name) } }
    const current = new Map<string, () => void>([['mcp__old__x', disposer('mcp__old__x')]])

    reconcileRegisteredMcpTools(
      [{ publicName: 'mcp__new__y', serverName: 'new', rawName: 'y', description: '', parameters: undefined }],
      registry,
      current,
      async () => ({ content: [] }),
    )
    expect(disposed).toEqual(['mcp__old__x'])
    expect(registered).toEqual(['mcp__new__y'])
    expect(current.has('mcp__new__y')).toBe(true)
    expect(current.has('mcp__old__x')).toBe(false)
  })

  it('contains a failing registration without throwing', () => {
    const registry = {
      register: () => { throw new Error('bad schema') },
      onRegisterError: (err: unknown) => { expect(String(err)).toContain('bad schema') },
    }
    const current = new Map<string, () => void>()
    expect(() => reconcileRegisteredMcpTools(
      [{ publicName: 'mcp__s__t', serverName: 's', rawName: 't', description: '', parameters: undefined }],
      registry,
      current,
      async () => ({ content: [] }),
    )).not.toThrow()
    expect(current.size).toBe(0)
  })
})
