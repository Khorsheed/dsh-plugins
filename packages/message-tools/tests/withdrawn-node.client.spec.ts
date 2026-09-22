import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { MESSAGE_TOOLS_PLUGIN, WITHDRAWN_NOTICE } from '../src/marker.ts'
import {
  collectWithdrawnEntries, countHiddenInSpan, editedMessageDefinition, foldHiddenRanges,
  hasRestoreForSpan, isRestoreSuperseded, isSeqHidden, restoredAssistantMessageDefinition,
  restoredMessageDefinition, withdrawnDividerDefinition,
  type WithdrawnDividerData,
} from '../src/client/withdrawn-node.ts'

function replacementEvent(seq: number, start: number, end: number): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 1000,
    data: {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: WITHDRAWN_NOTICE }],
      source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN },
    },
    surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
    sourceEventSeqs: [start, end],
  } as SessionEvent
}

function dividerNode(hiddenStartSeq: number, seq: number): ChatConversationViewNode {
  return {
    key: `k${seq}`,
    kind: 'message-tools-withdrawn',
    id: String(seq),
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: { seq, hiddenStartSeq } satisfies WithdrawnDividerData,
  }
}

function userNode(seq: number, text = ''): ChatConversationViewNode {
  return {
    key: `u${seq}`,
    kind: 'user',
    id: String(seq),
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      kind: 'user',
      seq,
      time: 1000,
      content: text === '' ? [] : [{ type: 'text', text }],
      source: { kind: 'user' },
    },
  }
}

/** One admitted image block as it appears in a user message's content. */
const imageAttachment = {
  attachmentId: 'a1', mediaType: 'image/png', bytes: 10, width: 200, height: 100, name: 'photo.png',
}

/** A user node whose content blocks are given verbatim (text and/or images). */
function contentNode(seq: number, content: readonly unknown[]): ChatConversationViewNode {
  return {
    ...userNode(seq),
    data: { kind: 'user', seq, time: 1000, content, source: { kind: 'user' } },
  }
}

describe('withdrawnDividerDefinition', () => {
  it('claims message-tools replacement events as start matches', () => {
    expect(withdrawnDividerDefinition.match(replacementEvent(10, 5, 9))).toEqual({ id: '10', role: 'start' })
  })

  it('ignores append-surface events and other plugins', () => {
    const append = { ...replacementEvent(10, 5, 9), surfaceOp: 'append' } as SessionEvent
    expect(withdrawnDividerDefinition.match(append)).toBeNull()
    const compact = {
      ...replacementEvent(10, 5, 9),
      data: { id: 'm2', role: 'user', content: [], source: { kind: 'plugin', plugin: 'compact' } },
    } as unknown as SessionEvent
    expect(withdrawnDividerDefinition.match(compact)).toBeNull()
  })

  it('starts the divider state from the replacement span', () => {
    const match = { event: replacementEvent(10, 5, 9), role: 'start' as const }
    const state = withdrawnDividerDefinition.start({} as never, match as never, {} as never)
    expect(state).toEqual({ seq: 10, hiddenStartSeq: 5 })
  })

  it('builds a visible node anchored at the replacement seq', () => {
    const state: WithdrawnDividerData = { seq: 10, hiddenStartSeq: 5 }
    const node = withdrawnDividerDefinition.buildViewNode?.({
      key: 'k', kind: 'message-tools-withdrawn', id: '10', state,
    } as never)
    expect(node).toMatchObject({
      key: 'k',
      kind: 'message-tools-withdrawn',
      target: 'chat',
      anchorSeq: 10,
      visibility: 'visible',
      data: state,
    })
  })

  it('builds nothing before the start match lands', () => {
    const node = withdrawnDividerDefinition.buildViewNode?.({ key: 'k', state: undefined } as never)
    expect(node).toBeNull()
  })
})

describe('foldHiddenRanges', () => {
  it('flattens divider spans ordered by start, ignoring other kinds', () => {
    const ranges = foldHiddenRanges([userNode(1), dividerNode(5, 10), dividerNode(12, 20), userNode(30)])
    expect(ranges).toEqual([5, 10, 12, 20])
  })

  it('returns an empty fold when no withdrawal landed', () => {
    expect(foldHiddenRanges([userNode(1), userNode(2)])).toEqual([])
  })
})

