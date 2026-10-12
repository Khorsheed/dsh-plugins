/**
 * Segmenter unit coverage: the ten category classifications, the
 * history/added prefix diff (id and content-hash matching), tool-definition
 * added flags, and system-prompt section attribution by content match.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyMessage,
  messageKey,
  previewMessage,
  serializeMessage,
  type CapturedMessage,
} from '../src/messages.ts'
import { contentHash, recordAssembly, splitRequest, type AssemblyRecord } from '../src/segmenter.ts'

const hash = contentHash

/** Build one normalized message; defaults to a plain user text row. */
function msg(over: Partial<CapturedMessage>): CapturedMessage {
  return {
    role: 'user',
    sourceKind: 'user',
    content: [{ type: 'text', text: '你好' }],
    ...over,
  }
}

describe('classifyMessage', () => {
  it('maps roles and producer kinds onto the ten panel categories', () => {
    expect(classifyMessage(msg({ role: 'system', sourceKind: 'system-prompt' }))).toBe('system')
    expect(classifyMessage(msg({ role: 'assistant', sourceKind: 'model' }))).toBe('assistant')
    expect(classifyMessage(msg({ role: 'tool', sourceKind: 'tool', toolCallId: 'c1' }))).toBe('tool-result')
    expect(classifyMessage(msg({ role: 'developer', sourceKind: 'tool-registry' }))).toBe('tool-change')
    expect(classifyMessage(msg({ sourceKind: 'user' }))).toBe('user')
    expect(classifyMessage(msg({ sourceKind: 'runtime-context' }))).toBe('runtime-snapshot')
    expect(classifyMessage(msg({ sourceKind: 'skill-catalog', sourceForm: 'catalog' }))).toBe('skill-injection')
    expect(classifyMessage(msg({ sourceKind: 'skill-invocation', sourceForm: 'instructions' }))).toBe('skill-injection')
    expect(classifyMessage(msg({ sourceKind: 'repeat-tool-reminder' }))).toBe('reminder-injection')
    expect(classifyMessage(msg({ sourceKind: 'ankh-guard' }))).toBe('plugin-injection')
  })

  it('falls back to form: snapshot for producers the explicit map predates', () => {
    expect(classifyMessage(msg({ sourceKind: 'some-future-producer', sourceForm: 'snapshot' }))).toBe('runtime-snapshot')
    expect(classifyMessage(msg({ sourceKind: 'some-future-producer' }))).toBe('plugin-injection')
  })
})

