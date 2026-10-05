// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the conversation.view entry (registered exactly while the current session's preset composition grants the dataset tool row), the injected face, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { DatasetsViewInjected } from '../src/client/contract.ts'
import { DATASETS_TOOL_ROW_MODULE, type DatasetsPluginInventorySnapshot } from '../src/client/preset-visibility.ts'

/** The composition answer used by the gate tests. */
const DEV: DatasetsPluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: DATASETS_TOOL_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

/** Flush the visibility controller's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Stub Remote namespace: carried result envelopes like production. */
function remoteStub() {
  return {
    registry: vi.fn(async () => ({ ok: true as const, value: [] })),
    previewRepo: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    register: vi.fn(async (input: unknown) => ({ ok: true as const, value: input })),
    updateRegistration: vi.fn(async (input: unknown) => ({ ok: true as const, value: input })),
    unregister: vi.fn(async () => ({ ok: true as const, value: true })),
    importBindings: vi.fn(async () => ({ ok: true as const, value: { imported: [], dangling: [] } })),
    list: vi.fn(async () => ({ ok: true as const, value: { kind: 'datasets' as const, datasets: [] } })),
    show: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    read: vi.fn(async () => ({ ok: true as const, value: { content: 'x', commit: 'abc' } })),
    overview: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    proposalReview: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    reviewItem: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    confirmProposal: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    confirmPending: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    proposals: vi.fn(async (): Promise<{ ok: true; value: Array<{ id: string }> } | { ok: false; error: { code: string; message: string } }> => ({ ok: true as const, value: [] })),
  }
}

const ALPHA_GENERATION = { host: { home: '/h' } }

/** Real cordis composition with the slot registry, locale runtime, and stub remotes. */
async function bench(options: {
  mountFails?: boolean
  connectionSeat?: 'rc' | 'alpha'
  preset?: string
  composition?: DatasetsPluginInventorySnapshot
  /** Publish the 0.1.5-shaped list (top-level `current`, no per-row retention). */
  legacyCurrent?: boolean
  /** A whole session list, for the parent-chain cases; overrides `preset`. */
  rows?: Record<string, unknown>
  /** The 0.1.2+ `session.canOpenWorkspacePath` probe; omitted = no `remote.session` namespace. */
  canOpenWorkspacePath?: () => Promise<{ ok: boolean; value?: unknown }>
  /** Declare the host 0.2.0 global-panel pair (`main` + `sidebar.panellist`). */
  globalPanels?: boolean
} = {}) {
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
  ctx.provide('remote.datasets', remote as never)
  const workspaces = { pickDirectory: vi.fn(async () => '/picked') }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('connection', options.connectionSeat === 'alpha'
    // 0.1.2 folded the host facts into the generation's opening frame
    // (Connection.hostDescription removed, upstream e14d354e83).
    ? {
      isLoopback: true,
      // A live generation's snapshot is one stable object per generation.
      generation: { getSnapshot: () => ALPHA_GENERATION, subscribe: () => () => {} },
    } as never
    : {
      isLoopback: true,
      hostDescription: { getSnapshot: () => ({ canOpenPath: true }), subscribe: () => () => {} },
    } as never)
  // No preset on the row = the fail-open default; a named preset reads the
  // composition; `rows` supplies a whole list for the parent-chain cases.
  // The on-screen session: 0.1.6-alpha.2 reads the row's main-view retention
  // count; `legacyCurrent` exercises the 0.1.5 `current` fallback instead.
  const byId = options.rows
    ?? (options.preset === undefined ? { s1: {} } : { s1: { projectionValues: { agentPreset: options.preset } } })
  const list = createSnapshotStore(options.legacyCurrent === true
    ? { ids: Object.keys(byId), byId, current: 's1' as SessionId, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
    : {
        ids: Object.keys(byId),
        byId: Object.fromEntries(Object.entries(byId).map(([id, row]) => [
          id,
          { id, ...(row as Record<string, unknown>), ...(id === 's1' ? { retainedBy: { mainView: 1 } } : {}) },
        ])),
        phase: 'ready', subagentsByParent: {}, jobsBySession: {},
      })
  ctx.provide('sessions', { list } as never)
  if (options.canOpenWorkspacePath !== undefined) {
    ctx.provide('remote.session', { canOpenWorkspacePath: options.canOpenWorkspacePath } as never)
  }
  if (options.composition !== undefined) {
    ctx.provide('remote.pluginInventory', {
      list: async () => ({ ok: true as const, value: options.composition }),
    } as never)
  }
  const slots = ctx.get('slots') as SlotRegistry
  // The view ring and the composer tool row, as ui-conversation declares them
  // in production.
  slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      ...(options.globalPanels === true
        ? {
            'main': { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
          }
        : {}),
    },
  } as never, () => null)
  return { ctx, slots, remote, remoteService, workspaces }
}

