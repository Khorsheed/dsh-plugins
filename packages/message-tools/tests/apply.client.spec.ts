// @vitest-environment jsdom
/** The browser half's apply: composition shape, injected action faces, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { MessageToolsInjected, WithdrawnDividerInjected } from '../src/client/slots.ts'

/** Stub Remote namespace: carried transport+result envelopes like production. */
function remoteStub(behavior: 'ok' | 'transport-error' | 'rejected' = 'ok') {
  const reply = (value: unknown) => behavior === 'ok'
    ? { ok: true, value: { ok: true, value } }
    : behavior === 'transport-error'
      ? { ok: false, error: { code: 'offline' } }
      : { ok: true, value: { ok: false, error: { code: 'not-a-user-message' } } }
  return {
    withdraw: vi.fn(async () => reply({ replacementSeq: 9, shadowedCount: 2 })),
    restore: vi.fn(async () => reply({ restoredSeq: 10 })),
    edit: vi.fn(async () => reply({ replacementSeq: 11, triggered: true })),
  }
}

interface BenchOptions {
  scope?: 'ok' | 'no-scope' | 'no-conversation'
  mountFails?: boolean
  models?: boolean
  running?: boolean
  draft?: string
  subagent?: boolean
  /** The session binding vanishes during the edit's cancel step. */
  bindingVanishes?: boolean
  /** The turn never settles (cancel never closes it): waitIdle hits its deadline. */
  stuckRunning?: boolean
  /** Which host-line registry seat the bench provides (default 'rc'). */
  eventsSeat?: 'rc' | 'alpha'
}

/** The settle-shaped snapshot stub: a turn whose teardown lands only when cancel completes it. */
interface SettleState {
  running: boolean
  runningCalls: readonly unknown[]
  chat: { timeline: { turnOrder: readonly number[]; turns: Map<number, { status: 'open' | 'closed' | 'unknown' }> } }
}

