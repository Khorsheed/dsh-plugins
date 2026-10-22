import { describe, expect, it } from 'vitest'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../src/log-lane.ts'
import { InspectorStore } from '../src/store.ts'
import { splitRequest } from '../src/segmenter.ts'
import { duplicateStats } from '../src/client/aggregate.ts'
import type { CapturedMessage } from '../src/messages.ts'

const message = (id: string, text: string): CapturedMessage => ({ id, role: 'user', sourceKind: 'user', content: [{ type: 'text', text }] })
const user = (seq: number, id: string, text: string, op: SessionLogRow['surfaceOp'] = 'append'): SessionLogRow => ({ type: 'user/message', seq, time: seq * 100, surfaceOp: op, data: { ...message(id, text), source: { kind: 'user' } } })
const answer = (seq: number): SessionLogRow => ({ type: 'assistant/message', seq, time: seq * 100, surfaceOp: 'append', data: { turn: 1, message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } })
const items = (r: ReturnType<typeof foldLogRows>[number]) => [...r.segments.system, ...r.segments.history, ...r.segments.added].sort((a,b) => a.index-b.index)

function compressionLog(): SessionLogRow[] {
  return [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
    user(1, 'old-a', 'A'.repeat(20683)), user(2, 'old-b', 'B'.repeat(390)), user(3, 'tail', 'retained tail'), answer(4),
    { type: 'compaction/start', seq: 5, time: 500, data: { turn: 1, compactionId: 'c1' } },
    { type: 'compaction/summary', seq: 6, time: 600, data: { compactionId: 'c1', shadowedSeqs: [1,2], summary: [{ type: 'text', text: 'summary' }], provider: 'test', model: 'small', llmStreamCall: true, usage: { inputTokens: 50, outputTokens: 10 } } },
    { ...user(7, 'checkpoint', 'summary', { op: 'replace', startSeq: 1, endSeq: 2 }), data: { ...message('checkpoint', 'summary'), source: { kind: 'compact-checkpoint', compactionId: 'c1' } } },
    { type: 'compaction/end', seq: 8, time: 800, data: { compactionId: 'c1' } },
    user(9, 'new-a', 'A'.repeat(20683)), user(10, 'new-b', 'B'.repeat(390)), answer(11),
    { type: 'turn/end', seq: 12, time: 1200, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('surface reconstruction and compression', () => {
  it('removes shadowed copies, preserves earlier snapshots, and restores a separate auxiliary call', () => {
    const requests = foldLogRows(openCursor(), compressionLog())
    expect(requests).toHaveLength(3)
    const [before, compression, after] = requests
    expect(items(before!).map(x=>x.messageId)).toEqual(['old-a','old-b','tail'])
    expect(compression).toMatchObject({ purpose: 'compaction', config: { model: 'small' }, compaction: { id: 'c1', applied: true, hostTurn: 1, replacedCount: 2, replacedChars: 21073, inputPartial: true } })
    expect(compression?.requestNumber).toBeUndefined()
    expect(compression?.response?.text).toBe('summary')
    expect(after?.requestNumber).toBe(2)
    expect(items(after!).map(x=>x.messageId)).toEqual(['checkpoint','tail','a4','new-a','new-b'])
    expect(after?.segments.history.map(x=>x.messageId)).toEqual(['tail'])
    expect(after?.segments.added[0]).toMatchObject({ category: 'compaction', compactionId: 'c1' })
    expect(duplicateStats(items(after!)).extraChars).toBe(0)
  })

  it('does not claim a replacement or a model call without their durable evidence', () => {
    const rows = compressionLog().slice(0,7)
    const requests = foldLogRows(openCursor(), rows)
    expect(requests[1]?.compaction?.applied).toBe(false)
    const summary = rows[6]!
    summary.data = { ...(summary.data as object), llmStreamCall: undefined, usage: undefined }
    expect(foldLogRows(openCursor(), rows)).toHaveLength(1)
  })

  it('resumes replacements across batches and uses surface positions, not numeric seq ranges', () => {
    const cursor = openCursor()
    foldLogRows(cursor, [user(0,'a','a'),user(1,'b','b'),user(2,'c','c'),user(3,'d','d')])
    foldLogRows(cursor, [user(4,'x','x',{op:'replace',startSeq:1,endSeq:2})])
    const result = foldLogRows(cursor,[user(5,'y','y',{op:'replace',startSeq:4,endSeq:3}),answer(6)])
    expect(items(result[0]!).map(x=>x.messageId)).toEqual(['a','y'])
    expect(()=>foldLogRows(cursor,[user(7,'invalid','bad',{op:'replace',startSeq:1,endSeq:3})])).toThrow('Invalid context surface')
  })

  it('rewrites system prompts and keeps pruning out of the execution result', () => {
    const cursor = openCursor()
    const tool = (seq: number, text: string, op: SessionLogRow['surfaceOp'] = 'append'): SessionLogRow => ({ type: 'tool/result', seq, time: seq*100, surfaceOp: op, data: { message: { id: 'result', role: 'tool', toolCallId: 'call', content: [{type:'text',text}] } } })
    const response = answer(1)
    response.data = {message: {id:'call-message',role:'assistant',content:[{type:'tool-call',id:'call',name:'read',arguments:'{}'}]}}
    const requests = foldLogRows(cursor,[
      {type:'system/message',seq:0,surfaceOp:'append',data:{message:{role:'system',content:[{type:'text',text:'old prompt'}]}}},response,
      {type:'tool/call',seq:2,time:200,data:{callId:'call',name:'read'}}, tool(3,'X'.repeat(500)),answer(4),
      {type:'compaction/prune',seq:5,data:{shadowedSeqs:[3]}},tool(6,'short',{op:'replace',startSeq:3,endSeq:3}),
      {type:'system/message',seq:7,surfaceOp:{op:'replace',startSeq:0,endSeq:0},data:{message:{role:'system',content:[{type:'text',text:'new prompt'}]}}},answer(8),
    ])
    expect(requests[0]?.execs[0]?.result).toBe('X'.repeat(500))
    expect(requests.at(-1)?.segments.system.map(x=>x.full)).toEqual(['new prompt'])
    expect(items(requests.at(-1)!).filter(x=>x.category==='tool-result')).toMatchObject([{full:'short',pruning:{beforeChars:500,afterChars:5},freshness:'new'}])
  })

  it('links recovered checkpoints to the auxiliary call and its retained pre-compaction request', () => {
    const store = new InspectorStore()
    const turns = reconstructSession(compressionLog())
    store.insertLogTurns('s',turns)
    const list = store.listTurns('s').turns
    // The compaction is a view inside turn 1, not a turn of its own.
    expect(list.map(x=>x.hostTurn)).toEqual([1])
    const main = store.getTurn('s',1)!
    expect(main.scopes.map(x=>x.kind)).toEqual(['main','compaction'])
    const last = main.scopes[0]!.requests.at(-1)!
    const detail = store.getRequest('s',last.seq)!
    if ('refused' in detail) throw Error('unexpected refusal')
    const link = detail.segments.added.find(x=>x.category==='compaction')!.compactionRequest!
    const auxiliary = store.getRequest('s',link.seq)!
    if ('refused' in auxiliary) throw Error('unexpected refusal')
    expect(auxiliary.compaction?.before?.requestNumber).toBe(1)
    expect(store.insertLogTurns('s',turns)).toBe(0)
  })

  it('recognizes a preserved id whose content was pruned and does not mark the retained tail new', () => {
    const original = {...message('tool','long body'),role:'tool' as const,toolCallId:'call'}
    const tail = message('tail','keep')
    const first = splitRequest({messages:[original,tail],context:{assemblies:[]}})
    const next = splitRequest({messages:[{...original,content:[{type:'text',text:'short'}]},tail],context:{assemblies:[],previous:first.fingerprint}})
    expect(next.added.map(x=>x.messageId)).toEqual(['tool'])
    expect(next.history.map(x=>x.messageId)).toEqual(['tail'])
    const repeated = splitRequest({messages:[tail,tail],context:{assemblies:[],previous:{messageKeys:first.fingerprint.messageKeys.slice(1),toolNames:[]}}})
    expect(repeated.history).toHaveLength(1)
    expect(repeated.added).toHaveLength(1)
  })

  it('correlates live auxiliary calls without changing main ordinals or the next history baseline', () => {
    const store = new InspectorStore()
    store.turnStart('s',1,0)
    const messages = [message('old','old content'),message('tail','keep')]
    const before = store.beginRequest({sessionId:'s',config:{},messages},10)!
    store.noteCompaction('s','compaction/start',{compactionId:'c1',turn:1})
    const auxiliary = store.beginRequest({sessionId:'s',purpose:'compaction',config:{model:'small'},messages},20)!
    store.noteCompaction('s','compaction/summary',{compactionId:'c1',shadowedSeqs:[1]})
    store.noteCompaction('s','compaction/end',{compactionId:'c1'})
    const after = store.beginRequest({sessionId:'s',config:{},messages:[{...message('summary','summary'),sourceKind:'compact-checkpoint',compactionId:'c1'},messages[1]!] },30)!
    expect(after.segments.history.map(x=>x.messageId)).toEqual(['tail'])
    const detail = store.getRequest('s',after.seq)!
    if ('refused' in detail) throw Error('unexpected refusal')
    expect(detail.segments.added[0]?.compactionRequest?.seq).toBe(auxiliary.seq)
    const aux = store.getRequest('s',auxiliary.seq)!
    if ('refused' in aux) throw Error('unexpected refusal')
    expect(aux.compaction).toMatchObject({id:'c1',replacedCount:1,before:{seq:before.seq}})
    expect(aux.compaction?.inputPartial).toBeUndefined()
  })
})
