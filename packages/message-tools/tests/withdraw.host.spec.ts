import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { planEdit, planRestore, planWithdrawal } from '../src/withdraw.ts'
import {
  EDIT_TRIGGER_NOTICE, MESSAGE_TOOLS_PLUGIN, RESTORED_ASSISTANT_NOTICE, WITHDRAWN_NOTICE,
  editReplacementSource, editTriggerSource,
  isMessageToolsEdit, isMessageToolsReplacement, isMessageToolsRestore,
  isMessageToolsRestoreAssistant, isMessageToolsTrigger, restoreAssistantSource, stripRestoreAssistantFrame,
} from '../src/marker.ts'

let seq = 0
function userMessage(text: string): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: { id: `m${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
    surfaceOp: 'append',
  }
  seq += 1
  return event as SessionEvent
}

/** An assembled assistant step on the surface. */
function assistantMessage(text: string): SessionEvent {
  const event = {
    type: 'assistant/message',
    seq,
    time: 1000,
    data: {
      turn: 0,
      step: 1,
      message: {
        id: `a${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
    },
    surfaceOp: 'append',
  }
  seq += 1
  return event as SessionEvent
}

/** An interrupted assistant stream fragment (text delta, no final message). */
function assistantChunkText(text: string): SessionEvent {
  const event = {
    type: 'assistant/chunk',
    seq,
    time: 1000,
    data: { turn: 0, step: 1, chunk: { type: 'text-delta', index: 0, text } },
  }
  seq += 1
  return event as SessionEvent
}

/** An interrupted assistant stream fragment (reasoning delta, no final message). */
function assistantChunkReasoning(text: string): SessionEvent {
  const event = {
    type: 'assistant/chunk',
    seq,
    time: 1000,
    data: { turn: 0, step: 1, chunk: { type: 'reasoning-delta', index: 0, text } },
  }
  seq += 1
  return event as SessionEvent
}

/** An interrupted assistant stream fragment (block-end replaces prior deltas). */
function assistantChunkBlockEnd(text: string): SessionEvent {
  const event = {
    type: 'assistant/chunk',
    seq,
    time: 1000,
    data: { turn: 0, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text } } },
  }
  seq += 1
  return event as SessionEvent
}

/** A tool result on the surface (never replayed by a restore). */
function toolResult(): SessionEvent {
  const event = {
    type: 'tool/result',
    seq,
    time: 1000,
    data: {
      turn: 0,
      step: 1,
      message: {
        id: `t${seq}`,
        role: 'user',
        content: [{ type: 'toolResult', callId: `c${seq}`, content: 'ok', isError: false }],
        source: { kind: 'tool', callId: `c${seq}` },
      },
    },
    surfaceOp: 'append',
  }
  seq += 1
  return event as SessionEvent
}

/** A restore replay of a user message (append, plugin, no op). */
function restoreEvent(fromSeq: number, text: string): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: `r${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN },
    },
    surfaceOp: 'append',
    sourceEventSeqs: [fromSeq],
  }
  seq += 1
  return event as SessionEvent
}

/** A restore replay of assistant text (append, plugin, op 'restore-assistant'). */
function restoreAssistantEvent(fromSeq: number, text: string): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: `ra${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: restoreAssistantSource(),
    },
    surfaceOp: 'append',
    sourceEventSeqs: [fromSeq],
  }
  seq += 1
  return event as SessionEvent
}

/** An edit trigger wake message (append, plugin, op 'edit-trigger'). */
function editTriggerEvent(): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: `tr${seq}`,
      role: 'user',
      content: [{ type: 'text', text: EDIT_TRIGGER_NOTICE }],
      source: editTriggerSource(),
    },
    surfaceOp: 'append',
  }
  seq += 1
  return event as SessionEvent
}

/** Log-only filler: a turn boundary never sits on the surface. */
function turnStart(turn: number): SessionEvent {
  const event = { type: 'turn/start', seq, time: 1000, data: { turn } }
  seq += 1
  return event as SessionEvent
}