describe('serializeMessage / previewMessage', () => {
  it('serializes assistant rows to the JSON {reasoning,text,calls} form', () => {
    const assistant = msg({
      role: 'assistant',
      sourceKind: 'model',
      content: [
        { type: 'reasoning', text: '先想一下' },
        { type: 'text', text: '结论' },
        { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":"/home/user/a.md"}' },
      ],
    })
    expect(JSON.parse(serializeMessage(assistant))).toEqual({
      reasoning: '先想一下',
      text: '结论',
      calls: [{ id: 'c1', name: 'read', arguments: '{"file_path":"/home/user/a.md"}' }],
    })
    expect(previewMessage(assistant)).toBe('→ read')
  })

  it('serializes plain roles to joined text with file/image placeholders', () => {
    expect(serializeMessage(msg({
      content: [
        { type: 'text', text: '第一行' },
        { type: 'file', ref: 'notes.md' },
        { type: 'image' },
      ],
    }))).toBe('第一行\n[file: notes.md]\n[image]')
  })

  it('previews developer tool changes as +/- tool names', () => {
    expect(previewMessage(msg({
      role: 'developer',
      sourceKind: 'tool-registry',
      content: [
        { type: 'tool-addition', toolName: 'bash' },
        { type: 'tool-removal', toolName: 'write' },
      ],
    }))).toBe('tools +bash -write')
  })
})

describe('messageKey', () => {
  it('prefers the durable id and falls back to the content hash', () => {
    expect(messageKey(msg({ id: 'm1' }), hash)).toBe('id:m1')
    const a = messageKey(msg({ content: [{ type: 'text', text: 'a' }] }), hash)
    const b = messageKey(msg({ content: [{ type: 'text', text: 'a' }] }), hash)
    const c = messageKey(msg({ content: [{ type: 'text', text: 'b' }] }), hash)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('splitRequest history/added diff', () => {
  const sys = msg({ id: 'sys0', role: 'system', sourceKind: 'system-prompt', content: [{ type: 'text', text: '你是助手' }] })
  const u1 = msg({ id: 'u1', content: [{ type: 'text', text: '第一章写完' }] })
  const a1 = msg({ id: 'a1', role: 'assistant', sourceKind: 'model', content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }] })
  const t1 = msg({ id: 't1', role: 'tool', sourceKind: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '文件内容' }] })
  const u2 = msg({ id: 'u2', content: [{ type: 'text', text: '继续' }] })

  it('marks everything new on a scope’s first request', () => {
    const result = splitRequest({ messages: [sys, u1], context: { assemblies: [] } })
    expect(result.history).toEqual([])
    expect(result.added.map(item => item.category)).toEqual(['user'])
    expect(result.system).toHaveLength(1)
    expect(result.system[0]?.freshness).toBe('new')
    expect(result.fingerprint.messageKeys).toHaveLength(2)
  })

  it('splits the prefix into history and the rest into added (response + tool result + new input)', () => {
    const first = splitRequest({ messages: [sys, u1], context: { assemblies: [] } })
    const second = splitRequest({
      messages: [sys, u1, a1, t1, u2],
      context: { assemblies: [], previous: first.fingerprint },
    })
    expect(second.history.map(item => item.index)).toEqual([1])
    expect(second.added.map(item => item.category)).toEqual(['assistant', 'tool-result', 'user'])
    expect(second.added[0]?.toolCalls).toEqual(['read'])
    expect(second.system[0]?.freshness).toBe('history')
  })

  it('treats a rewritten prefix (compaction) as fully new', () => {
    const first = splitRequest({ messages: [sys, u1], context: { assemblies: [] } })
    const compacted = msg({ id: 'sys1', role: 'system', sourceKind: 'system-prompt', content: [{ type: 'text', text: '压缩后' }] })
    const second = splitRequest({
      messages: [compacted, u2],
      context: { assemblies: [], previous: first.fingerprint },
    })
    expect(second.history).toEqual([])
    expect(second.added.map(item => item.index)).toEqual([1])
    expect(second.system[0]?.freshness).toBe('new')
  })

  it('matches id-less messages by content hash', () => {
    const looseA = msg({ content: [{ type: 'text', text: '同一个标题请求' }] })
    const first = splitRequest({ messages: [looseA], context: { assemblies: [] } })
    const second = splitRequest({
      messages: [msg({ content: [{ type: 'text', text: '同一个标题请求' }] }), msg({ content: [{ type: 'text', text: '下一条' }] })],
      context: { assemblies: [], previous: first.fingerprint },
    })
    expect(second.history).toHaveLength(1)
    expect(second.added).toHaveLength(1)
  })

  it('labels tool results with the resolved tool name', () => {
    const result = splitRequest({
      messages: [t1],
      context: { assemblies: [], resolveToolName: () => 'read' },
    })
    expect(result.added[0]?.source).toBe('read')
  })
})

describe('splitRequest tools segment', () => {
  const tools = [
    { name: 'read', description: '读文件', parameters: { type: 'object' } },
    { name: 'write', description: '写文件', parameters: { type: 'object', properties: {} } },
  ]

  it('marks every definition added on the first request, then only the newcomers', () => {
    const first = splitRequest({ messages: [], tools, context: { assemblies: [] } })
    expect(first.tools.map(tool => tool.added)).toEqual([true, true])
    const second = splitRequest({
      messages: [],
      tools: [...tools, { name: 'bash', description: '跑命令', parameters: { type: 'object' } }],
      context: { assemblies: [], previous: first.fingerprint },
    })
    expect(second.tools.map(tool => tool.added)).toEqual([false, false, true])
  })
})

describe('system section attribution', () => {
  const ring: AssemblyRecord[] = []

  it('splits a system message into the assembly’s named sections on an exact content match', () => {
    recordAssembly(ring, {
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'tool:read', text: '读文件工具在 {{cwd}} 下工作' },
      ],
      variables: { cwd: '/home/user/work' },
    }, 1000)
    const text = 'You are an AI agent powered by DeepSeek Harness.\n\n读文件工具在 /home/user/work 下工作'
    const result = splitRequest({
      messages: [msg({ id: 'sys', role: 'system', sourceKind: 'system-prompt', content: [{ type: 'text', text }] })],
      context: { assemblies: ring },
    })
    expect(result.system.map(item => item.source)).toEqual(['harness:identity', 'tool:read'])
    expect(result.system[1]?.full).toBe('读文件工具在 /home/user/work 下工作')
  })

  it('keeps one unattributed row when no assembly matches', () => {
    const result = splitRequest({
      messages: [msg({ id: 'sys', role: 'system', sourceKind: 'system-prompt', content: [{ type: 'text', text: '别处来的提示词' }] })],
      context: { assemblies: ring },
    })
    expect(result.system).toHaveLength(1)
    expect(result.system[0]?.source).toBe('system-prompt')
  })

  it('carries the one-shot system slot at index -1 with cross-request freshness', () => {
    const first = splitRequest({ messages: [], systemSlot: '起个标题', context: { assemblies: [] } })
    expect(first.system[0]?.index).toBe(-1)
    expect(first.system[0]?.freshness).toBe('new')
    const second = splitRequest({
      messages: [],
      systemSlot: '起个标题',
      context: { assemblies: [], previous: first.fingerprint },
    })
    expect(second.system[0]?.freshness).toBe('history')
  })
})