describe('datasets client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale', 'workspaces', 'connection', 'sessions'])
  })

  it('mounts the Remote and registers the datasets view entry', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'datasets', order: 30 })
    expect(typeof entries[0]!.options.label).toBe('function')
  })

  it('registers no composer chip: the binding it showed is retired (T73)', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    // Datasets belong to the deployment's registry, not to a session, so the
    // composer has nothing per-session to show.
    expect(slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('still registers the view when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('registers the tab on a 0.1.5-shaped list (legacy current fallback)', async () => {
    const { ctx, slots } = await bench({ legacyCurrent: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('leaves the tab registered when the current preset composition names the datasets-tool row', async () => {
    const { ctx, slots } = await bench({ preset: 'dev', composition: DEV })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('drops the tab registration in a session whose preset grants no dataset tools', async () => {
    const { ctx, slots } = await bench({ preset: 'standard', composition: DEV })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  // I5·T39 · G13: a member sub-session of an evaluation declares no preset of
  // its own, so read alone it took the fail-open arm and showed this tab
  // inside a player's own transcript while the parent session hid it.
  it('decides a member sub-session by its PARENT\'s preset composition', async () => {
    const { ctx, slots } = await bench({
      composition: DEV,
      rows: { s1: { parentSessionId: 'main' } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('hides in a member sub-session whose parent grants no datasets tools', async () => {
    const { ctx, slots } = await bench({
      composition: DEV,
      rows: { s1: { parentSessionId: 'main' }, main: { projectionValues: { agentPreset: 'standard' } } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('keeps the tab when the composition cannot be read (fail-open)', async () => {
    // No `remote.pluginInventory` namespace at all — a pre-0.1.5 host.
    const { ctx, slots } = await bench({ preset: 'standard' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('the injected face binds every verb to the Remote namespace with the session id and the registration id', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')

    await face.fetchRegistry('s1')
    expect(remote.registry).toHaveBeenCalledWith()

    await face.previewRepo('s1', '/repo')
    expect(remote.previewRepo).toHaveBeenCalledWith({ path: '/repo' })
    await face.previewRepo('s1', '/repo', 'i1-walk')
    expect(remote.previewRepo).toHaveBeenCalledWith({ path: '/repo', trackedRef: 'i1-walk' })

    const input = { path: '/repo', sets: { alpha: { layers: ['visible'] } }, authoringCheckout: null }
    await face.register('s1', input)
    expect(remote.register).toHaveBeenCalledWith(input)
    const update = { id: 'lib', trackedRef: 'main' }
    await face.updateRegistration('s1', update)
    expect(remote.updateRegistration).toHaveBeenCalledWith(update)
    await face.unregister('s1', 'lib')
    expect(remote.unregister).toHaveBeenCalledWith({ id: 'lib' })
    await face.importBindings('s1')
    expect(remote.importBindings).toHaveBeenCalledWith()

    // Every read after the registry names ONE registration by its id.
    await face.listDatasets('s1', 'lib')
    expect(remote.list).toHaveBeenCalledWith({ repo: 'lib' })
    await face.listDatasets('s1', 'lib', 'alpha')
    expect(remote.list).toHaveBeenCalledWith({ repo: 'lib', dataset: 'alpha' })
    await face.overview('s1', 'lib')
    expect(remote.overview).toHaveBeenCalledWith({ repo: 'lib' })
    // T90: the review verbs name a proposal (or a registration's held version).
    await face.proposalReview('s1', 'p1')
    expect(remote.proposalReview).toHaveBeenCalledWith({ id: 'p1' })
    await face.reviewItem('s1', 'p1', 'alpha', 'i9')
    expect(remote.reviewItem).toHaveBeenCalledWith({ id: 'p1', set: 'alpha', item: 'i9' })
    const sets = { alpha: { layers: ['visible'] } }
    await face.confirmProposal('s1', 'p1', 'lib', sets)
    expect(remote.confirmProposal).toHaveBeenCalledWith({ id: 'p1', registryId: 'lib', sets })
    await face.confirmPending('s1', 'lib', 'abc', sets)
    expect(remote.confirmPending).toHaveBeenCalledWith({ repo: 'lib', commit: 'abc', sets })

    const query = { dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' }
    await face.readFile('s1', 'lib', query)
    expect(remote.read).toHaveBeenCalledWith({ ...query, repo: 'lib' })
  })

  it('the face routes the native directory pick through the workspaces service', async () => {
    const { ctx, slots, workspaces } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')
    expect(face.isLoopback).toBe(true)
    expect(face.hooks.hostDescription.getSnapshot()).toEqual({ canOpenPath: true })
    await expect(face.pickDirectory()).resolves.toBe('/picked')
    expect(workspaces.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('derives the host-facts hook from the connection generation on hosts without hostDescription (0.1.2)', async () => {
    const { ctx, slots } = await bench({ connectionSeat: 'alpha' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')
    expect(face.hooks.hostDescription.getSnapshot()).toEqual({ home: '/h' })
  })

  it('folds the canOpenWorkspacePath probe into the 0.1.2+ host facts, once, with a stable snapshot (T95)', async () => {
    const probe = vi.fn(async () => ({ ok: true, value: true }))
    const { ctx, slots } = await bench({ connectionSeat: 'alpha', canOpenWorkspacePath: probe })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const source = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1').hooks.hostDescription
    // Unasked until a view subscribes: the picker stays hidden meanwhile.
    expect(source.getSnapshot()).toEqual({ home: '/h' })
    const listener = vi.fn()
    const stop = source.subscribe(listener)
    source.subscribe(() => {})
    await vi.waitFor(() => expect(listener).toHaveBeenCalled())
    expect(source.getSnapshot()).toEqual({ home: '/h', canOpenPath: true })
    expect(source.getSnapshot()).toBe(source.getSnapshot())
    expect(probe).toHaveBeenCalledTimes(1)
    // Every session's view shares the one answer.
    const other = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1').hooks.hostDescription
    expect(other.getSnapshot()).toEqual({ home: '/h', canOpenPath: true })
    stop()
  })

  it('keeps canOpenPath missing when the probe fails or reports no desktop (T95)', async () => {
    for (const answer of [
      async () => ({ ok: false }),
      async () => { throw new Error('offline') },
      async () => ({ ok: true, value: false }),
    ]) {
      const { ctx, slots } = await bench({ connectionSeat: 'alpha', canOpenWorkspacePath: answer })
      await ctx.plugin({ inject: [...inject], apply }).await()
      const entry = slots.entries('conversation.view')[0]!
      const source = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1').hooks.hostDescription
      source.subscribe(() => {})
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(source.getSnapshot()?.canOpenPath === true).toBe(false)
    }
  })

  it('collapses the view entry on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.view')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  // T96 · the 「核对并登记」 entry in the organizing Turn's tail. The slot is
  // ui-chat's; without its declaration (or without uiConversation) nothing
  // registers and the proposal still waits behind the tab's banner.
  const declareTurnTail = (slots: SlotRegistry) => {
    slots.register({
      name: 'conversation.view',
      id: 'chat',
      children: { 'conversation.chat.turnTail': { kind: 'list', scope: 'session' } },
    } as never, () => null)
  }

  it('registers nothing in the Turn tail without uiConversation', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareTurnTail(slots)
    expect(slots.entries('conversation.chat.turnTail' as never)).toHaveLength(0)
  })

  it('registers the Turn definition and the tail entry once the host declares conversation.chat.turnTail', async () => {
    const { ctx, slots, remote } = await bench()
    const disposeDefinition = vi.fn()
    const events = { register: vi.fn(() => disposeDefinition) }
    ctx.provide('uiConversation', { events } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(events.register).not.toHaveBeenCalled()
    declareTurnTail(slots)
    expect(events.register).toHaveBeenCalledTimes(1)
    expect(events.register.mock.calls[0]![0]).toMatchObject({ kind: 'datasets-proposed' })
    const entries = slots.entries('conversation.chat.turnTail' as never)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: '@khorsheed/dsh-datasets/review' })
    // The tool row stays with the host's generic tool view.
    expect(slots.entries('tool.call.toolview' as never)).toHaveLength(0)

    const face = (entries[0]!.inject as unknown as (sessionId: string) => {
      loadPending: (id: string) => Promise<boolean | null>
      openReview: (id: string) => void
    })('s1')
    remote.proposals.mockResolvedValueOnce({ ok: true, value: [{ id: 'p1' }] })
    await expect(face.loadPending('p1')).resolves.toBe(true)
    expect(remote.proposals).toHaveBeenLastCalledWith()
    await expect(face.loadPending('p2')).resolves.toBe(false)
    remote.proposals.mockResolvedValueOnce({ ok: false, error: { code: 'X', message: 'x' } })
    await expect(face.loadPending('p1')).resolves.toBeNull()

    // The card's request reaches the datasets view of the SAME session.
    const view = (slots.entries('conversation.view').find(entry => entry.options.id === 'datasets')!.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')
    face.openReview('p1')
    expect(view.reviewFocus!.take('s2' as never)).toBeNull()
    expect(view.reviewFocus!.take('s1' as never)).toBe('p1')
    expect(view.reviewFocus!.take('s1' as never)).toBeNull()

    await fiber.dispose()
    expect(disposeDefinition).toHaveBeenCalledTimes(1)
    expect(slots.entries('conversation.chat.turnTail' as never)).toHaveLength(0)
  })

  // T97 · the global 「题集」 panel.
  describe('the global panel (T97)', () => {
    it('registers the sidebar entry and the main panel under one id when the host declares both slots', async () => {
      const { ctx, slots } = await bench({ globalPanels: true })
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()
      const icons = slots.entries('sidebar.panellist' as never)
      expect(icons).toHaveLength(1)
      expect(icons[0]!.options).toMatchObject({ id: 'datasets', order: 30 })
      expect((icons[0]!.options as unknown as { label: () => string }).label()).toBeTypeOf('string')
      const panels = slots.entries('main' as never)
      expect(panels).toHaveLength(1)
      expect(panels[0]!.options).toMatchObject({ key: 'datasets' })
      await fiber.dispose()
      expect(slots.entries('sidebar.panellist' as never)).toHaveLength(0)
      expect(slots.entries('main' as never)).toHaveLength(0)
    })

    it('registers neither without the slots (an older host): no entry, no error', async () => {
      const { ctx, slots } = await bench()
      await ctx.plugin({ inject: [...inject], apply }).await()
      expect(slots.entries('conversation.view')).toHaveLength(1)
      expect(() => slots.entries('sidebar.panellist' as never)).not.toThrow()
      expect(slots.entries('sidebar.panellist' as never)).toHaveLength(0)
      expect(slots.entries('main' as never)).toHaveLength(0)
    })

    it('stays registered in a session whose preset grants no dataset tools (install layer decides)', async () => {
      const { ctx, slots } = await bench({ globalPanels: true, preset: 'standard', composition: DEV })
      await ctx.plugin({ inject: [...inject], apply }).await()
      await settled()
      expect(slots.entries('conversation.view')).toHaveLength(0)
      expect(slots.entries('sidebar.panellist' as never)).toHaveLength(1)
      expect(slots.entries('main' as never)).toHaveLength(1)
    })

    it('hands the panel the same session-less face as the tab', async () => {
      const { ctx, slots, remote } = await bench({ globalPanels: true })
      await ctx.plugin({ inject: [...inject], apply }).await()
      const panelFace = (slots.entries('main' as never)[0]!.inject as unknown as () => DatasetsViewInjected)()
      const tabFace = (slots.entries('conversation.view')[0]!.inject as unknown as (sid: string) => DatasetsViewInjected)('s1')
      expect(panelFace).toBe(tabFace)
      await panelFace.fetchRegistry('' as SessionId)
      expect(remote.registry).toHaveBeenCalledWith()
      await panelFace.listDatasets('' as SessionId, 'lib')
      expect(remote.list).toHaveBeenCalledWith({ repo: 'lib' })
    })

    it('「添加题集」 from the panel opens a new session in the most recent workspace and drafts the request', async () => {
      const { ctx, slots } = await bench({ globalPanels: true, rows: { a1: { updatedAt: 10 }, b1: { updatedAt: 20 } } })
      const created = 'new1' as SessionId
      const setDraft = vi.fn()
      const rename = vi.fn(async () => {})
      const sessions = ctx.get('sessions') as unknown as Record<string, unknown>
      sessions.create = vi.fn(async () => created)
      sessions.using = vi.fn(async (_sid: unknown, _o: unknown, body: (ref: unknown) => Promise<unknown>) => body({ binding: { session: { rename } } }))
      sessions.scope = vi.fn(() => ({ get: () => ({ input: { for: () => ({ state: { getSnapshot: () => ({ draft: '' }) }, setDraft }) } }) }))
      const openSession = vi.fn()
      ctx.provide('uiWorkspace', { openSession } as never)
      ;(ctx.get('workspaces') as unknown as Record<string, unknown>).list = {
        getSnapshot: () => ({ items: [
          { workspaceId: 'wA', sessionIds: ['a1'] },
          { workspaceId: 'wB', sessionIds: ['b1'] },
        ] }),
      }
      await ctx.plugin({ inject: [...inject], apply }).await()
      const face = (slots.entries('main' as never)[0]!.inject as unknown as () => DatasetsViewInjected)()
      const outcome = await face.startOrganizing('' as SessionId, '题集整理', 'please add', '')
      expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'wB' })
      expect(rename).toHaveBeenCalledWith('题集整理')
      expect(openSession).toHaveBeenCalledWith(created)
      expect(setDraft).toHaveBeenCalledWith('please add')
      expect(outcome).toMatchObject({ kind: 'drafted', sessionId: created })
    })
  })

  describe('the T96 card routes to the global panel (T97)', () => {
    const declareTurnTail = (slots: SlotRegistry) => {
      slots.register({
        name: 'conversation.view',
        id: 'chat',
        children: { 'conversation.chat.turnTail': { kind: 'list', scope: 'session' } },
      } as never, () => null)
    }
    const cardFace = async (layout?: { selectPanel: (id: string | null) => void }) => {
      const { ctx, slots } = await bench({ globalPanels: true })
      ctx.provide('uiConversation', { events: { register: vi.fn(() => () => {}) } } as never)
      if (layout !== undefined) ctx.provide('layout', layout as never)
      await ctx.plugin({ inject: [...inject], apply }).await()
      declareTurnTail(slots)
      const face = (slots.entries('conversation.chat.turnTail' as never)[0]!.inject as unknown as (sid: string) => {
        openReview: (id: string) => boolean
      })('s1')
      const view = (slots.entries('main' as never)[0]!.inject as unknown as () => DatasetsViewInjected)()
      return { face, view }
    }

    it('selects the 题集 panel and leaves the request under the panel key', async () => {
      const selectPanel = vi.fn()
      const { face, view } = await cardFace({ selectPanel })
      expect(face.openReview('p1')).toBe(true)
      expect(selectPanel).toHaveBeenCalledWith('datasets')
      expect(view.reviewFocus!.take('s1' as never)).toBeNull()
      expect(view.reviewFocus!.take('' as never)).toBe('p1')
    })

    it('falls back to the session tab when selectPanel throws (panel not registered)', async () => {
      const { face, view } = await cardFace({ selectPanel: () => { throw new Error('no panel') } })
      expect(face.openReview('p1')).toBe(false)
      expect(view.reviewFocus!.take('' as never)).toBeNull()
      expect(view.reviewFocus!.take('s1' as never)).toBe('p1')
    })

    it('falls back to the session tab without a layout service', async () => {
      const { face, view } = await cardFace()
      expect(face.openReview('p1')).toBe(false)
      expect(view.reviewFocus!.take('s1' as never)).toBe('p1')
    })
  })
})