describe('isSeqHidden', () => {
  const ranges = [5, 10, 12, 20]

  it('hides seqs inside a span, start inclusive, divider exclusive', () => {
    expect(isSeqHidden(ranges, 5)).toBe(true)
    expect(isSeqHidden(ranges, 9)).toBe(true)
    expect(isSeqHidden(ranges, 15)).toBe(true)
  })

  it('keeps seqs outside every span visible', () => {
    expect(isSeqHidden(ranges, 4)).toBe(false)
    expect(isSeqHidden(ranges, 10)).toBe(false)
    expect(isSeqHidden(ranges, 20)).toBe(false)
    expect(isSeqHidden([], 7)).toBe(false)
  })
})

describe('restoredMessageDefinition', () => {
  function restoreEvent(seq: number, fromSeq: number, text: string) {
    return {
      type: 'user/message',
      seq,
      time: 2000,
      data: {
        id: `r${seq}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN },
      },
      surfaceOp: 'append',
      sourceEventSeqs: [fromSeq],
    } as unknown as SessionEvent
  }

  it('claims message-tools restore append events', () => {
    expect(restoredMessageDefinition.match(restoreEvent(20, 5, '原文'))).toEqual({ id: '20', role: 'start' })
  })

  it('ignores replacements and other sources', () => {
    expect(restoredMessageDefinition.match(replacementEvent(10, 5, 9))).toBeNull()
    const plain = {
      type: 'user/message', seq: 3, time: 1,
      data: { id: 'm', role: 'user', content: [], source: { kind: 'user' } },
      surfaceOp: 'append',
    } as unknown as SessionEvent
    expect(restoredMessageDefinition.match(plain)).toBeNull()
  })

  it('starts with the replayed content, text, and the cited original seq', () => {
    const match = { event: restoreEvent(20, 5, '原文'), role: 'start' as const }
    expect(restoredMessageDefinition.start({} as never, match as never, {} as never))
      .toEqual({
        seq: 20, time: 2000, restoredFromSeq: 5,
        content: [{ type: 'text', text: '原文' }], text: '原文',
      })
  })

  it('builds a visible restored row anchored at the restore seq', () => {
    const state = {
      seq: 20, time: 2000, restoredFromSeq: 5,
      content: [{ type: 'text', text: '原文' }], text: '原文',
    }
    const node = restoredMessageDefinition.buildViewNode?.({
      key: 'k', kind: 'message-tools-restored', id: '20', state,
    } as never)
    expect(node).toMatchObject({
      key: 'k', kind: 'message-tools-restored', target: 'chat',
      anchorSeq: 20, visibility: 'visible', data: state,
    })
  })
})

describe('restoredAssistantMessageDefinition', () => {
  function restoreAssistantEvent(seq: number, fromSeq: number, text: string) {
    return {
      type: 'user/message',
      seq,
      time: 2000,
      data: {
        id: `ra${seq}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'restore-assistant' },
      },
      surfaceOp: 'append',
      sourceEventSeqs: [fromSeq],
    } as unknown as SessionEvent
  }

  it('claims restore-assistant replays and ignores plain restores', () => {
    expect(restoredAssistantMessageDefinition.match(restoreAssistantEvent(21, 6, '答')))
      .toEqual({ id: '21', role: 'start' })
    const plainRestore = {
      type: 'user/message', seq: 20, time: 2000,
      data: {
        id: 'r20', role: 'user', content: [{ type: 'text', text: '原文' }],
        source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN },
      },
      surfaceOp: 'append', sourceEventSeqs: [5],
    } as unknown as SessionEvent
    expect(restoredAssistantMessageDefinition.match(plainRestore)).toBeNull()
  })

  it('starts with the frame-stripped text and the cited original seq, builds a visible line', () => {
    const match = { event: restoreAssistantEvent(21, 6, '(以下是先前被撤回、现随恢复放回的助手回复)\n答'), role: 'start' as const }
    const state = restoredAssistantMessageDefinition.start({} as never, match as never, {} as never)
    expect(state).toEqual({ seq: 21, time: 2000, restoredFromSeq: 6, text: '答' })
    const node = restoredAssistantMessageDefinition.buildViewNode?.({
      key: 'k', kind: 'message-tools-restored-assistant', id: '21', state,
    } as never)
    expect(node).toMatchObject({
      kind: 'message-tools-restored-assistant', anchorSeq: 21, visibility: 'visible', data: state,
    })
  })
})

