/**
 * The change list between consecutive requests: replacement facts pair what
 * the host swapped (typed by the metering event before them), id-level
 * remove/add stands in when no fact exists, system rows fold into one entry
 * with a head-to-head diff, tools pair by name, and the plain tail append is
 * summarized. The fixtures mirror a real edit-then-consolidate session log.
 */
import { describe, expect, it } from 'vitest'
import { diffRequests, diffTools, replacementFactsOf, type FactLookup, type ReplacementFact, type ReplacementRow } from '../src/changes.ts'
import { InspectorStore } from '../src/store.ts'
import type { CapturedMessage } from '../src/messages.ts'
import type { SegmentItem, ToolDefItem } from '../src/types.ts'

const row = (index: number, id: string, category: SegmentItem['category'], full: string, source = category as string): SegmentItem =>
  ({ index, messageId: id, category, source, preview: full.slice(0, 40), full, chars: full.length, freshness: 'history' })
const tool = (name: string, description: string, parameters = '{}'): ToolDefItem => ({ name, description, parameters, chars: 0, added: false })

function lookup(facts: ReplacementFact[]): FactLookup {
  const byNew = new Map(facts.map(f => [f.newId, f]))
  const byOld = new Map(facts.flatMap(f => f.replacedIds.map(id => [id, f] as const)))
  return { byNewId: id => byNew.get(id), byReplacedId: id => byOld.get(id) }
}

const OLD_PROMPT = 'You are a coach. Hand payloads to the tools directly.'
const NEW_PROMPT = OLD_PROMPT + ' Quote with 「」.'

// #15: head prompt (old), turn-1 history, an in-history prompt update, the "1" exchange.
const before = [
  row(0, 'sys-head-old', 'system', OLD_PROMPT, 'system-prompt'),
  row(1, 'u1', 'user', '建一个项目'),
  row(2, 'a1', 'assistant', '好的'),
  row(3, 'sys-update', 'system', NEW_PROMPT, 'system-prompt'),
  row(4, 'u-one', 'user', '1'),
  row(5, 'a-one', 'assistant', '收到'),
]
// #16: head rewritten, update emptied (not sent), the exchange replaced by the edit, then the trigger.
const after = [
  row(0, 'sys-head-new', 'system', NEW_PROMPT, 'system-prompt'),
  row(1, 'u1', 'user', '建一个项目'),
  row(2, 'a1', 'assistant', '好的'),
  row(3, 'edit', 'plugin-injection', '我主要想结合LLM', 'message-tools'),
  row(4, 'trigger', 'plugin-injection', '(用户编辑了上一条消息)', 'message-tools'),
  row(5, 'ctx', 'runtime-snapshot', 'Current runtime context', 'runtime-context'),
]
const FACTS: ReplacementFact[] = [
  { newId: 'edit', replacedIds: ['u-one', 'a-one'], kind: 'replace', sourceKind: 'message-tools', sourceOp: 'edit', eventSeq: 146, replacedSeqs: [140, 142] },
  { newId: 'sys-emptied', replacedIds: ['sys-update'], kind: 'replace', sourceKind: 'system-prompt', eventSeq: 151, replacedSeqs: [115] },
  { newId: 'sys-head-new', replacedIds: ['sys-head-old'], kind: 'replace', sourceKind: 'system-prompt', eventSeq: 152, replacedSeqs: [8] },
]