/** Real cordis composition with the slot registry, locale runtime, and stub services. */
async function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remoteService = {
    $mount: options.mountFails === true
      ? vi.fn(async (): Promise<() => Promise<void>> => { throw new Error('already mounted') })
      : vi.fn(async (): Promise<() => Promise<void>> => async () => {}),
  }
  ctx.provide('remote', remoteService as never)
  const remote = remoteStub()
  ctx.provide('remote.messageTools', remote as never)
  const conversationEvents = { register: vi.fn(() => () => {}) }
  // The event-Definition registry seat differs per host line: rc exposes the
  // standalone conversationEvents service, 0.1.2 folds it into
  // uiConversation.events. The plugin probes both arms; the bench picks one.
  if (options.eventsSeat === 'alpha') {
    ctx.provide('uiConversation', { events: conversationEvents } as never)
  } else {
    ctx.provide('conversationEvents', conversationEvents as never)
  }
  const input = {
    state: createSnapshotStore({ draft: options.draft ?? '' }),
    setDraft: vi.fn((text: string) => { input.state.getSnapshot().draft = text }),
    notify: vi.fn(),
  }
  const settle = createSnapshotStore<SettleState>({
    running: options.running === true,
    runningCalls: options.running === true ? [{ call: 1 }] : [],
    chat: {
      timeline: {
        turnOrder: [1],
        turns: new Map([[1, { status: options.running === true ? 'open' : 'closed' }]]),
      },
    },
  })
  const conversation = {
    cancel: vi.fn(async () => {
      if (options.bindingVanishes === true) bindingState.missing = true
      if (options.stuckRunning !== true) {
        // A healthy cancel: running flips, the pending results land, turn/end closes the turn.
        const snapshot = settle.getSnapshot()
        snapshot.running = false
        ;(snapshot as { runningCalls: unknown[] }).runningCalls = []
        snapshot.chat.timeline.turns.set(1, { status: 'closed' })
      }
    }),
    send: vi.fn(async () => {}),
    input: { for: () => input },
  }
  const bindingState = { missing: false }
  // Mutable so a spec can flip the scope AFTER the inject face was built
  // (the backfill closure resolves the scope at call time).
  const scopeState = { behavior: options.scope ?? 'ok' }
  const actx = {
    get: (name: string) => {
      if (scopeState.behavior === 'no-conversation') return undefined
      return name === 'conversation' ? conversation : undefined
    },
  }
  const directory = {
    store: { getSnapshot: () => ({}), subscribe: () => () => {} },
    load: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
  }
  ctx.provide('sessions', {
    list: createSnapshotStore<{ current?: string }>({}),
    currentProvideInfo: createSnapshotStore({}),
    scope: () => (scopeState.behavior === 'no-scope' ? undefined : actx),
    binding: () => bindingState.missing
      ? undefined
      : { session: { getSnapshot: () => settle.getSnapshot(), subscribe: () => () => {} } },
    subagentAddress: () => (options.subagent === true ? 'subagent://s1' : undefined),
  } as never)
  ctx.provide('conversation', {} as never)
  if (options.models === true) {
    ctx.provide('modelDirectories', { directoryFor: () => directory } as never)
  }
  const slots = ctx.get('slots') as SlotRegistry
  // The keyed chat-node slot declared by ui-conversation in production.
  slots.register({
    name: 'root',
    children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  return { ctx, slots, remote, remoteService, conversationEvents, conversation, input, directory, scopeState }
}

type EntryInject = (sessionId: string) => unknown

function face(slots: SlotRegistry, key: string): EntryInject {
  const entry = slots.entries('conversation.chat.node').find(item => item.options.key === key)
  expect(entry, `slot entry ${key}`).toBeDefined()
  return entry!.inject as unknown as EntryInject
}

describe('message-tools client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'remote', 'conversation', 'locale'])
  })

  it('mounts the Remote, registers four Definitions and six chat-node entries', async () => {
    const { ctx, slots, remoteService, conversationEvents } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    expect(conversationEvents.register).toHaveBeenCalledTimes(4)
    const keys = slots.entries('conversation.chat.node').map(item => item.options.key)
    expect(keys).toEqual(expect.arrayContaining([
      'message-tools-withdrawn', 'message-tools-restored-assistant',
      'user', 'steering', 'message-tools-edited', 'message-tools-restored',
    ]))
    expect(keys).toHaveLength(6)
  })

  it('registers the Definitions through uiConversation.events when the standalone service is absent (host 0.1.2)', async () => {
    const { ctx, conversationEvents } = await bench({ eventsSeat: 'alpha' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(conversationEvents.register).toHaveBeenCalledTimes(4)
  })

  it('still registers every surface when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.chat.node')).toHaveLength(6)
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.chat.node')).toHaveLength(6)
    await fiber.dispose()
    expect(slots.entries('conversation.chat.node')).toHaveLength(0)
  })

  it('divider face restores through the Remote and maps both failure envelopes', async () => {
    const okBench = await bench()
    await okBench.ctx.plugin({ inject: [...inject], apply }).await()
    const divider = face(okBench.slots, 'message-tools-withdrawn')('s1') as WithdrawnDividerInjected
    await divider.restoreMessage(3)
    expect(okBench.remote.restore).toHaveBeenCalledWith({ sessionId: 's1', targetSeq: 3 })

    for (const behavior of ['transport-error', 'rejected'] as const) {
      const failed = await bench()
      Object.assign(failed.remote, remoteStub(behavior))
      await failed.ctx.plugin({ inject: [...inject], apply }).await()
      const dividerFace = face(failed.slots, 'message-tools-withdrawn')('s1') as WithdrawnDividerInjected
      await expect(dividerFace.restoreMessage(3)).rejects.toThrow(
        behavior === 'transport-error' ? 'transport' : 'rejected',
      )
    }
  })

  it('user face fails loud without a session scope or the conversation service', async () => {
    const noScope = await bench({ scope: 'no-scope' })
    await noScope.ctx.plugin({ inject: [...inject], apply }).await()
    expect(() => face(noScope.slots, 'user')('s1')).toThrow('resolved no scope')

    const noConversation = await bench({ scope: 'no-conversation' })
    await noConversation.ctx.plugin({ inject: [...inject], apply }).await()
    expect(() => face(noConversation.slots, 'user')('s1')).toThrow('conversation service unavailable')
  })

  it('user face withdraws and edits through the Remote, cancelling a running turn first', async () => {
    const { ctx, slots, remote, conversation } = await bench({ running: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(slots, 'user')('s1') as MessageToolsInjected
    await user.withdrawMessage(2)
    expect(remote.withdraw).toHaveBeenCalledWith({ sessionId: 's1', targetSeq: 2 })
    await user.editMessage(2, '新文本')
    expect(conversation.cancel).toHaveBeenCalledTimes(1)
    expect(remote.edit).toHaveBeenCalledWith({ sessionId: 's1', targetSeq: 2, text: '新文本' })
  })

  it('user face maps Remote failures to thrown errors', async () => {
    const { ctx, slots, remote } = await bench()
    Object.assign(remote, remoteStub('rejected'))
    await ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(slots, 'user')('s1') as MessageToolsInjected
    await expect(user.withdrawMessage(2)).rejects.toThrow('rejected')
    await expect(user.editMessage(2, 'x')).rejects.toThrow('rejected')
  })

  it('user face maps transport failures to thrown errors', async () => {
    const { ctx, slots, remote } = await bench()
    Object.assign(remote, remoteStub('transport-error'))
    await ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(slots, 'user')('s1') as MessageToolsInjected
    await expect(user.withdrawMessage(2)).rejects.toThrow('transport')
    await expect(user.editMessage(2, 'x')).rejects.toThrow('transport')
  })

  it('edit rejects when the session binding vanishes during the cancel (the settle can no longer be proven)', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, slots, remote } = await bench({ running: true, bindingVanishes: true })
      await ctx.plugin({ inject: [...inject], apply }).await()
      const user = face(slots, 'user')('s1') as MessageToolsInjected
      const editing = user.editMessage(2, '新文本')
      const expectation = expect(editing).rejects.toThrow('timed out waiting for the cancelled turn to settle')
      await vi.advanceTimersByTimeAsync(5_100)
      await expectation
      expect(remote.edit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('edit rejects when a stuck turn never settles (bounded waitIdle deadline), never racing the stragglers', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, slots, remote } = await bench({ running: true, stuckRunning: true })
      await ctx.plugin({ inject: [...inject], apply }).await()
      const user = face(slots, 'user')('s1') as MessageToolsInjected
      const editing = user.editMessage(2, '新文本')
      const expectation = expect(editing).rejects.toThrow('timed out waiting for the cancelled turn to settle')
      await vi.advanceTimersByTimeAsync(5_100)
      await expectation
      expect(remote.edit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('backfill fails loud when the scope or conversation vanishes after the face was built', async () => {
    const { ctx, slots, scopeState } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(slots, 'user')('s1') as MessageToolsInjected
    scopeState.behavior = 'no-scope'
    expect(() => { user.backfillDraft('原文') }).toThrow('resolved no scope')
    scopeState.behavior = 'no-conversation'
    expect(() => { user.backfillDraft('原文') }).toThrow('conversation service unavailable')
  })

  it('addressed subagent sessions get no chip even with the directory service', async () => {
    const { ctx, slots } = await bench({ models: true, subagent: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(slots, 'user')('s1') as MessageToolsInjected
    expect(user.modelsAvailable).toBe(false)
    // The frozen stub observable keeps the hooks compartment shape.
    expect(user.hooks.modelDirectory.getSnapshot()).toMatchObject({ status: 'idle' })
    const unsubscribe = user.hooks.modelDirectory.subscribe(() => {})
    unsubscribe()
  })

  it('user face backfills the draft (blank fills, non-empty appends) and notifies', async () => {
    const blank = await bench()
    await blank.ctx.plugin({ inject: [...inject], apply }).await()
    const user = face(blank.slots, 'user')('s1') as MessageToolsInjected
    user.backfillDraft('原文')
    expect(blank.input.setDraft).toHaveBeenCalledWith('原文')
    expect(blank.input.notify).toHaveBeenCalledWith('info', 'Backfilled into the composer; edit and send')

    const filled = await bench({ draft: '写到一半' })
    await filled.ctx.plugin({ inject: [...inject], apply }).await()
    ;(face(filled.slots, 'user')('s1') as MessageToolsInjected).backfillDraft('原文')
    expect(filled.input.setDraft).toHaveBeenCalledWith('写到一半\n原文')
  })

  it('user face exposes the model chip wiring only when the directory service exists', async () => {
    const noModels = await bench()
    await noModels.ctx.plugin({ inject: [...inject], apply }).await()
    const plain = face(noModels.slots, 'user')('s1') as MessageToolsInjected
    expect(plain.modelsAvailable).toBe(false)
    plain.loadModels()
    expect(await plain.selectModel({ provider: 'p', model: 'm' })).toBe(false)

    const withModels = await bench({ models: true })
    await withModels.ctx.plugin({ inject: [...inject], apply }).await()
    const chipped = face(withModels.slots, 'user')('s1') as MessageToolsInjected
    expect(chipped.modelsAvailable).toBe(true)
    chipped.loadModels()
    expect(withModels.directory.load).toHaveBeenCalledTimes(1)
    expect(await chipped.selectModel({ provider: 'p', model: 'm' })).toBe(true)
    expect(withModels.directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'm' })
    // Directory load/select rejections stay contained (fire-and-forget / false).
    withModels.directory.load.mockRejectedValueOnce(new Error('offline'))
    chipped.loadModels()
    withModels.directory.select.mockRejectedValueOnce(new Error('denied'))
    expect(await chipped.selectModel({ provider: 'p', model: 'm' })).toBe(false)
  })
})
