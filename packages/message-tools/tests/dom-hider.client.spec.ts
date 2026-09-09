// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { hiddenFlowKeys, installDomHider, renderHiderRules } from '../src/client/dom-hider.ts'
import type { ChatSlice } from '../src/client/chat-hook.ts'

function node(kind: string, key: string, anchorSeq: number, data?: unknown): ChatConversationViewNode {
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    anchorSeq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: data ?? { seq: anchorSeq },
  }
}

function divider(hiddenStartSeq: number, seq: number): ChatConversationViewNode {
  return node('message-tools-withdrawn', `21:message-tools-withdrawn${seq}`, seq, { seq, hiddenStartSeq })
}

function chatOf(nodes: readonly ChatConversationViewNode[]): ChatSlice {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  return {
    order: nodes.map(n => n.key),
    nodes: { get: (key: string) => byKey.get(key), values: () => nodes },
  } as unknown as ChatSlice
}

/**
 * Minimal host stub: the session list store plus the uiConversation service
 * whose per-session binding targets carry the chat slices (host 0.1.2's
 * split — the chat slice no longer rides the Session snapshot).
 */
function harness() {
  const list = createSnapshotStore<{ current: string | undefined }>({ current: undefined })
  const chatTargets = new Map<string, ReturnType<typeof createSnapshotStore<ChatSlice | undefined>>>()
  const uiConversation = {
    binding: (id: string) => ({
      target: (name: string) => {
        if (name !== 'chat' || !chatTargets.has(id)) throw new Error(`uiConversation.binding: unknown session "${id}"`)
        return chatTargets.get(id)
      },
    }),
  }
  const ctx = {
    get: (name: string) => (name === 'uiConversation' ? uiConversation : undefined),
    sessions: { list },
  } as unknown as Context
  /** Register one session's chat target; returns the mutable store. */
  const addSession = (id: string, chat: ChatSlice) => {
    const store = createSnapshotStore<ChatSlice | undefined>(chat)
    chatTargets.set(id, store)
    return store
  }
  return { ctx, list, addSession }
}

async function nextFrame(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 30))
}