describe('span statistics', () => {
  const nodes = [
    userNode(1),
    userNode(5, '被撤回的原消息'),
    // The real assistant-step data shape: kind-keyed blocks; finalNode once
    // settled (conversation-nodes/assistant.ts).
    { ...userNode(6), kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: '回复' }], finalNode: { blocks: [{ kind: 'text', text: '回复' }] } } },
    { ...userNode(7), kind: 'assistant-step', data: { status: 'running', blocks: [{ kind: 'text', text: '流式中' }] } },
    { ...userNode(8), kind: 'tool-call', data: {} },
    dividerNode(5, 10),
    { ...userNode(11), kind: 'message-tools-restored', data: { seq: 11, time: 1, restoredFromSeq: 5, content: [], text: '原文' } },
  ]

  it('counts hidden user-visible messages, not UI chrome', () => {
    expect(countHiddenInSpan(nodes, 5, 10)).toBe(3)
    expect(countHiddenInSpan(nodes, 0, 1)).toBe(0)
  })

  it('does not count context rows that duplicate restored rows or edit triggers', () => {
    const restoredRow = {
      ...userNode(11),
      kind: 'message-tools-restored',
      data: { seq: 11, time: 1, restoredFromSeq: 5, content: [], text: '原文' },
    }
    const duplicateContext = {
      ...userNode(11),
      kind: 'context',
      data: { seq: 11, content: [], source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN } },
    }
    const editTriggerContext = {
      ...userNode(12),
      kind: 'context',
      data: { seq: 12, content: [], source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'edit-trigger' } },
    }
    expect(countHiddenInSpan([restoredRow, duplicateContext, dividerNode(11, 13)], 11, 13)).toBe(1)
    expect(countHiddenInSpan([editTriggerContext, dividerNode(12, 13)], 12, 13)).toBe(0)
  })

  it('collects user originals and assistant text in anchor order, skipping empty entries', () => {
    expect(collectWithdrawnEntries(nodes, 5, 10)).toEqual([
      { kind: 'user', text: '被撤回的原消息', images: [] },
      { kind: 'assistant', text: '回复', images: [] },
      { kind: 'assistant', text: '流式中', images: [] },
    ])
  })

  it('keeps the images of a withdrawn user message, text or not', () => {
    const mixed = [
      contentNode(5, [{ type: 'text', text: '看图' }, { type: 'image', attachment: imageAttachment }]),
      contentNode(6, [{ type: 'image', attachment: imageAttachment }]),
      dividerNode(5, 10),
    ]
    expect(collectWithdrawnEntries(mixed, 5, 10)).toEqual([
      { kind: 'user', text: '看图', images: [{ attachment: imageAttachment }] },
      { kind: 'user', text: '', images: [{ attachment: imageAttachment }] },
    ])
    // The image-only message counts as one hidden message instead of zero.
    expect(countHiddenInSpan(mixed, 5, 10)).toBe(2)
  })

  it('skips unreadable nodes but preserves reasoning-only assistant steps', () => {
    const sparse = [
      { ...userNode(5), data: {} },
      userNode(6),
      { ...userNode(7), kind: 'assistant-step', data: { status: 'running' } },
      { ...userNode(8), kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'reasoning', text: '想' }] } },
    ]
    expect(collectWithdrawnEntries(sparse, 5, 10)).toEqual([
      { kind: 'assistant', text: '想', images: [] },
    ])
  })

  it('collects restored and edited rows when they are re-withdrawn', () => {
    const restored = {
      ...userNode(11),
      kind: 'message-tools-restored',
      data: { seq: 11, time: 1, restoredFromSeq: 5, content: [{ type: 'text', text: '原文' }], text: '原文' },
    }
    const restoredAssistant = {
      ...userNode(12),
      kind: 'message-tools-restored-assistant',
      data: { seq: 12, time: 1, restoredFromSeq: 6, text: '旧答' },
    }
    const edited = {
      ...userNode(13),
      kind: 'message-tools-edited',
      data: { seq: 13, time: 1, content: [{ type: 'text', text: '编辑后' }] },
    }
    expect(collectWithdrawnEntries([restored, restoredAssistant, edited], 11, 14)).toEqual([
      { kind: 'user', text: '原文', images: [] },
      { kind: 'assistant', text: '旧答', images: [] },
      { kind: 'user', text: '编辑后', images: [] },
    ])
  })

  it('replays a re-withdrawn restore row\'s images from its replayed content', () => {
    const restored = {
      ...userNode(11),
      kind: 'message-tools-restored',
      data: {
        seq: 11, time: 1, restoredFromSeq: 5,
        content: [{ type: 'image', attachment: imageAttachment }], text: '',
      },
    }
    expect(collectWithdrawnEntries([restored, dividerNode(11, 13)], 11, 13)).toEqual([
      { kind: 'user', text: '', images: [{ attachment: imageAttachment }] },
    ])
  })

  it('detects a live restore row citing the span start', () => {
    expect(hasRestoreForSpan(nodes, 5, [5, 10])).toBe(true)
    expect(hasRestoreForSpan(nodes, 1, [5, 10])).toBe(false)
  })

  it('clears the badge when the restore row is itself withdrawn (hidden)', () => {
    const rewithdrawn = [
      ...nodes,
      dividerNode(11, 12),
    ]
    // The restore row (seq 11) now sits inside the new hidden span [11, 12).
    expect(hasRestoreForSpan(rewithdrawn, 5, [5, 10, 11, 12])).toBe(false)
    expect(isRestoreSuperseded(rewithdrawn, 5, [5, 10, 11, 12])).toBe(true)
  })
})

