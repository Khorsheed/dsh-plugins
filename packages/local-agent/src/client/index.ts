import { MemberFeeds } from './member-feed.ts'
/**
 * Local-agent records plugin, browser half: the member composer for delegated
 * CLI sessions, the shared settings-card building blocks the provider
 * packages compose (ProviderAuthBlock, the auth-status bus, AuthStatusDot),
 * and the「本机 Agent 委派」family card — ONE `plugins.item` entry on the
 * Plugins page that renders each harness's settings section, registered by
 * the provider packages through the localAgentUi service's
 * `registerHarnessCard` (a provider on a core predating the family card
 * keeps its own standalone card; this core alone shows the card with an
 * empty state). The card registers with the core client bundle itself —
 * no served-namespace gate: the whileServed convention only lists
 * namespaces whose Config has a volatile field, and this core's Config
 * has none, so its namespace never serves (the companions' sections keep
 * their own namespace gates).
 * Roster and status ride the read-only local-agent Remote
 * channel (no session events); only the user-initiated login/logout/preset
 * commands go through the commands Remote, whose visible command node is the
 * expected feedback. Delegation records live with the shared subagent
 * surface — there is no separate header dropdown, so kimi delegations appear
 * under the standard 子代理 list like every other subagent. The plugin holds
 * no host data — every open pulls fresh.
 */
import { createElement, type ReactNode } from 'react'
import { HarnessModelPicker, type HarnessModelPickerProps, type ModelDirectoryFace } from './HarnessModelPicker.tsx'
import { scopeDirectoryToList } from './model-directory-scope.ts'
import { LocalAgentFamilyCard, type FamilyCardInjected } from './FamilyCard.tsx'
import { HarnessCardRegistry, type HarnessCardRegistration } from './harness-cards.ts'
import { MemberConfiguration } from './MemberConfiguration.tsx'
import { BackgroundConfirm, runningBackgroundTasks as countRunning, type BackgroundConfirmInput } from './BackgroundConfirm.tsx'
import { MemberConfigurationStores } from './member-configuration.ts'
import { draftOf, selectionOf } from './member-selection.ts'
import { requestId } from './request-id.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the generated Remote API, the ctx.remote merge, and the
// locale Context merge.
import type {} from '@khorsheed/dsh-local-agent/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.slots service merge (renderer-owned slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'conversation.composer' SlotMap merge (chain registration).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import localAgentRemote from '@khorsheed/dsh-local-agent/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { MemberComposer, selectCliMember, type MemberComposerInjected } from './MemberComposer.tsx'
import { en, NS, zh, type LocalAgentKey } from './locales.ts'
import { memberLiveDefinition } from './live-node.ts'
import { MemberLiveNode, MemberLiveOutputView } from './MemberLiveNode.tsx'
import { MemberLiveOutputs } from './live-output.ts'

export type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
export { ProviderAuthBlock } from './ProviderAuthBlock.tsx'
export type { ProviderAuthBlockProps, ProviderAuthInjected } from './ProviderAuthBlock.tsx'
export { ModelListSection } from './ModelListSection.tsx'
export type { ModelListSectionListFace, ModelListSectionProps } from './ModelListSection.tsx'
export { AuthStatusDot } from './AuthStatusDot.tsx'
export type { AuthStatusDotProps } from './AuthStatusDot.tsx'
export { publishAuthStatus, useHarnessAuthStatus, resetAuthStatuses, readAuthStatus } from './auth-status.ts'
export type { HarnessAuthStatusKind } from './auth-status.ts'
export { HarnessCardRegistry } from './harness-cards.ts'
export { MemberToolRegistry, MemberContextStore, contextRatio } from './member-tools.ts'
export type { MemberToolFace, MemberToolPlacement, MemberToolRegistration } from './member-tools.ts'
import { MemberToolRegistry, MemberContextStore, type MemberToolPlacement, type MemberToolRegistration } from './member-tools.ts'
import { MemberTools } from './MemberTools.tsx'
export type { HarnessCardRegistration, HarnessCardRenderProps } from './harness-cards.ts'
export { LocalAgentFamilyCard } from './FamilyCard.tsx'
export type { FamilyCardInjected, LocalAgentFamilyCardProps } from './FamilyCard.tsx'
export type { MemberComposerInjected, MemberComposerMatch, MemberComposerProps } from './MemberComposer.tsx'
export { selectCliMember } from './MemberComposer.tsx'