function withdrawalReplacement(start: number, end: number, sources: readonly number[]): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: `m${seq}`,
      role: 'user',
      content: [{ type: 'text', text: WITHDRAWN_NOTICE }],
      source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN },
    },
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [...sources],
  }
  seq += 1
  return event as SessionEvent
}

function editReplacement(start: number, end: number, sources: readonly number[], text: string): SessionEvent {
  const event = {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: `e${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: editReplacementSource(),
    },
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [...sources],
  }
  seq += 1
  return event as SessionEvent
}

function reset(): void {
  seq = 0
}

describe('planWithdrawal', () => {
  it('plans the span from the target to the surface tail', () => {
    reset()
    const events = [userMessage('first'), turnStart(0), userMessage('second'), userMessage('third')]
    const result = planWithdrawal(events, [0, 2, 3], 2)
    expect(result).toEqual({ ok: true, plan: { start: 2, end: 3, sourceEventSeqs: [2, 3] } })
  })

  it('covers the whole surface when the first message is withdrawn', () => {
    reset()
    const events = [userMessage('first'), turnStart(0), userMessage('second')]
    const result = planWithdrawal(events, [0, 2], 0)
    expect(result).toEqual({ ok: true, plan: { start: 0, end: 2, sourceEventSeqs: [0, 2] } })
  })

  it('rejects a target absent from the log', () => {
    reset()
    expect(planWithdrawal([userMessage('first')], [0], 9)).toEqual({ ok: false, code: 'target-not-found' })
  })

  it('rejects a log-only event as target', () => {
    reset()
    const events = [userMessage('first'), turnStart(0)]
    expect(planWithdrawal(events, [0], 1)).toEqual({ ok: false, code: 'not-a-user-message' })
  })

  it('rejects a replacement event as target', () => {
    reset()
    const events = [userMessage('first'), withdrawalReplacement(0, 0, [0])]
    expect(planWithdrawal(events, [1], 1)).toEqual({ ok: false, code: 'not-a-user-message' })
  })

  it('rejects a message already shadowed off the surface', () => {
    reset()
    const events = [userMessage('first'), userMessage('second'), withdrawalReplacement(0, 1, [0, 1])]
    expect(planWithdrawal(events, [2], 0)).toEqual({ ok: false, code: 'already-withdrawn' })
  })

  it('accepts a restore row as target (re-withdrawing a restored message)', () => {
    reset()
    const events = [
      userMessage('first'), withdrawalReplacement(0, 0, [0]), restoreEvent(0, 'first'), userMessage('after'),
    ]
    const result = planWithdrawal(events, [1, 2, 3], 2)
    expect(result).toEqual({ ok: true, plan: { start: 2, end: 3, sourceEventSeqs: [2, 3] } })
  })

  it('accepts an edit replacement as target (withdrawing an edited bubble)', () => {
    reset()
    const events = [userMessage('first'), editReplacement(0, 0, [0], 'first-edited'), assistantMessage('答')]
    const result = planWithdrawal(events, [1, 2], 1)
    expect(result).toEqual({ ok: true, plan: { start: 1, end: 2, sourceEventSeqs: [1, 2] } })
  })

  it('rejects a restore-assistant row as target (it carries no actions)', () => {
    reset()
    const events = [userMessage('first'), withdrawalReplacement(0, 0, [0]), restoreAssistantEvent(0, '答')]
    expect(planWithdrawal(events, [1, 2], 2)).toEqual({ ok: false, code: 'not-a-user-message' })
  })
})

describe('isMessageToolsReplacement', () => {
  it('matches a plugin-tagged user/message replacement', () => {
    reset()
    const event = withdrawalReplacement(2, 5, [2, 3, 4, 5])
    expect(isMessageToolsReplacement(event)).toBe(true)
    if (isMessageToolsReplacement(event)) expect(event.surfaceOp.start).toBe(2)
  })

  it('rejects append-surface user messages', () => {
    reset()
    expect(isMessageToolsReplacement(userMessage('first'))).toBe(false)
  })

  it('rejects replacements from other plugins', () => {
    reset()
    const event = withdrawalReplacement(0, 1, [0, 1])
    const compact = {
      ...event,
      data: { ...event.data as object, source: { kind: 'plugin', plugin: 'compact' } },
    } as SessionEvent
    expect(isMessageToolsReplacement(compact)).toBe(false)
  })
})

describe('planRestore', () => {
  it('replays only the target when no message-tools replacement cites it (foreign shadowing)', () => {
    reset()
    // 'first' left the surface through another producer (e.g. compaction): the
    // span boundary is never re-guessed, so only the target itself replays.
    const events = [userMessage('first'), userMessage('second')]
    const result = planRestore(events, [1], 0)
    expect(result).toEqual({
      ok: true,
      plan: { entries: [{ role: 'user', content: [{ type: 'text', text: 'first' }], sourceSeq: 0 }] },
    })
  })

  it('replays every user message of a cited span', () => {
    reset()
    const events = [userMessage('first'), userMessage('second'), withdrawalReplacement(0, 1, [0, 1])]
    const result = planRestore(events, [2], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: 'first' }], sourceSeq: 0 },
          { role: 'user', content: [{ type: 'text', text: 'second' }], sourceSeq: 1 },
        ],
      },
    })
  })

  it('replays the whole withdrawn span in original order, framing assistant text', () => {
    reset()
    const events = [
      userMessage('问一'), assistantMessage('答一'), userMessage('问二'), assistantMessage('答二'),
      withdrawalReplacement(0, 3, [0, 1, 2, 3]),
    ]
    const result = planRestore(events, [4], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问一' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答一`, sourceSeq: 1 },
          { role: 'user', content: [{ type: 'text', text: '问二' }], sourceSeq: 2 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答二`, sourceSeq: 3 },
        ],
      },
    })
  })

  it('replays interrupted assistant chunks when no assistant/message landed', () => {
    reset()
    const events = [
      userMessage('问'),                                // 0
      assistantChunkText('答'),                         // 1
      assistantChunkText('案'),                         // 2
      withdrawalReplacement(0, 0, [0]),                 // 3 (surface span omits chunks)
    ]
    const result = planRestore(events, [3], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答案`, sourceSeq: 1 },
        ],
      },
    })
  })

  it('preserves reasoning-only interrupted assistant content', () => {
    reset()
    const events = [
      userMessage('问'),                                // 0
      assistantChunkReasoning('思考中'),                 // 1
      withdrawalReplacement(0, 0, [0]),                 // 2 (surface span omits chunks)
    ]
    const result = planRestore(events, [2], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n思考中`, sourceSeq: 1 },
        ],
      },
    })
  })

  it('does not duplicate chunks that belong to a finalized assistant message', () => {
    reset()
    const events = [
      userMessage('问'),                                // 0
      assistantChunkText('答'),                         // 1
      assistantMessage('答案'),                          // 2
      withdrawalReplacement(0, 2, [0, 2]),              // 3
    ]
    const result = planRestore(events, [3], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答案`, sourceSeq: 2 },
        ],
      },
    })
  })

  it('keeps interrupted assistant chunks in original order between user messages', () => {
    reset()
    const events = [
      userMessage('问一'),                                // 0
      assistantChunkText('答一'),                         // 1
      userMessage('问二'),                                // 2
      assistantChunkText('答二'),                         // 3
      withdrawalReplacement(0, 2, [0, 2]),                // 4
    ]
    const result = planRestore(events, [4], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问一' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答一`, sourceSeq: 1 },
          { role: 'user', content: [{ type: 'text', text: '问二' }], sourceSeq: 2 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答二`, sourceSeq: 3 },
        ],
      },
    })
  })

  it('does not split an interrupted chunk run at log-only events', () => {
    reset()
    const events = [
      userMessage('问'),                                // 0
      assistantChunkText('答'),                         // 1
      turnStart(0),                                     // 2 log-only interleave
      assistantChunkText('案'),                         // 3
      withdrawalReplacement(0, 0, [0]),                 // 4
    ]
    const result = planRestore(events, [4], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n答案`, sourceSeq: 1 },
        ],
      },
    })
  })

  it('uses block-end as the assembled text instead of duplicating deltas', () => {
    reset()
    const events = [
      userMessage('问'),                                // 0
      assistantChunkText('partial'),                    // 1
      assistantChunkBlockEnd('final'),                  // 2
      withdrawalReplacement(0, 0, [0]),                 // 3
    ]
    const result = planRestore(events, [3], 0)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '问' }], sourceSeq: 0 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\nfinal`, sourceSeq: 1 },
        ],
      },
    })
  })

  it('replays an edit replacement as its new text, and skips triggers and tool results', () => {
    reset()
    const events = [
      userMessage('原文'), assistantMessage('旧答'),
      editReplacement(0, 1, [0, 1], '编辑后'), editTriggerEvent(), assistantMessage('新答'),
      toolResult(),
      withdrawalReplacement(2, 5, [2, 3, 4, 5]),
    ]
    // The span starts at the edit replacement: it is the restore target.
    const result = planRestore(events, [6], 2)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '编辑后' }], sourceSeq: 2 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n新答`, sourceSeq: 4 },
        ],
      },
    })
  })

  it('skips nested withdrawal placeholders, textless assistant messages, and stale seqs', () => {
    reset()
    const events = [
      userMessage('一'),                                // 0
      withdrawalReplacement(0, 0, [0]),                // 1 nested placeholder
      assistantMessage(''),                            // 2 textless
      userMessage('二'),                               // 3
      withdrawalReplacement(1, 3, [1, 2, 3, 98]),      // 4 (98: stale cited seq)
    ]
    const result = planRestore(events, [4], 3)
    expect(result).toEqual({
      ok: true,
      plan: { entries: [{ role: 'user', content: [{ type: 'text', text: '二' }], sourceSeq: 3 }] },
    })
  })

  it('re-replays earlier restore rows shadowed by a later withdrawal', () => {
    reset()
    const events = [
      userMessage('旧'), withdrawalReplacement(0, 0, [0]),
      restoreEvent(0, '旧'), restoreAssistantEvent(0, `${RESTORED_ASSISTANT_NOTICE}\n旧答`),
      userMessage('新'), withdrawalReplacement(2, 4, [2, 3, 4]),
    ]
    const result = planRestore(events, [5], 2)
    expect(result).toEqual({
      ok: true,
      plan: {
        entries: [
          { role: 'user', content: [{ type: 'text', text: '旧' }], sourceSeq: 2 },
          { role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n旧答`, sourceSeq: 3 },
          { role: 'user', content: [{ type: 'text', text: '新' }], sourceSeq: 4 },
        ],
      },
    })
  })

  it('rejects a message still on the surface (not withdrawn)', () => {
    reset()
    const events = [userMessage('first')]
    expect(planRestore(events, [0], 0)).toEqual({ ok: false, code: 'not-withdrawn' })
  })

  it('rejects a target absent from the log', () => {
    reset()
    expect(planRestore([userMessage('first')], [], 9)).toEqual({ ok: false, code: 'target-not-found' })
  })

  it('rejects a non-user event as target', () => {
    reset()
    const events = [userMessage('first'), turnStart(0)]
    expect(planRestore(events, [0], 1)).toEqual({ ok: false, code: 'not-a-user-message' })
  })

  it('rejects a withdrawal replacement and a restore-assistant row as target', () => {
    reset()
    const events = [userMessage('first'), withdrawalReplacement(0, 0, [0]), restoreAssistantEvent(0, '答')]
    expect(planRestore(events, [1], 1)).toEqual({ ok: false, code: 'not-a-user-message' })
    expect(planRestore(events, [1], 2)).toEqual({ ok: false, code: 'not-a-user-message' })
  })
})

describe('planEdit', () => {
  it('plans an in-place edit over [target..surface tail]', () => {
    reset()
    const events = [userMessage('first'), turnStart(0), userMessage('second')]
    expect(planEdit(events, [0, 2], 0, 'first-edited')).toEqual({
      ok: true,
      plan: { start: 0, end: 2, sourceEventSeqs: [0, 2] },
    })
  })

  it('accepts a previous edit replacement as target (edit chain)', () => {
    reset()
    const events = [userMessage('first'), turnStart(0), editReplacement(0, 0, [0], 'first-edited')]
    expect(planEdit(events, [2], 2, 'first-reedited')).toEqual({
      ok: true,
      plan: { start: 2, end: 2, sourceEventSeqs: [2] },
    })
  })

  it('accepts a restore row as target (editing a restored message)', () => {
    reset()
    const events = [userMessage('first'), withdrawalReplacement(0, 0, [0]), restoreEvent(0, 'first')]
    expect(planEdit(events, [1, 2], 2, 'first-edited')).toEqual({
      ok: true,
      plan: { start: 2, end: 2, sourceEventSeqs: [2] },
    })
  })

  it('rejects blank text, unknown targets, withdrawn targets, and non-user events', () => {
    reset()
    const events = [userMessage('first'), turnStart(0)]
    expect(planEdit(events, [0], 0, '  ')).toEqual({ ok: false, code: 'empty-text' })
    expect(planEdit(events, [0], 9, 'x')).toEqual({ ok: false, code: 'target-not-found' })
    expect(planEdit(events, [0], 1, 'x')).toEqual({ ok: false, code: 'not-a-user-message' })
    reset()
    const withReplacement = [userMessage('first'), withdrawalReplacement(0, 0, [0])]
    expect(planEdit(withReplacement, [1], 0, 'x')).toEqual({ ok: false, code: 'already-withdrawn' })
  })
})

describe('edit vs withdraw markers', () => {
  it('tells edit replacements apart from withdrawals', () => {
    reset()
    const edit = editReplacement(2, 5, [2, 3, 4, 5], '编辑后的文本')
    expect(isMessageToolsEdit(edit)).toBe(true)
    expect(isMessageToolsReplacement(edit)).toBe(false)
    if (isMessageToolsEdit(edit)) expect(edit.surfaceOp.start).toBe(2)
    reset()
    const withdraw = withdrawalReplacement(2, 5, [2, 3, 4, 5])
    expect(isMessageToolsReplacement(withdraw)).toBe(true)
    expect(isMessageToolsEdit(withdraw)).toBe(false)
  })

  it('tells edit triggers apart from restores', () => {
    const trigger = {
      type: 'user/message', seq: 7, time: 1,
      data: { id: 't', role: 'user', content: [{ type: 'text', text: EDIT_TRIGGER_NOTICE }], source: editTriggerSource() },
      surfaceOp: 'append',
    } as SessionEvent
    expect(isMessageToolsTrigger(trigger)).toBe(true)
    expect(isMessageToolsRestore(trigger)).toBe(false)
  })

  it('tells restore-assistant replays apart from restores and triggers', () => {
    reset()
    const replay = restoreAssistantEvent(0, '答')
    expect(isMessageToolsRestoreAssistant(replay)).toBe(true)
    expect(isMessageToolsRestore(replay)).toBe(false)
    expect(isMessageToolsTrigger(replay)).toBe(false)
    reset()
    const restore = restoreEvent(0, '原文')
    expect(isMessageToolsRestoreAssistant(restore)).toBe(false)
    expect(isMessageToolsRestore(restore)).toBe(true)
  })

  it('strips the model-facing frame for display and passes unframed text through', () => {
    expect(stripRestoreAssistantFrame(`${RESTORED_ASSISTANT_NOTICE}\n答`)).toBe('答')
    expect(stripRestoreAssistantFrame('答')).toBe('答')
  })
})