describe('editedMessageDefinition', () => {
  function editEvent(seq: number, start: number, end: number, text: string) {
    return {
      type: 'user/message',
      seq,
      time: 3000,
      data: {
        id: `e${seq}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: MESSAGE_TOOLS_PLUGIN, op: 'edit' },
      },
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: [start],
    } as unknown as SessionEvent
  }

  it('claims edit replacements and ignores withdrawals', () => {
    expect(editedMessageDefinition.match(editEvent(20, 5, 19, '编辑后'))).toEqual({ id: '20', role: 'start' })
    expect(editedMessageDefinition.match(replacementEvent(10, 5, 9))).toBeNull()
  })

  it('starts with the edited content and span start, builds a visible bubble row', () => {
    const match = { event: editEvent(20, 5, 19, '编辑后'), role: 'start' as const }
    const state = editedMessageDefinition.start({} as never, match as never, {} as never)
    expect(state).toEqual({ seq: 20, time: 3000, content: [{ type: 'text', text: '编辑后' }], hiddenStartSeq: 5 })
    const node = editedMessageDefinition.buildViewNode?.({
      key: 'k', kind: 'message-tools-edited', id: '20', state,
    } as never)
    expect(node).toMatchObject({ kind: 'message-tools-edited', anchorSeq: 20, visibility: 'visible' })
  })
})

describe('foldHiddenRanges with edit spans', () => {
  it('folds spans from both dividers and edited rows', () => {
    const ranges = foldHiddenRanges([
      userNode(1),
      dividerNode(5, 10),
      { ...userNode(12, 'x'), kind: 'message-tools-edited', data: { seq: 20, time: 1, content: [], hiddenStartSeq: 12 } },
    ])
    expect(ranges).toEqual([5, 10, 12, 20])
  })
})

describe('definition guards', () => {
  it('start throws on a mismatched event, and buildViewNode is null before state', () => {
    const plain = {
      type: 'user/message', seq: 3, time: 1,
      data: { id: 'm', role: 'user', content: [], source: { kind: 'user' } },
      surfaceOp: 'append',
    } as unknown as SessionEvent
    const match = { event: plain, role: 'start' as const }
    expect(() => withdrawnDividerDefinition.start({} as never, match as never, {} as never))
      .toThrow('message-tools-withdrawn start requires')
    expect(() => editedMessageDefinition.start({} as never, match as never, {} as never))
      .toThrow('message-tools-edited start requires')
    expect(() => restoredMessageDefinition.start({} as never, match as never, {} as never))
      .toThrow('message-tools-restored start requires')
    expect(() => restoredAssistantMessageDefinition.start({} as never, match as never, {} as never))
      .toThrow('message-tools-restored-assistant start requires')
    for (const definition of [
      withdrawnDividerDefinition, editedMessageDefinition,
      restoredMessageDefinition, restoredAssistantMessageDefinition,
    ]) {
      expect(definition.buildViewNode?.({ key: 'k', state: undefined } as never)).toBeNull()
      const state = { seq: 1 }
      expect(definition.update({ state } as never, {} as never)).toBe(state)
    }
  })
})