/** The mounted local-agent gateway namespace, read back from the global store. */
export type LocalAgentGatewayRemote = TypertRemoteNamespaceMap['localAgentGateway']

/** Optional companion-facing renderer; consumers probe the service at gesture time. */
export type HarnessModelPickerInput = Omit<HarnessModelPickerProps, 'face' | 't'>
import { MemberInboxView, type MemberInboxFace } from './MemberInboxView.tsx'

/** A member's model + effort as an edit form's draft ('' = follow the default). */
export interface MemberSelectionDraft {
  readonly model: string
  readonly effort: string
  /** A round is in flight: a saved change waits for it to end. */
  readonly busy: boolean
}

/** Options of {@link LocalAgentUi.renderMemberOutput}. */
export interface MemberOutputOptions {
  readonly fileMentions?: MarkdownFileMentions | undefined
  /** Only output received at or after this time (epoch ms). */
  readonly since?: number | undefined
  /** Only output received before this time (epoch ms). */
  readonly until?: number | undefined
  /** Shown while the stretch has no live output. */
  readonly empty?: ReactNode | undefined
}

export interface LocalAgentUi {
  /**
   * A member's live output for one round (`startedAt` on). `since`/`until`
   * narrow it to a stretch of the round (`until` exclusive) — a room cuts a
   * round at the points it stopped for the human (room-timeline-order E1) —
   * and `empty` is shown while that stretch has no live output (a refresh
   * cannot bring back output that already finished).
   */
  renderMemberOutput(childSessionId: string, startedAt: number, options?: MemberOutputOptions): ReactNode
  renderMemberInbox(childSessionId: string): ReactNode
  renderHarnessModelPicker(name: string, props: HarnessModelPickerInput): ReactNode
  renderMemberConfiguration(childSessionId: string): ReactNode
  /**
   * An edit form's model fields for one member: the invite picker's model +
   * effort selects (pass `fields`) over the member's own directory. The form
   * owns the draft; {@link saveMemberSelection} applies it. Optional on the
   * TYPE: a room probes it and keeps {@link renderMemberConfiguration}
   * against a core that predates it.
   */
  renderMemberModelPicker?(childSessionId: string, props: HarnessModelPickerInput): ReactNode
  /**
   * The member's latest intent as the edit form's draft ('' = follow the
   * default), and whether a round is in flight (a save then waits for its
   * end). undefined = unreadable (no control yet, transport failure).
   */
  readMemberSelection?(childSessionId: string): Promise<MemberSelectionDraft | undefined>
  /**
   * Queue the draft through the member control, as the live control's pick
   * does: `deferred` = it waits for the running round to end.
   */
  saveMemberSelection?(childSessionId: string, draft: { readonly model: string; readonly effort: string }): Promise<{ readonly ok: true; readonly deferred: boolean } | { readonly ok: false; readonly error: string }>
  /**
   * The one in-place confirmation before an operation replaces a member's
   * process while it runs background work (「会让 N 项后台工作失去联系，继续吗？」
   * with 取消 / 继续; member-self-started-rounds C①). The member page's own
   * model control uses it; a room's reload line and edit dialog render it
   * through here. Optional on the TYPE: a room probes it and keeps its own
   * copy against a core that predates it.
   */
  renderBackgroundConfirm?(input: BackgroundConfirmInput): ReactNode
  /**
   * How many background tasks a member's live process runs right now (a
   * fresh read; 0 = none, no process, or unreadable).
   */
  runningBackgroundTasks?(childSessionId: string): Promise<number>
  /**
   * Register one harness's section in the family card; returns the
   * unregister. Optional on the TYPE because a companion may run against a
   * core that predates the family card: companions probe
   * `typeof ui.registerHarnessCard === 'function'` and keep their standalone
   * plugins.item card when it is absent. This core always provides it.
   */
  registerHarnessCard?(entry: HarnessCardRegistration): () => void
  /** The registered harness sections in display order (the family card's reading). */
  harnessCards?(): readonly HarnessCardRegistration[]
  /** The registry's useSyncExternalStore subscribe. */
  subscribeHarnessCards?(listener: () => void): () => void
  /**
   * Register a tool drawn beside a CLI member's context occupancy (the
   * compaction reminder's button and per-member ratio); returns the
   * unregister. Optional on the TYPE: a registrant probes it.
   */
  registerMemberTool?(entry: MemberToolRegistration): () => void
  /**
   * The member's input queue as a room shows it under its composer
   * (room-timeline B2): the room's own queued rows are left out — each sits
   * on its message in the room timeline — and the pause control moves to the
   * room's capsule; other callers' rows, failures and 待对账 stay. Optional
   * on the TYPE: a room probes it and falls back to {@link renderMemberInbox}.
   */
  renderRoomMemberInbox?(childSessionId: string): ReactNode
  /**
   * Pause or resume a member's input queue (the room's 「队列已暂停 · 继续」
   * capsule). Resolves to an error message, or undefined on success.
   */
  controlMemberQueue?(childSessionId: string, action: 'pause' | 'resume'): Promise<string | undefined>
  /**
   * A member's occupancy ring (`meter`) or one placement's registered tools,
   * for surfaces outside the member composer (a room's composer and members
   * popup). Renders nothing for a session that is not a family member.
   * `compact` replaces the direct `/compact` prompt: a surface that runs
   * compaction through its own pipeline (a room's dispatch, so the round gets
   * its card, its compaction row and its Context Lens request) passes it.
   */
  renderMemberTools?(childSessionId: string, placement: MemberToolPlacement | 'meter', options?: MemberToolsOptions): ReactNode
}
/** What a surface hands `renderMemberTools` about the member it shows. */
export interface MemberToolsOptions {
  readonly memberName?: string | undefined
  /** Compact through the surface's own pipeline; absent = prompt the member `/compact` directly. */
  readonly compact?: (() => Promise<void>) | undefined
}
declare module '@deepseek-ai/cordis' {
  interface Context { localAgentUi: LocalAgentUi }
}
export { ModelConfigurationFields } from './ModelConfigurationFields.tsx'
export type { BackgroundConfirmInput } from './BackgroundConfirm.tsx'
export type { ConfigurationTranslate } from './ModelConfigurationFields.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The local-agent settings section copy. */
    'local-agent': LocalAgentKey
  }
}