describe('request change list', () => {
  it('pairs replacements by their facts and folds system rows into one entry', () => {
    const out = diffRequests({ rows: before, tools: [] }, { rows: after, tools: [] }, lookup(FACTS), 0)
    expect(out.changes).toHaveLength(2)
    const [system, edit] = out.changes
    expect(system).toMatchObject({ kind: 'replace', system: true, isBreak: true, text: { offset: OLD_PROMPT.length, addedChars: ' Quote with 「」.'.length, removedChars: 0 } })
    expect(system!.sameAs).toMatchObject({ index: 3, messageId: 'sys-update' })
    expect(system!.parts!.map(p => p.eventSeq).sort()).toEqual([151, 152])
    expect(edit).toMatchObject({ kind: 'replace', source: { kind: 'message-tools', op: 'edit' }, eventSeq: 146, replacedSeqs: [140, 142] })
    expect(edit!.removed.map(r => r.messageId)).toEqual(['u-one', 'a-one'])
    expect(edit!.added.map(r => r.messageId)).toEqual(['edit'])
    // The trigger and the snapshot are plain appends after the replacement.
    expect(out.tail).toEqual({ count: 2, sources: ['message-tools', 'runtime-context'] })
  })

  it('degrades to id-level remove/add without replacement facts', () => {
    const out = diffRequests({ rows: before, tools: [] }, { rows: after, tools: [] }, lookup([]), 0)
    const system = out.changes.find(c => c.system)!
    expect(system).toMatchObject({ kind: 'remove', isBreak: true })
    expect(system.removed.map(r => r.messageId)).toEqual(['sys-head-old', 'sys-update'])
    expect(system.added.map(r => r.messageId)).toEqual(['sys-head-new'])
    expect(out.changes.filter(c => !c.system).map(c => c.kind).sort()).toEqual(['add', 'remove'])
    // Trailing removals make the trailing adds a listed change, not the tail.
    expect(out.tail).toBeUndefined()
  })

  it('reports nothing but the tail for a plain append', () => {
    const next = [...before, row(6, 'a2', 'assistant', '新回复')]
    const out = diffRequests({ rows: before, tools: [] }, { rows: next, tools: [] }, lookup([]))
    expect(out.changes).toEqual([])
    expect(out.tail).toEqual({ count: 1, sources: ['assistant'] })
  })

  it('types a same-id rewrite after compaction/prune as a prune', () => {
    const prev = [row(0, 'sys', 'system', 'p'), row(1, 'r1', 'tool-result', 'head' + 'x'.repeat(50) + 'tail')]
    const cur = [row(0, 'sys', 'system', 'p'), row(1, 'r1', 'tool-result', 'head[... tool result middle pruned ...]tail')]
    const facts = replacementFactsOf([
      { type: 'tool/result', seq: 4, data: { message: { id: 'r1', role: 'tool' } }, surfaceOp: 'append' },
      { type: 'compaction/prune', seq: 9, data: {} },
      { type: 'tool/result', seq: 10, data: { message: { id: 'r1', role: 'tool' } }, surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] },
    ])
    expect(facts).toEqual([expect.objectContaining({ newId: 'r1', replacedIds: ['r1'], kind: 'prune', eventSeq: 10 })])
    const out = diffRequests({ rows: prev, tools: [] }, { rows: cur, tools: [] }, lookup(facts), 1)
    expect(out.changes).toEqual([expect.objectContaining({ kind: 'prune', isBreak: true, text: expect.objectContaining({ offset: 4 }) })])
  })

  it('types the replacement after compaction/summary as a compaction with its id', () => {
    const facts = replacementFactsOf([
      { type: 'user/message', seq: 3, data: { id: 'm3', role: 'user' }, surfaceOp: 'append' },
      { type: 'user/message', seq: 4, data: { id: 'm4', role: 'user' }, surfaceOp: 'append' },
      { type: 'compaction/summary', seq: 20, data: { compactionId: 'c1' } },
      { type: 'user/message', seq: 21, data: { id: 'ck', role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'c1' } }, surfaceOp: { op: 'replace', startSeq: 3, endSeq: 4 }, sourceEventSeqs: [3, 4] },
    ])
    expect(facts).toEqual([{ newId: 'ck', replacedIds: ['m3', 'm4'], kind: 'compaction', sourceKind: 'compact-checkpoint', eventSeq: 21, replacedSeqs: [3, 4], compactionId: 'c1' }])
  })

  it('reads the real event shapes: step events nest the message, user messages are the data', () => {
    const rows: ReplacementRow[] = [
      { type: 'system/message', seq: 8, data: { message: { id: 'h-old', role: 'system', source: { kind: 'system-prompt' } } }, surfaceOp: 'append' },
      { type: 'user/message', seq: 140, data: { id: 'u-one', role: 'user', source: { kind: 'user' } }, surfaceOp: 'append' },
      { type: 'user/message', seq: 146, data: { id: 'edit', role: 'user', source: { kind: 'message-tools', op: 'edit' } }, surfaceOp: { op: 'replace', startSeq: 140, endSeq: 140 }, sourceEventSeqs: [140] },
      { type: 'system/message', seq: 152, data: { message: { id: 'h-new', role: 'system', source: { kind: 'system-prompt' } } }, surfaceOp: { op: 'replace', startSeq: 8, endSeq: 8 }, sourceEventSeqs: [8] },
    ]
    expect(replacementFactsOf(rows).map(f => [f.newId, f.replacedIds, f.sourceKind, f.sourceOp])).toEqual([
      ['edit', ['u-one'], 'message-tools', 'edit'],
      ['h-new', ['h-old'], 'system-prompt', undefined],
    ])
  })

  it('diffs tools by name and marks the first one as the break when messages share their prefix', () => {
    expect(diffTools([tool('a', 'x'), tool('b', 'keep'), tool('gone', '')], [tool('a', 'x', '{"p":1}'), tool('b', 'keep'), tool('new', '')])).toEqual([
      expect.objectContaining({ name: 'a', change: 'modified', parameters: expect.objectContaining({ addedChars: 5 }) }),
      { name: 'new', change: 'added' },
      { name: 'gone', change: 'removed' },
    ])
    const out = diffRequests({ rows: before, tools: [tool('assess', 'judge')] }, { rows: before, tools: [tool('assess', 'judge carefully')] }, lookup([]))
    expect(out.tools).toEqual([expect.objectContaining({ name: 'assess', change: 'modified', isBreak: true, description: expect.objectContaining({ offset: 5 }) })])
  })

  it('names the assemble section holding the diff start', () => {
    const sectioned = (index: number, id: string, parts: [string, string][]) => parts.map(([source, full]) => row(index, id, 'system', full, source))
    const prev = sectioned(0, 'h1', [['identity', 'You are a coach.'], ['library', 'Use the tools.']])
    const cur = sectioned(0, 'h2', [['identity', 'You are a coach.'], ['library', 'Use the tools. Quote with 「」.']])
    const out = diffRequests({ rows: prev, tools: [] }, { rows: cur, tools: [] }, lookup([]), 0)
    expect(out.changes[0]).toMatchObject({ system: true, section: 'library', text: { offset: 'You are a coach.\n\nUse the tools.'.length } })
  })
})

