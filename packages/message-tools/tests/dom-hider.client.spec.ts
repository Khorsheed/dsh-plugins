// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { hiddenFlowKeys, installDomHider, renderHiderRules } from '../src/client/dom-hider.ts'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

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

function snapshotOf(nodes: readonly ChatConversationViewNode[]): ConversationSnapshot {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  return {
    chat: {
      order: nodes.map(n => n.key),
      nodes: { get: (key: string) => byKey.get(key), values: () => nodes },
    },
  } as unknown as ConversationSnapshot
}

/** Minimal sessions-service stub: a list store plus per-id session stores. */
function harness() {
  const list = createSnapshotStore<{ current: string | undefined }>({ current: undefined })
  const sessions = new Map<string, ReturnType<typeof createSnapshotStore<ConversationSnapshot>>>()
  const provide = createSnapshotStore({ revision: 0 })
  const ctx = {
    sessions: {
      list,
      currentProvideInfo: provide,
      binding: (id: string) => {
        const session = sessions.get(id)
        return session === undefined ? undefined : { session }
      },
    },
  } as unknown as ClientContext
  return { ctx, list, sessions, provide }
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
    const { ctx, list, sessions } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    const session = createSnapshotStore(snapshotOf([
      node('user', '4:userA', 5),
      node('assistant-step', '14:assistant-stepB', 6),
      divider(5, 10),
    ]))
    sessions.set('s1', session)
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
    const { ctx, list, sessions } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const session = createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)]))
    sessions.set('s1', session)
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
    const { ctx, list, sessions } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const session = createSnapshotStore(snapshotOf([
      node('user', '4:userA', 5),
      node('assistant-step', '14:assistant-stepB', 6),
      divider(5, 10),
    ]))
    sessions.set('s1', session)
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
    session.update((snapshot) => {
      (snapshot as { chat: { nodes: unknown } }).chat.nodes = {
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
    const { ctx, list, sessions } = harness()
    const probeRow = document.createElement('div')
    probeRow.setAttribute('data-chat-flow-key', 'probe')
    document.body.appendChild(probeRow)
    sessions.set('s1', createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)])))
    sessions.set('s2', createSnapshotStore(snapshotOf([node('user', '4:userF', 2)])))
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
    const { ctx, list, sessions } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    sessions.set('s1', createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)])))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userA')
    dispose()
  })

  it('returns early for a session with no hidden keys before probing', async () => {
    const { ctx, list, sessions } = harness()
    sessions.set('s1', createSnapshotStore(snapshotOf([node('user', '4:userA', 5)])))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    dispose()
  })

  it('schedules the probe once for two synchronous snapshots, then rewrites on change', async () => {
    const { ctx, list, sessions } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    const session = createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)]))
    sessions.set('s1', session)
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    // A second synchronous emission while the probe is scheduled is dropped.
    session.update((snapshot) => { (snapshot as unknown as { chat: { order: string[] } }).chat.order = [] })
    await nextFrame()
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userA')
    // After the probe passed: a changed snapshot rewrites the rules; an
    // unchanged one keeps them.
    session.update((snapshot) => {
      (snapshot as { chat: { nodes: unknown } }).chat.nodes = {
        get: () => undefined,
        values: () => [node('user', '4:userA', 5), node('user', '4:userB', 6), divider(5, 10)],
      }
    })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userB')
    session.update((snapshot) => { (snapshot as unknown as { chat: { order: string[] } }).chat.order = ['x'] })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toContain('4:userB')
    dispose()
  })

  it('ignores snapshots while disabled by an exhausted window, but reactivates when a row appears later', async () => {
    const { ctx, list, sessions } = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const session = createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)]))
    sessions.set('s1', session)
    const dispose = installDomHider(ctx, { probeRetryWindowMs: 30 })
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(warn).toHaveBeenCalledTimes(1)
    session.update((snapshot) => {
      (snapshot as { chat: { nodes: unknown } }).chat.nodes = {
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

  it('early-returns when rebinding the same session and tolerates a missing binding', async () => {
    const { ctx, list, sessions, provide } = harness()
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-key', '4:userA')
    document.body.appendChild(row)
    sessions.set('s1', createSnapshotStore(snapshotOf([node('user', '4:userA', 5), divider(5, 10)])))
    const dispose = installDomHider(ctx)
    list.update((s) => { s.current = 's1' })
    await nextFrame()
    const before = document.querySelector('style[data-message-tools-hider]')?.textContent
    // Same current rebind through the provide channel: no rewrite.
    provide.update((s) => { Object.assign(s, { revision: 1 }) })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe(before)
    // A session with no binding clears the rules without throwing.
    list.update((s) => { s.current = 'ghost' })
    expect(document.querySelector('style[data-message-tools-hider]')?.textContent).toBe('')
    dispose()
  })
})