/** Required services: slot registry, the Remote channel, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: mount the local-agent Remote channel, register the
 * dictionaries, and put the member composer on the conversation chain.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    // The namespace is registered by $mount; `ctx.remote.localAgentGateway`
    // cannot see it (the property proxy walks the fiber chain, and the
    // namespace lives in the sibling fiber $mount spawned), so read it from
    // the global store once the mount has settled.
    disposers.push(await ctx.remote.$mount(localAgentRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (callers would answer an unmounted
    // namespace with a typed RPC error, which the surfaces render).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  const gateway = ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false }): T => {
    if (!result.ok) throw new Error('Configuration request failed')
    return result.value
  }
  const feeds = new MemberFeeds((requests, signal) => gateway.followMembers(requests, signal))
  ctx.effect(() => () => feeds.dispose(), 'local-agent: shared member feed')
  // A fresh read of the member's background tasks, for the confirmation
  // before an operation replaces its process: 0 when unreadable.
  const runningBackgroundTasks = async (id: string): Promise<number> => {
    try {
      const result = await gateway.memberBackgroundTasks(id)
      return result.ok ? countRunning(result.value) : 0
    } catch {
      return 0
    }
  }
  const configurations = new MemberConfigurationStores({
    read: async id => unwrap(await gateway.memberConfiguration(id)),
    follow: (id, signal) => feeds.follow(id, 'configuration', signal),
    directory: async (id, refresh) => unwrap(await gateway.memberDirectory(id, refresh)),
    followDirectory: (id, signal) => feeds.follow(id, 'directory', signal),
    select: async (id, request, revision, selection) => unwrap(await gateway.selectMemberConfiguration(id, request, revision, selection)),
    cancel: async (id, request, revision) => unwrap(await gateway.cancelMemberConfiguration(id, request, revision)),
    retry: async (id, revision) => { unwrap(await gateway.retryMemberConfiguration(id, revision)) },
    runningBackgroundTasks,
  })
  // One member's own directory in the picker's face shape (the edit form's
  // model fields read what the live control reads).
  const memberDirectoryFaces = new Map<string, ModelDirectoryFace>()
  const memberDirectoryFace = (id: string): ModelDirectoryFace => {
    let face = memberDirectoryFaces.get(id)
    if (face === undefined) memberDirectoryFaces.set(id, face = {
      read: async refresh => unwrap(await gateway.memberDirectory(id, refresh)),
      follow: signal => feeds.follow(id, 'directory', signal),
    })
    return face
  }
  const directoryFaces = new Map<string, ModelDirectoryFace>()
  const directoryFace = (name: string): ModelDirectoryFace => {
    let face = directoryFaces.get(name)
    if (face === undefined) directoryFaces.set(name, face = {
      read: async refresh => {
        const directory = unwrap(await gateway.modelDirectory(name, undefined, refresh))
        return directory === null ? null : scopeDirectoryToList(directory, unwrap(await gateway.modelList(name)))
      },
      follow: async function* (signal) {
        // The invite picker faces the curated list, not the raw served
        // catalog; re-read the list on each directory revision.
        let list = unwrap(await gateway.modelList(name))
        for await (const directory of gateway.followModelDirectory(name, undefined, signal)) {
          if (signal.aborted) return
          list = unwrap(await gateway.modelList(name))
          yield scopeDirectoryToList(directory, list)
        }
      },
    })
    return face
  }
  const inboxFaces = new Map<string, MemberInboxFace>()
  const inboxFace = (id: string): MemberInboxFace => {
    let face = inboxFaces.get(id)
    if (face === undefined) inboxFaces.set(id, face = {
      read: async () => unwrap(await gateway.memberInbox(id)),
      control: async (action, requestId) => unwrap(await gateway.controlMemberInbox(id, action, requestId)),
    })
    return face
  }
  const outputs = new MemberLiveOutputs((id, signal) => feeds.follow(id, 'output', signal))
  // The family card's section registry: companions register through the
  // service below, the plugins.item entry reads it reactively. Service-held,
  // never module-held — each client bundle inlines its own copy of these
  // sources, so only the cordis service is the shared instance.
  const harnessCards = new HarnessCardRegistry()
  const t = ctx.locale.bind(NS)
  const memberTools = new MemberToolRegistry()
  const memberContexts = new MemberContextStore(id => gateway.memberContext(id).then(result => (result.ok ? result.value : undefined), () => undefined))
  const compactMember = async (id: string): Promise<void> => {
    const result = await gateway.promptMember(id, '/compact', requestId())
    if (!result.ok) throw new Error(result.error.message)
    if (!result.value.ok) throw new Error(result.value.error)
  }
  const renderMemberTools = (id: string, placement: MemberToolPlacement | 'meter', options?: MemberToolsOptions): ReactNode =>
    createElement(MemberTools, {
      key: `${id}:${placement}`, childSessionId: id, placement, memberName: options?.memberName,
      store: memberContexts, registry: memberTools, compact: options?.compact === undefined ? compactMember : options.compact, t,
    })
  const configurationUi: LocalAgentUi = {
    renderMemberOutput: (id, startedAt, options) => createElement(MemberLiveOutputView, {
      key: `${id}:${startedAt}`, sessionId: id, startedAt, outputs,
      ...options?.fileMentions === undefined ? {} : { fileMentions: options.fileMentions },
      ...options?.since === undefined ? {} : { since: options.since },
      ...options?.until === undefined ? {} : { until: options.until },
      ...options?.empty === undefined ? {} : { empty: options.empty },
      t: ctx.locale.bind(NS),
    }),
    renderMemberInbox: id => createElement(MemberInboxView, { key: id, face: inboxFace(id), t: ctx.locale.bind(NS) }),
    renderHarnessModelPicker: (name, props) => createElement(HarnessModelPicker, { ...props, key: name, face: directoryFace(name), t: ctx.locale.bind(NS) }),
    renderMemberConfiguration: id => createElement(MemberConfiguration, { key: id, store: configurations.get(id), diagnostics: outputs.diagnostics, t: ctx.locale.bind(NS) }),
    renderMemberModelPicker: (id, props) => createElement(HarnessModelPicker, { ...props, key: `member:${id}`, face: memberDirectoryFace(id), t: ctx.locale.bind(NS) }),
    readMemberSelection: async (id) => {
      try {
        const state = await configurations.get(id).face.read(id)
        return { ...draftOf((state.pending ?? state.operation ?? state.current).selection, state.current.resolved), busy: state.round !== undefined }
      } catch {
        return undefined
      }
    },
    saveMemberSelection: async (id, draft) => {
      try {
        const store = configurations.get(id)
        const state = await store.face.read(id)
        const receipt = await store.face.select(id, requestId(), state.revision, selectionOf(draft))
        await store.refresh()
        if (['failed', 'conflict', 'locked', 'unsupported'].includes(receipt.status)) return { ok: false, error: receipt.error ?? ctx.locale.bind(NS)('configuration.failed') }
        return { ok: true, deferred: receipt.status === 'pending' }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    renderBackgroundConfirm: input => createElement(BackgroundConfirm, { ...input, t: ctx.locale.bind(NS) }),
    runningBackgroundTasks,
    registerHarnessCard: entry => harnessCards.register(entry),
    harnessCards: () => harnessCards.cards(),
    subscribeHarnessCards: listener => harnessCards.subscribe(listener),
    registerMemberTool: entry => memberTools.register(entry),
    renderMemberTools,
    renderRoomMemberInbox: id => createElement(MemberInboxView, { key: `room:${id}`, face: inboxFace(id), room: true, t: ctx.locale.bind(NS) }),
    controlMemberQueue: async (id, action) => {
      try {
        const result = await inboxFace(id).control(action)
        return result?.ok === true ? undefined : result?.error ?? ctx.locale.bind(NS)('member.sendFailed')
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
  }
  ctx.provide('localAgentUi', configurationUi)
  ctx.inject(['uiConversation'], lctx => { lctx.uiConversation.events.register(memberLiveDefinition) })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'local-agent-stream', locale: NS,
    inject: () => ({ outputs }),
  }, MemberLiveNode))
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-local-agent: dictionaries')
  // The member composer: a one-shot subagent session that the family delegated
  // gets a writable box (send = facade resume via the promptMember Remote);
  // any other one-shot session gets the same read-only panel the official
  // takeover would render. Priority -20 runs the selector before ui-subagent's
  // read-only takeover (-10) — chain election is ascending, first non-null
  // wins — and the degraded branch makes the takeover a strict subset of this
  // entry, so electing first never changes a non-member session's UX.
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({
      name: 'conversation.composer',
      priority: -20,
      locale: NS,
      select: selectCliMember,
      inject: (): MemberComposerInjected => ({
        renderMemberConfiguration: configurationUi.renderMemberConfiguration,
        renderMemberInbox: configurationUi.renderMemberInbox,
        renderMemberTools,
        memberOf: childSessionId => gateway.memberOf(childSessionId).then(result => (result.ok ? result.value : undefined)),
        promptMember: (childSessionId, text, requestId) => gateway.promptMember(childSessionId, text, requestId).then(result => (result.ok ? result.value : undefined)),
        stopMember: childSessionId => gateway.stopMember(childSessionId).then(result => (result.ok ? result.value : undefined)),
        activeDelegations: () => gateway.activeDelegations().then(result => (result.ok ? result.value : undefined)),
        memberModel: childSessionId => gateway.memberModel(childSessionId).then(result => (result.ok ? result.value : undefined)),
        setMemberModel: (childSessionId, model) => gateway.setMemberModel(childSessionId, model).then(result => (result.ok ? result.value : undefined)),
        runningBackgroundTasks,
      }),
    }, MemberComposer),
  )
  // The family card: ONE Plugins-page entry rendering every registered
  // harness section. Registered UNCONDITIONALLY, not gated on the core row's
  // served namespace like the companions' retired standalone cards: the
  // whileServed list only carries namespaces whose Config schema has a
  // volatile field, and this core's Config has none — gating on it meant the
  // card never mounted (and the new-core companions had already given up
  // their standalone seats, so no local-agent card rendered at all). The
  // client bundle loads only with the core row in the composition, so the
  // bundle's presence is the gate; a core whose server half failed simply
  // renders the sections' degraded states.
  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: 'local-agent',
    // Ahead of the harnesses' retired standalone cards (orders 110-140).
    order: 100,
    label: () => t('family.title'),
    locale: NS,
    inject: (): FamilyCardInjected => ({
      harnessCards,
      harnessStatus: name =>
        gateway?.status(name, undefined).then(result => (result.ok ? result.value : undefined))
          ?? Promise.resolve(undefined),
    }),
  }, LocalAgentFamilyCard))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