describe('store: change list on the request view', () => {
  it('reads facts noted between two captured requests', () => {
    const store = new InspectorStore()
    const user = (id: string, text: string, kind = 'user'): CapturedMessage => ({ id, role: 'user', sourceKind: kind, content: [{ type: 'text', text }] })
    const system = (id: string, text: string): CapturedMessage => ({ id, role: 'system', sourceKind: 'system-prompt', content: [{ type: 'text', text }] })
    store.turnStart('s', 1, 0)
    const first = store.beginRequest({ sessionId: 's', config: {}, messages: [system('h1', OLD_PROMPT), user('u1', '1')] }, 1)!
    store.settleRequest(first, 2)
    store.noteReplacement('s', { newId: 'h2', replacedIds: ['h1'], kind: 'replace', sourceKind: 'system-prompt', eventSeq: 9 })
    store.noteReplacement('s', { newId: 'e1', replacedIds: ['u1'], kind: 'replace', sourceKind: 'message-tools', sourceOp: 'edit', eventSeq: 10 })
    const next = store.beginRequest({ sessionId: 's', config: {}, messages: [system('h2', NEW_PROMPT), user('e1', '我主要想结合LLM', 'message-tools')] }, 3)!
    store.settleRequest(next, 4)
    const view = store.getRequest('s', next.seq)
    if (view === undefined || 'refused' in view) throw new Error('missing view')
    expect(view.prefix?.changes?.map(c => [c.kind, c.system === true, c.source])).toEqual([
      ['replace', true, { kind: 'system-prompt' }],
      ['replace', false, { kind: 'message-tools', op: 'edit' }],
    ])
    expect(view.prefix?.changes?.[0]?.isBreak).toBe(true)
  })

  it('names a provider/model switch, which no cache survives', () => {
    const store = new InspectorStore()
    const msg: CapturedMessage = { id: 'u', role: 'user', sourceKind: 'user', content: [{ type: 'text', text: 'hi' }] }
    store.turnStart('s', 1, 0)
    const a = store.beginRequest({ sessionId: 's', config: { provider: 'deepseek', model: 'flash' }, messages: [msg] }, 1)!
    store.settleRequest(a, 2)
    const b = store.beginRequest({ sessionId: 's', config: { provider: 'deepseek', model: 'pro' }, messages: [msg] }, 3)!
    store.settleRequest(b, 4)
    const view = store.getRequest('s', b.seq)
    if (view === undefined || 'refused' in view) throw new Error('missing view')
    expect(view.prefix?.configChanged).toEqual({ from: 'deepseek/flash', to: 'deepseek/pro' })
  })
})