afterEach(() => {
  vi.restoreAllMocks()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('hiddenFlowKeys', () => {
  it('collects keys of every kind inside the span, excluding the divider itself', () => {
    const keys = hiddenFlowKeys([
      node('user', '4:userA', 5),
      node('assistant-step', '14:assistant-stepB', 6),
      node('tool-call', '9:tool-callC', 7),
      node('turn-tail', '9:turn-tailD', 9.1),
      divider(5, 10),
      node('user', '4:userE', 11),
    ])
    expect(keys).toEqual(['4:userA', '14:assistant-stepB', '9:tool-callC', '9:turn-tailD'])
  })

  it('returns no keys without a divider', () => {
    expect(hiddenFlowKeys([node('user', '4:userA', 5)])).toEqual([])
  })
})

describe('renderHiderRules', () => {
  it('quotes keys into attribute selectors', () => {
    expect(renderHiderRules(['4:userA'])).toBe('[data-chat-flow-key="4:userA"]{display:none!important}')
    expect(renderHiderRules([])).toBe('')
  })
})

describe('installDomHider', () => {
  it('writes hiding rules for the current session after the probe passes', async () => {
    const { ctx, list, addSession } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    addSession('s1', chatOf([
      node('user', '4:userA', 5),
      node('assistant-step', '14:assistant-stepB', 6),
      divider(5, 10),
    ]))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    const style = document.querySelector('style[data-message-tools-hider]')
    expect(style?.textContent).toContain('[data-chat-flow-key="4:userA"]')
    expect(style?.textContent).toContain('[data-chat-flow-key="14:assistant-stepB"]')
    expect(style?.textContent).not.toContain('message-tools-withdrawn')
    dispose()
    row.remove()
    expect(document.querySelector('style[data-message-tools-hider]')).toBeNull()
  })

  it('disables itself with one warning only after the probe retry window expires with rows still absent', async () => {
    const { ctx, list, addSession } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    const dispose = installDomHider(ctx, { probeRetryWindowMs: 30 })
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    // A bare miss does NOT disable: the rows may simply not be mounted yet.
    expect(warn).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 60))
    const style = document.querySelector('style[data-message-tools-hider]')
    expect(style?.textContent).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('data-chat-flow-key')
    dispose()
  })

  it('recovers when the chat rows mount during the probe retry window', async () => {
    const { ctx, list, addSession } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chat = addSession('s1', chatOf([
      node('user', '4:userA', 5),
      node('assistant-step', '14:assistant-stepB', 6),
      divider(5, 10),
    ]))
    // A short window proves the recovery happens through the retry, not the first probe.
    const dispose = installDomHider(ctx, { probeRetryWindowMs: 2_000 })
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    expect(warn).not.toHaveBeenCalled()
    // The chat area mounts late (page restored onto another tab first).
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    await nextFrame()
    const style = document.querySelector('style[data-message-tools-hider]')
    expect(style?.textContent).toContain('[data-chat-flow-key="4:userA"]')
    expect(style?.textContent).toContain('[data-chat-flow-key="14:assistant-stepB"]')
    expect(warn).not.toHaveBeenCalled()
    // Recovered for good: later snapshots keep rewriting the rules.
    chat.update((snapshot) => {
      ;(snapshot as { nodes: unknown }).nodes = {
        get: () => undefined,
        values: () => [
          node('user', '4:userA', 5), node('tool-call', '9:tool-callC', 7), node('turn-tail', '9:turn-tailD', 9.1), divider(5, 10),
        ],
      }
    })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('9:tool-callC')
    dispose()
  })

  it('rebinds on session switch and clears rules for sessions without spans', async () => {
    const { ctx, list, addSession } = harness()
    const probeRow = document.createElement('div')
    probeRow.setAttribute('data-chat-flow-key', 'probe')
    document.body.appendChild(probeRow)
    addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    addSession('s2', chatOf([node('user', '4:userF', 2)]))
    installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userA')
    list.update((s) => { s.current = 's2' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
  })
})

describe('hiddenFlowKeys edit-trigger hiding', () => {
  it('hides every message-tools context row, keeps other context rows', () => {
    const triggerRow = node('context', '7:context40', 40, {
      seq: 40, content: [], source: { kind: 'plugin', plugin: 'message-tools', op: 'edit-trigger' },
    })
    const restoreRow = node('context', '7:context41', 41, {
      seq: 41, content: [], source: { kind: 'plugin', plugin: 'message-tools' },
    })
    const official = node('context', '7:context42', 42, {
      seq: 42, content: [], source: { kind: 'plugin', plugin: 'system-prompt' },
    })
    expect(hiddenFlowKeys([triggerRow, restoreRow, official])).toEqual(['7:context40', '7:context41'])
  })

  it('hides the context rows duplicating restored and restored-assistant rows', () => {
    const restored = node('message-tools-restored', 'r50', 50, {
      seq: 50, time: 1, restoredFromSeq: 5, content: [], text: '原文',
    })
    const restoredAssistant = node('message-tools-restored-assistant', 'ra51', 51, {
      seq: 51, time: 1, restoredFromSeq: 6, text: '答',
    })
    const dupUser = node('context', '7:context50', 50, {
      seq: 50, content: [], source: { kind: 'plugin', plugin: 'message-tools' },
    })
    const dupAssistant = node('context', '7:context51', 51, {
      seq: 51, content: [], source: { kind: 'plugin', plugin: 'message-tools', op: 'restore-assistant' },
    })
    // A context row whose data carries no seq at all.
    const seqless = node('context', '7:contextX', 53, {
      content: [], source: { kind: 'plugin', plugin: 'system-prompt' },
    })
    const official = node('context', '7:context52', 52, {
      seq: 52, content: [], source: { kind: 'plugin', plugin: 'system-prompt' },
    })
    expect(hiddenFlowKeys([restored, restoredAssistant, dupUser, dupAssistant, seqless, official]))
      .toEqual(['7:context50', '7:context51'])
  })
})

describe('hiddenFlowKeys explicit ranges', () => {
  it('uses caller-provided ranges instead of folding from the nodes', () => {
    expect(hiddenFlowKeys([node('user', '4:userA', 5)], [5, 10])).toEqual(['4:userA'])
  })
})

describe('installDomHider edges', () => {
  it('falls back to setTimeout scheduling when requestAnimationFrame is absent', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const { ctx, list, addSession } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userA')
    dispose()
  })

  it('returns early for a session with no hidden keys before probing', async () => {
    const { ctx, list, addSession } = harness()
    addSession('s1', chatOf([node('user', '4:userA', 5)]))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    dispose()
  })

  it('schedules the probe once for two synchronous snapshots, then rewrites on change', async () => {
    const { ctx, list, addSession } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    const chat = addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    // A second synchronous emission while the probe is scheduled is dropped.
    chat.update((snapshot) => { (snapshot as unknown as { order: string[] }).order = [] })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userA')
    // After the probe passed: a changed snapshot rewrites the rules; an
    // unchanged one keeps them.
    chat.update((snapshot) => {
      ;(snapshot as { nodes: unknown }).nodes = {
        get: () => undefined,
        values: () => [node('user', '4:userA', 5), node('user', '4:userB', 6), divider(5, 10)],
      }
    })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userB')
    chat.update((snapshot) => { (snapshot as unknown as { order: string[] }).order = ['x'] })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userB')
    dispose()
  })

  it('ignores snapshots while disabled by an exhausted window, but reactivates when a row appears later', async () => {
    const { ctx, list, addSession } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chat = addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    const dispose = installDomHider(ctx, { probeRetryWindowMs: 30 })
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(warn).toHaveBeenCalledTimes(1)
    chat.update((snapshot) => {
      ;(snapshot as { nodes: unknown }).nodes = {
        get: () => undefined,
        values: () => [node('user', '4:userA', 5), node('user', '4:userB', 6), divider(5, 10)],
      }
    })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    // The page sat past the window with the chat unmounted, then the user
    // switches to the chat tab: rows mount, and hiding reactivates.
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userB')
    dispose()
  })

  it('tolerates a session whose conversation binding is absent', async () => {
    const { ctx, list, addSession } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    addSession('s1', chatOf([node('user', '4:userA', 5), divider(5, 10)]))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    const before = document.querySelector('style[data-message-tools-hider]')?.textContent
    expect(before).toContain('4:userA')
    // A session with no binding clears the rules without throwing.
    list.update((s) => { s.current = 'ghost' })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    dispose()
  })
})
