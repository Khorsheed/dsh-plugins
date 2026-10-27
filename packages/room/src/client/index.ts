/**
 * room client plugin, browser half. Mounts the room Remote through the
 * official `ctx.remote.$mount` channel, feeds the client-side RoomStore, and
 * registers the slot entries: the session-header「邀请 agent」action and the
 * 成员 `conversation.view` tab — both self-hiding by the current session's
 * preset composition (M3': visible exactly when the composition names the
 * `@khorsheed/dsh-room/tool` row, fail-open on every unreadable path, and
 * always visible inside an actual room) — plus the `conversation.composer`
 * chain takeover (claims the composer exactly when the current session is a
 * cached room — and renders the dock capsules plus the session stats row
 * itself, because both of their official homes ride the fallback tree the
 * takeover hides). Composing this
 * plugin out of cordis.yml removes every surface it adds.
 * @module @khorsheed/dsh-room/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API merge for the room namespace.
import type {} from '@khorsheed/dsh-room/remote'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer',
// 'conversation.view', 'conversation.session.header.actions').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.node').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the ctx.slots service merge (SlotRegistry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import roomRemote from '@khorsheed/dsh-room/remote'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { LocalAgentUi } from '@khorsheed/dsh-local-agent/client'
import type { LocalAgentModelInfo, LocalAgentPromptResult } from '@khorsheed/dsh-local-agent/types'
import { RoomRequestIds } from './request-ids.ts'
import { en, zh } from './locales.ts'
import { InviteAgentAction } from './InviteAgentAction.tsx'
import { MembersView } from './MembersView.tsx'
import { RoomComposer, roomInteractionKey, selectRoomComposer } from './RoomComposer.tsx'
import { ROOM_TASKS_KIND, ROOM_TASKS_TAB_ID, RoomTasksTab, type RoomTasksInjected } from './TasksTab.tsx'
import { RoomTaskTags } from './task-tag.ts'
import { RoomSpeechView } from './RoomSpeechView.tsx'
import { RoomRunView } from './RoomRunView.tsx'
import { RoomEventView } from './RoomEventView.tsx'
import { roomApprovalDefinition, roomDecisionDefinition, roomHelpDefinition, roomHelpInDefinition, roomHelpRequestDefinition, roomQuestionDefinition, roomEventDefinition, roomRelayDefinition, roomInboxDefinition, roomRunDefinition, roomSpeechDefinition } from './nodes.ts'
import { mainSessionId, RoomStore } from './room-store.ts'
import { RoomPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { RoomRelayView } from './RoomRelayView.tsx'
import { RoomInboxView } from './RoomInboxView.tsx'
import { RoomApprovalView } from './RoomApprovalView.tsx'
import { RoomQuestionView } from './RoomQuestionView.tsx'
import { RoomDecisionView } from './RoomDecisionView.tsx'
import { RoomHelpRequestView, RoomHelpView } from './RoomHelpView.tsx'
import { sessionTitle, type RoomMenuMember, type SessionCandidate } from './at-menu.ts'
import type {
  InviteAgentInjected, RoomComposerInjected, RoomComposerMatch, RoomInviteInjected, RoomMembersInjected, RoomModelDirectory, RoomMutationOutcome,
  RoomRelayInjected, RoomInboxInjected, RoomRunInjected, RoomSpeechInjected, RoomGoalInjected, RoomApprovalInjected, RoomQuestionInjected, RoomDecisionInjected, RoomHelpInjected,
  RoomAttachmentsFace, RoomDraftAttachment,
} from './slots.ts'
import type { RoomAttachmentInput } from '../types.ts'
import type { RoomFailure } from '../types.ts'

/** The room Remote namespace, as mounted by this plugin. */
export type RoomRemote = TypertRemoteNamespaceMap['room']

/** Dictionary namespace owned by this plugin. */
const NS = 'room'

/** The input-trigger service's chip-preview route, mirrored (probed, never imported). */
interface InputTriggersMirror {
  sessionOf(scope: unknown): { openReference(source: string | undefined, reference: { readonly ref: string }): boolean }
}

/**
 * Required services: slots, sessions, the remote channel, and the locale
 * service. `remote.room` is deliberately NOT an inject: this plugin both
 * mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber — declaring it would deadlock the loader.
 * The event-Definition registry (`uiConversation.events`) is likewise NOT a
 * static inject: the deferred ctx.inject arm keeps the registration
 * independent of ui-conversation's mount order. The native directory picker
 * (uiWorkspace) is probed at gesture time, never injected.
 */
export const inject = ['slots', 'sessions', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, start the store, register the
 * dictionaries, and inject the slot entries.
 * @param ctx - client root context.
 * @returns disposer unwinding the mounted Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(roomRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the action would answer an
    // unmounted namespace with a typed RPC error).
    ctx.logger.error(error)
  }
  const remote = ctx.get('remote.room') as RoomRemote | undefined

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'room: dictionaries')
  const t = ctx.locale.bind(NS)
  // The host's agent-preset dictionary (ui-agent-preset) carries the shipped
  // modes' names; an unregistered key reads back as itself — fall back to the id.
  const hostPresetCopy = (ctx.locale.bind as (ns: string) => (key: string) => string)('settings.agentPreset')
  const presetCopy = (key: string): string => {
    const text = hostPresetCopy(key)
    return text === key ? '' : text
  }

  const roomStore = new RoomStore(ctx, remote)
  ctx.effect(() => roomStore.start(), 'room: store')

  // The M3' self-hide criterion for room's session chrome (the invite chip
  // and the members tab): the official preset-composition data, with the
  // RoomStore's cached verdict as the actual-room escape.
  const roomChrome = new RoomPresetVisibility(ctx, sessionId => roomStore.isRoomCached(sessionId) === true)

  const requestIds = new RoomRequestIds()
  // The official conversation service's draft attachments (pick, upload,
  // serialize): the room composer re-uses them so its attachments behave
  // exactly like the official composer's. A host without them: no attachments.
  // Read per inject, never once at apply: the conversation service may come up after this plugin.
  const attachmentsFor = (): RoomAttachmentsFace | undefined => {
    const conversation = (ctx.get as (name: string) => unknown)('conversation') as {
      createDrafts?: (sessionId: SessionId, files: readonly File[]) => readonly RoomDraftAttachment[]
      resolveDraftAttachments?: (ids: readonly string[]) => readonly RoomDraftAttachment[]
      releaseDraftAttachment?: (id: string) => void
      retryFileUpload?: (sessionId: SessionId, id: string) => void
      fileUploads?: RoomAttachmentsFace['uploads']
      serializeDraftAttachments?: (ids: readonly string[]) => Promise<{ readonly attachments: readonly RoomAttachmentInput[] }>
    } | undefined
    const attachmentsFace: RoomAttachmentsFace | undefined = conversation?.createDrafts === undefined || conversation.resolveDraftAttachments === undefined
      || conversation.releaseDraftAttachment === undefined || conversation.retryFileUpload === undefined
      || conversation.fileUploads === undefined || conversation.serializeDraftAttachments === undefined
      ? undefined
      : {
        create: (sessionId, files) => conversation.createDrafts!.call(conversation, sessionId, files),
        resolve: ids => conversation.resolveDraftAttachments!.call(conversation, ids),
        release: (id) => { conversation.releaseDraftAttachment!.call(conversation, id) },
        retry: (sessionId, id) => { conversation.retryFileUpload!.call(conversation, sessionId, id) },
        uploads: conversation.fileUploads,
        serialize: async ids => (await conversation.serializeDraftAttachments!.call(conversation, ids)).attachments,
      }

    return attachmentsFace
  }
  const submit = async (sessionId: SessionId, text: string, targets?: readonly string[], task?: string, attachments?: readonly RoomAttachmentInput[]): Promise<RoomMutationOutcome> => {
    if (remote === undefined) return { ok: false, message: t('composer.error.generic') }
    const requestId = requestIds.forInput(sessionId, text, targets)
    const carried = await remote.postMessage({
      sessionId, text, requestId, ...targets === undefined || targets.length === 0 ? {} : { targets },
      ...task === undefined ? {} : { task },
      ...attachments === undefined || attachments.length === 0 ? {} : { attachments },
    })
    if (!carried.ok) return { ok: false, message: t('composer.error.generic') }
    const result = carried.value
    if (!result.ok) {
      return result.error.code === 'unknown-targets'
        ? { ok: false, message: t('composer.error.unknownTargets', { names: result.error.names.join(' ') }) }
        : result.error.code === 'attachment-invalid'
          ? { ok: false, message: t('composer.error.attachment', { reason: result.error.message }) }
          : { ok: false, message: t('composer.error.generic') }
    }
    requestIds.complete(sessionId, requestId)
    void roomStore.refresh(sessionId)
    return { ok: true }
  }

  // alpha.2 deleted sessions.open; uiWorkspace.openSession is the entry on
  // both lines (0.1.5 navigation.ts:134, alpha.2 navigation.ts:161) and
  // throws synchronously on a target the runtime cannot retain — a torn-down
  // member session degrades to staying on the current view. Probed at
  // gesture time like browseDirectory, never injected.
  const openSession = (sessionId: SessionId): void => {
    const uiWorkspace = ctx.get('uiWorkspace') as { openSession?: (target: SessionId) => void } | undefined
    try {
      uiWorkspace?.openSession?.(sessionId)
    } catch {
      // An unopenable target leaves the current view in place.
    }
  }
  // The official per-session model directories (ui-model-selection's public
  // client service, augmented onto Context by that plugin): the composer's
  // main-agent model picker resolves the SAME directory the official model
  // seat renders, so its select() writes exactly the official seat's durable
  // per-session selection. Probed once — a host without the plugin gets no
  // picker (duck-type guard, never an inject: absence must not fail the boot).
  const modelDirectories = (() => {
    const candidate = ctx.get('modelDirectories') as { directoryFor?: unknown } | undefined
    return candidate !== undefined && typeof candidate.directoryFor === 'function'
      ? candidate as { directoryFor: (sessionId: SessionId) => RoomModelDirectory }
      : undefined
  })()
  /** The room session's own directory; undefined degrades to no picker. */
  const modelDirectoryFor = (sessionId: SessionId): RoomModelDirectory | undefined => {
    if (modelDirectories === undefined) return undefined
    // directoryFor fails loud on an unknown session — a resolving race must
    // never break the composer inject.
    try {
      return modelDirectories.directoryFor(sessionId)
    } catch {
      return undefined
    }
  }
  const cancelMember = async (sessionId: SessionId, member: string): Promise<void> => {
    if (remote === undefined) return
    const carried = await remote.cancel({ sessionId, name: member })
    if (carried.ok) void roomStore.refresh(sessionId)
  }
  /** The relay gate actions (sessionId binds per entry inject). */
  const relayFace = (sessionId: SessionId): RoomRelayInjected => ({
    roomStore,
    confirmRelay: async (relayId) => {
      if (remote === undefined) return
      const carried = await remote.confirmRelay({ sessionId, relayId })
      if (carried.ok) void roomStore.refresh(sessionId)
    },
    dismissRelay: async (relayId) => {
      if (remote === undefined) return
      const carried = await remote.dismissRelay({ sessionId, relayId })
      if (carried.ok) void roomStore.refresh(sessionId)
    },
  })

  /** The goal action (sessionId binds per entry inject). */
  const goalFace = (sessionId: SessionId): RoomGoalInjected => ({
    roomStore,
    setGoal: async (text) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.setGoal({ sessionId, text })
      if (!carried.ok || !carried.value.ok) return { ok: false, message: t('invite.error.generic') }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
  })
  const taskTags = new RoomTaskTags()

  /** Map a structured RoomFailure to the dialog's localized copy. */
  const failureText = (error: RoomFailure): string => {
    switch (error.code) {
      case 'coordinator-busy': return t('coordinator.busy')
      case 'coordinator-not-ready': return error.message
      case 'coordinator-conflict': return t('coordinator.conflict')
      case 'active-coordinator': return t('coordinator.active')
      case 'member-cwd-bound': return t('coordinator.cwdBound')
      case 'main-member': return t('coordinator.nativeRequired')
      case 'configuration-owned-by-core': return t('coordinator.configuration')
      case 'duplicate-name': return t('invite.error.duplicate')
      case 'invalid-name': return t('invite.error.invalid')
      case 'role-too-long': return t('invite.error.roleTooLong')
      case 'local-agent-unavailable': return t('invite.error.unavailable')
      case 'unknown-provider':
        return t('invite.error.unknownProvider', {
          provider: error.provider,
          available: error.available.join(', ') || '—',
        })
      default: return t('invite.error.generic')
    }
  }
  /**
   * The invite dialog's share (sessionId binds per entry inject), consumed by
   * both dialog hosts — the members tab and the fresh-room dock's invite
   * capsule. `browseDirectory` is the official wire primitive the native
   * directory-picker flow drives (`workspaces.pickDirectory`): the picker UI
   * itself is bound to ui-workspace's adopt-as-workspace flow holes and cannot
   * serve a pure path pick, so the dialog consumes the primitive directly.
   */
  const inviteFace = (sessionId: SessionId): RoomInviteInjected => ({
    renderHarnessModelPicker: (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderHarnessModelPicker,
    // The room session's own cwd: the invite dialog's cwd field placeholder
    // (empty = inherit). Read at inject time; a later cwd change refreshes
    // with the next view mount.
    roomCwd: ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
    invite: async (values) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.invite({ sessionId, ...values })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true, pendingFirstTask: carried.value.value.pendingFirstTask }
    },
    listProviders: async (sessionId) => {
      if (remote === undefined) return undefined
      const carried = await remote.listProviders(sessionId === undefined ? {} : { sessionId })
      if (!carried.ok) return undefined
      // Mode names as the host's own mode selector shows them: shipped modes
      // (标准模式, PTC 模式 …) from the host's dictionary, others as declared.
      const value = carried.value
      return value.presets === undefined ? value : {
        ...value,
        presets: value.presets.map((row) => {
          const shown = presetDisplayText(row, presetCopy)
          return { ...row, name: shown.name || row.name || row.id, ...shown.description ? { description: shown.description } : {} }
        }),
      }
    },
    browseDirectory: () => {
      // Host 0.1.2 hangs the native picker on ui-workspace's service (the
      // rc-era workspaces.pickDirectory wire primitive moved there,
      // commit be531688f3). Absent service = the picker's cancel value.
      const uiWorkspace = ctx.get('uiWorkspace') as { pickDirectory(): Promise<string | null> } | undefined
      return uiWorkspace?.pickDirectory() ?? Promise.resolve(null)
    },
    listNames: () => roomStore.getCached(sessionId)?.members.map(member => member.name) ?? [],
    modelSurface: async (harness) => {
      // The localAgentGateway namespace belongs to the local-agent family's
      // client half: a composition without it (or a brokerless harness)
      // answers undefined and the invite dialog keeps a plain text input.
      const gateway = ctx.get('remote.localAgentGateway') as Record<string, unknown> | undefined
      if (gateway === undefined || typeof gateway['harnessModel'] !== 'function') return undefined
      const harnessModel = gateway['harnessModel'] as
        (name: string) => Promise<{ readonly ok: true; readonly value: LocalAgentModelInfo | null } | { readonly ok: false }>
      try {
        const carried = await harnessModel(harness)
        return carried.ok && carried.value !== null ? carried.value : undefined
      } catch {
        return undefined
      }
    },
    roomChrome,
  })
  // The team page lives in the right sidebar; without it the members tab
  // simply shows no 团队 entry.
  const teamSidebar = ctx.get('sidebarRightTabs') === undefined ? undefined : ctx.get('sidebarRight')
  // Outside sessions on the member list (「加入房间成员」) and the third ask's hint.
  const linkFace = (sessionId: SessionId) => ({
    linkSession: (target: string, title: string) => { void remote?.linkSession({ sessionId, target, title }).then(() => roomStore.refresh(sessionId)) },
    unlinkSession: (target: string) => { void remote?.unlinkSession({ sessionId, target }).then(() => roomStore.refresh(sessionId)) },
    dismissNudge: (target: string) => { void remote?.dismissHelpNudge({ sessionId, target }).then(() => roomStore.refresh(sessionId)) },
  })
  const membersFace = (sessionId: SessionId): RoomMembersInjected => ({
    roomStore,
    unlinkSession: linkFace(sessionId).unlinkSession,
    // 团队 is the collaboration page's second view (one sidebar page, two switches).
    ...teamSidebar === undefined ? {} : { openTeam: (member?: string) => { teamSidebar.openTab(ROOM_TASKS_KIND, { params: { view: 'team', ...member === undefined ? {} : { member } } }) } },
    setCoordinator: async (memberId, expectedRevision) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.setCoordinator({ sessionId, memberId, expectedRevision })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      await roomStore.refresh(sessionId)
      return { ok: true }
    },
    renderMemberConfiguration: (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderMemberConfiguration,
    ...inviteFace(sessionId),
    // The localAgentGateway member model surface (the family client half's
    // namespace, probed lazily like the invite dialog's harnessModel read):
    // the member cards' model hints and the edit dialog's model field. A
    // composition without it answers undefined — no hints, no broker call.
    memberModel: async (childSessionId) => {
      const gateway = ctx.get('remote.localAgentGateway') as Record<string, unknown> | undefined
      if (gateway === undefined || typeof gateway['memberModel'] !== 'function') return undefined
      try {
        const carried = await (gateway['memberModel'] as
          (child: string) => Promise<{ readonly ok: true; readonly value: LocalAgentModelInfo | null } | { readonly ok: false }>)(childSessionId)
        return carried.ok ? carried.value : undefined
      } catch {
        return undefined
      }
    },
    setMemberModel: async (childSessionId, model) => {
      const gateway = ctx.get('remote.localAgentGateway') as Record<string, unknown> | undefined
      if (gateway === undefined || typeof gateway['setMemberModel'] !== 'function') return undefined
      try {
        const carried = await (gateway['setMemberModel'] as
          (child: string, value?: string) => Promise<{ readonly ok: true; readonly value: LocalAgentPromptResult } | { readonly ok: false }>)(childSessionId, model)
        return carried.ok ? carried.value : undefined
      } catch {
        return undefined
      }
    },
    modelDirectory: modelDirectoryFor(sessionId),
    openSession,
    removeMember: async (member) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.removeMember({ sessionId, name: member })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true, value: carried.value.value }
    },
    setSettings: async (patch) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.setSettings({ sessionId, ...patch })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    restoreMember: async (member) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.restoreMember({ sessionId, name: member })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    updateMember: async (member, patch) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.updateMember({
        sessionId,
        name: member,
        ...patch.rename === undefined ? {} : { rename: patch.rename },
        ...patch.instructions === undefined ? {} : { instructions: patch.instructions },
        ...patch.role === undefined ? {} : { role: patch.role },
        ...patch.cwd === undefined ? {} : { cwd: patch.cwd },
        ...patch.model === undefined ? {} : { model: patch.model },
        ...patch.effort === undefined ? {} : { effort: patch.effort },
      })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
  })

  // The journal projections: claim the room/* events into chat nodes. Host
  // 0.1.2 folded the event-Definition registry into `uiConversation.events`
  // (commit be531688f3); the deferred arm never fires in a composition
  // without the service, losing only the room chat rows, never the boot.
  // The session list's 等你处理: a room's waiting question/approval cards are
  // published as the host's pending interactions (lowest precedence, so an
  // official approval in the same session still wins). The host tracks the
  // cards of every live room; a light poll keeps the list current.
  ctx.inject(['uiSession'], (sctx) => {
    if (remote === undefined) return
    const uiSession = (sctx as unknown as { uiSession: { registerPendingInteraction?: <T extends { readonly key: string; readonly kind: string; readonly sessionId: SessionId }>(precedence: (interaction: T) => number) => (interaction: T, delegate: () => Promise<void>) => () => void } }).uiSession
    if (uiSession.registerPendingInteraction === undefined) return
    const publish = uiSession.registerPendingInteraction(() => -1)
    const shown = new Map<string, () => void>()
    const sync = async (): Promise<void> => {
      const carried = await remote.pendingCards({}).catch(() => undefined)
      if (carried === undefined || !carried.ok) return
      const keys = new Set(carried.value.map(card => roomInteractionKey(card.kind, card.id)))
      for (const [key, remove] of shown) {
        if (keys.has(key)) continue
        remove()
        shown.delete(key)
      }
      for (const card of carried.value) {
        const key = roomInteractionKey(card.kind, card.id)
        if (!shown.has(key)) shown.set(key, publish({ key, kind: card.kind, sessionId: card.sessionId as SessionId }, async () => {}))
      }
    }
    void sync()
    const timer = setInterval(() => { void sync() }, 4_000)
    sctx.effect(() => () => {
      clearInterval(timer)
      for (const remove of shown.values()) remove()
      shown.clear()
    }, 'room: pending cards')
  })
  ctx.inject(['uiConversation'], (lctx) => {
    lctx.uiConversation.events.register(roomSpeechDefinition)
    lctx.uiConversation.events.register(roomRunDefinition)
    lctx.uiConversation.events.register(roomEventDefinition)
    lctx.uiConversation.events.register(roomRelayDefinition)
    lctx.uiConversation.events.register(roomInboxDefinition)
    lctx.uiConversation.events.register(roomApprovalDefinition)
    lctx.uiConversation.events.register(roomQuestionDefinition)
    lctx.uiConversation.events.register(roomDecisionDefinition)
    lctx.uiConversation.events.register(roomHelpDefinition)
    lctx.uiConversation.events.register(roomHelpRequestDefinition)
    lctx.uiConversation.events.register(roomHelpInDefinition)
  })

  // The slots are declared by ui-conversation, whose apply order
  // relative to this plugin is unconstrained: register through slots.inject so
  // each entry waits for the declaration instead of crashing the loader entry
  // at boot.
  // The 邀请 agent entry: every session's header carries it (inviting a plain
  // session promotes it into a room host-side). Ordered after the lineage and
  // jobs entries.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'room-invite-agent',
      order: 30,
      locale: NS,
      inject: (sessionId: SessionId): InviteAgentInjected => inviteFace(sessionId),
    },
    InviteAgentAction,
  ))
  // The composer takeover: claim exactly the cached-room sessions, at the
  // ui-subagent precedence (-10). Pending interactions (the approval panel's
  // priority-1 entry) are yielded by the selector itself — election runs
  // ascending, so without the decline this entry would shadow them (the
  // member-channel rule, local-agent 84a2ed0). A cache miss declines — the
  // freshly opened room shows the official bar for the first pull's duration
  // (accepted, see room-store.ts). The injected face carries the capsule
  // actions, the invite share (the fresh-room dock's invite capsule), AND the
  // main-agent turn Stop: the takeover renders the dock
  // surfaces and the Stop button itself, because their seats hide with the
  // official fallback.
  const reconcileFor = (sessionId: SessionId) => async (deliveryId: string, outcome: 'done' | 'cancelled', evidence: string): Promise<RoomMutationOutcome> => {
    const result = await remote?.reconcileDelivery({ sessionId, deliveryId, outcome, evidence })
    await roomStore.refresh(sessionId)
    return result?.ok && result.value.ok ? { ok: true } : { ok: false, message: result?.ok && !result.value.ok ? result.value.error.code : t('composer.error.generic') }
  }
  /** The task page's actions (sessionId binds per entry inject). */
  const tasksFace = (sessionId: SessionId): RoomTasksInjected => ({
    ...goalFace(sessionId),
    linkSession: linkFace(sessionId).linkSession,
    unlinkSession: linkFace(sessionId).unlinkSession,
    taskTags,
    stopJob: async (task) => {
      const carried = await remote?.stopJob({ sessionId, task })
      await roomStore.refresh(sessionId)
      return carried?.ok && carried.value.ok ? { ok: true } : { ok: false, message: t('composer.error.generic') }
    },
    stopDelivery: (member, deliveryId) => {
      void remote?.cancel({ sessionId, name: member, ...deliveryId === undefined ? {} : { expectedRunId: deliveryId } }).then(() => roomStore.refresh(sessionId))
    },
    reconcile: reconcileFor(sessionId),
    confirmRelay: relayFace(sessionId).confirmRelay,
    dismissRelay: relayFace(sessionId).dismissRelay,
    planCommand: async command => {
      const result = await remote?.planCommand({ sessionId, command })
      await roomStore.refresh(sessionId)
      return result?.ok && result.value.ok ? { ok: true } : { ok: false, message: result?.ok && !result.value.ok ? result.value.message : t('composer.error.generic') }
    },
    openSession: id => openSession(id as SessionId),
  })
  const sidebar = ctx.get('sidebarRight')
  const sidebarTabs = ctx.get('sidebarRightTabs')
  // The @ menu's other sessions: the host's session-reference candidates
  // (the recent list merged with the query's own lookup), each flagged when
  // it is a room (probed once per session and remembered).
  const roomFlags = new Map<string, Promise<boolean>>()
  const roomFlag = (id: string): Promise<boolean> => {
    let flag = roomFlags.get(id)
    if (flag === undefined) {
      flag = (remote?.isRoom({ sessionId: id as SessionId }) ?? Promise.resolve(undefined))
        .then(carried => carried?.ok === true && carried.value === true)
        .catch(() => false)
      roomFlags.set(id, flag)
    }
    return flag
  }
  const memberLists = new Map<string, { readonly at: number; readonly members: Promise<readonly RoomMenuMember[]> }>()
  const roomMembers = (id: string): Promise<readonly RoomMenuMember[]> => {
    const cached = memberLists.get(id)
    if (cached !== undefined && Date.now() - cached.at < 30_000) return cached.members
    const members = (remote?.getState({ sessionId: id as SessionId }) ?? Promise.resolve(undefined))
      .then(carried => carried?.ok === true && carried.value.ok
        ? carried.value.value.members.map(member => ({ name: member.name, kind: member.kind, ...member.provider === undefined ? {} : { provider: member.provider } }))
        : [])
      .catch(() => [])
    memberLists.set(id, { at: Date.now(), members })
    return members
  }
  const listSessionsFor = async (sessionId: SessionId, query: string, signal: AbortSignal): Promise<readonly SessionCandidate[]> => {
    // A Remote call resolves to a RemoteResult ({ ok, value }), never the bare list.
    const resolver = ctx.get('remote.sessionReferenceResolver') as {
      candidates?(sessionId: SessionId, query: string, signal: AbortSignal): Promise<{ readonly ok: boolean; readonly value?: readonly SessionCandidate[] }>
    } | undefined
    if (resolver?.candidates === undefined) return []
    const lookup = (text: string): Promise<readonly SessionCandidate[]> => resolver.candidates!(sessionId, text, signal)
      .then(result => result.ok && Array.isArray(result.value) ? result.value : [])
    const [recent, matched] = await Promise.all([lookup(''), query === '' ? Promise.resolve([]) : lookup(query)])
    // Archived sessions cannot be opened or woken: never offer one.
    const workspaces = ctx.get('workspaces') as { list?: { getSnapshot?: () => { archivedSessionIds?: readonly string[] } } } | undefined
    const archived = new Set(workspaces?.list?.getSnapshot?.().archivedSessionIds ?? [])
    const merged = [...recent, ...matched].filter(candidate => !archived.has(candidate.sessionId))
    const flags = await Promise.all(merged.map(candidate => roomFlag(candidate.sessionId)))
    // A room carries its members (askable by name): one getState per room, kept 30s.
    return Promise.all(merged.map(async (candidate, index) => flags[index] === true
      ? { ...candidate, room: true, members: await roomMembers(candidate.sessionId) }
      : candidate))
  }
  const composerEntry = {
    name: 'conversation.composer',
    priority: -10,
    locale: NS,
    select: (owner: Parameters<typeof selectRoomComposer>[0]): RoomComposerMatch | null =>
      selectRoomComposer(owner, id => roomStore.isRoomCached(id) === true),
    inject: (sessionId: SessionId): RoomComposerInjected => ({
      ...goalFace(sessionId),
      ...inviteFace(sessionId),
      reconcileDelivery: reconcileFor(sessionId),
      openPlanSession: id => openSession(id as SessionId),
      ...sidebar === undefined || sidebarTabs === undefined ? {} : {
        openTasks: (task?: string) => { sidebar.openTab(ROOM_TASKS_KIND, { params: { view: 'tasks', ...task === undefined ? {} : { task } } }) },
      },
      taskTags,
      submit,
      ...(() => { const face = attachmentsFor(); return face === undefined ? {} : { attachments: face } })(),
      renderMemberConfiguration: (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderMemberConfiguration,
      renderMemberInbox: (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderMemberInbox,
      stopMember: (name, expectedRunId) => { void remote?.cancel({ sessionId, name, ...expectedRunId === undefined ? {} : { expectedRunId } }).then(() => roomStore.refresh(sessionId)) },
      modelDirectory: modelDirectoryFor(sessionId),
      // A draft chip's preview: the official editor's chip click routes
      // through the session's input-trigger controller to the chip's owning
      // source — probed at click time, so a composition without the service
      // (or a torn-down scope) just declines.
      ...ctx.get('remote.sessionReferenceResolver') === undefined ? {} : {
        listSessions: (query: string, signal: AbortSignal) => listSessionsFor(sessionId, query, signal),
        insertSessionReference: (candidate: SessionCandidate, span: { start: number; end: number; draftRev: number }) => {
          try {
            const scope = ctx.sessions.scope(sessionId) as { bail?: (thisArg: unknown, name: string, request: unknown) => unknown } | undefined
            if (scope?.bail === undefined) return false
            return scope.bail(scope, 'slash/input-insert-reference', {
              reference: { source: 'reference', ref: candidate.mention, label: sessionTitle(candidate), appearance: 'session', clipboardText: candidate.mention },
              span,
            }) === true
          } catch {
            return false
          }
        },
      },
      openReference: (source, ref) => {
        try {
          const scope = ctx.sessions.scope(sessionId)
          const triggers = ctx.get('inputTriggers') as InputTriggersMirror | undefined
          if (scope === undefined || triggers === undefined) return false
          return triggers.sessionOf(scope).openReference(source, { ref })
        } catch {
          return false
        }
      },
      // The hidden official bar's Stop: the runtime session face's cancel
      // (the same verb ui-conversation's own Stop injects). A torn-down
      // binding degrades to a no-op.
      stop: () => {
        void ctx.sessions.binding(sessionId)?.session.cancel().catch(() => {
          // Stop failure surfaces via snapshot.promptError; nothing to restore.
        })
      },
    }),
  } as const
  if (sidebar !== undefined && sidebarTabs !== undefined) {
    const tasksToggle = new RegistrationToggle(
      () => sidebarTabs.register({ id: ROOM_TASKS_TAB_ID, kind: ROOM_TASKS_KIND, title: () => t('collab.title') }),
      () => roomChrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    tasksToggle.setReady(true)
    const unsubscribe = roomChrome.subscribe(() => tasksToggle.sync())
    disposers.push(async () => { unsubscribe(); tasksToggle.setReady(false) })
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: ROOM_TASKS_TAB_ID, locale: NS,
      inject: (sessionId: SessionId): RoomTasksInjected => tasksFace(sessionId),
    }, RoomTasksTab))
  }
  let composerDispose: (() => void) | undefined
  ctx.slots.inject('conversation.composer', () => {
    composerDispose = ctx.slots.register(composerEntry, RoomComposer)
    return () => {
      composerDispose?.()
      composerDispose = undefined
    }
  })
  // An in-place promotion of an idle session produces no session frames after
  // the store's flip, and the chain elects at render time — re-registering
  // the entry bumps the slot version, re-rendering and re-electing the
  // outlet.
  roomStore.onPromoted = () => {
    if (composerDispose === undefined) return
    composerDispose()
    composerDispose = ctx.slots.register(composerEntry, RoomComposer)
  }
  // Registration-time text (the tab label) reads through the bound translate
  // as a thunk, so it follows the active locale without re-registration.
  // The members tab's REGISTRATION is the hide level (M3'): the tab strip's
  // buttons enumerate `conversation.view` registrations with no per-session
  // predicate, so a hidden tab means no registration — the toggle registers
  // exactly while the criterion passes for the current session and disposes
  // otherwise (the slot's own subscription re-renders the strip, the same
  // re-registration mechanism the composer promotion bump uses).
  const membersToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'room-members',
      order: 20,
      locale: NS,
      label: () => t('view.members'),
      inject: (sessionId: SessionId): RoomMembersInjected => membersFace(sessionId),
    }, MembersView),
    () => roomChrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.view', () => {
    membersToggle.setReady(true)
    return () => { membersToggle.setReady(false) }
  })
  ctx.effect(() => roomChrome.subscribe(() => { membersToggle.sync() }), 'room: members tab visibility')
  // The three chat-node renderers, keyed behind the definitions above.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-speech',
      locale: NS,
      inject: (): RoomSpeechInjected => ({
        roomStore,
        openSession,
        // Context Lens is another plugin: reach it through the sidebar by its
        // tab kind, only when its namespace is mounted; a refused open is a no-op.
        ...ctx.get('remote.requestInspector') === undefined || ctx.get('sidebarRight') === undefined ? {} : {
          openDetail: (sessionId: SessionId, messageId: string) => {
            try {
              (ctx.get('sidebarRight') as { openTab(kind: string, options?: { params?: object }): void }).openTab('context-lens', { params: { sessionId, messageId } })
            } catch { /* the tab kind is hidden or absent */ }
          },
        },
      }),
    },
    RoomSpeechView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-run',
      locale: NS,
      inject: (sessionId: SessionId): RoomRunInjected => ({
        renderMemberOutput: (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderMemberOutput,
        roomStore,
        openSession,
        cancelMember: member => cancelMember(sessionId, member),
      }),
    },
    RoomRunView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'room-event', locale: NS },
    RoomEventView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-relay',
      locale: NS,
      inject: (sessionId: SessionId): RoomRelayInjected => relayFace(sessionId),
    },
    RoomRelayView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-inbox',
      locale: NS,
      inject: (sessionId: SessionId): RoomInboxInjected => ({
        releaseReports: async (member) => {
          if (remote === undefined) return
          const carried = await remote.releaseReports({ sessionId, name: member })
          if (carried.ok) void roomStore.refresh(sessionId)
        },
      }),
    },
    RoomInboxView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-approval',
      locale: NS,
      inject: (sessionId: SessionId): RoomApprovalInjected => ({
        answerApproval: async (approvalId, outcome) => {
          if (remote === undefined) return t('composer.error.generic')
          const carried = await remote.answerApproval({ sessionId, id: approvalId, outcome })
          void roomStore.refresh(sessionId)
          if (!carried.ok) return t('composer.error.generic')
          return carried.value.ok ? undefined : t('approval.expired')
        },
      }),
    },
    RoomApprovalView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-question',
      locale: NS,
      inject: (sessionId: SessionId): RoomQuestionInjected => ({
        answerQuestion: async (questionId, answers) => {
          if (remote === undefined) return t('composer.error.generic')
          const carried = await remote.answerQuestion({ sessionId, id: questionId, answers })
          void roomStore.refresh(sessionId)
          if (!carried.ok) return t('composer.error.generic')
          return carried.value.ok ? undefined : t('question.expired')
        },
      }),
    },
    RoomQuestionView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-decision',
      locale: NS,
      inject: (sessionId: SessionId): RoomDecisionInjected => ({
        // Context Lens is another plugin: opened by its tab kind, only when mounted.
        ...ctx.get('remote.requestInspector') === undefined || ctx.get('sidebarRight') === undefined ? {} : {
          openDecision: (decisionId: string) => {
            try {
              (ctx.get('sidebarRight') as { openTab(kind: string, options?: { params?: object }): void }).openTab('context-lens', { params: { sessionId, roomDecision: decisionId } })
            } catch { /* the tab kind is hidden or absent */ }
          },
        },
      }),
    },
    RoomDecisionView,
  ))
  // Cross-session help: the thread row in the asking room, the request card
  // in the helper's session (any session — the card is how it gets there).
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'room-help', locale: NS, inject: (sessionId: SessionId): RoomHelpInjected => ({ openSession, roomStore, linkSession: linkFace(sessionId).linkSession, dismissNudge: linkFace(sessionId).dismissNudge }) },
    RoomHelpView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'room-help-request', locale: NS, inject: (): RoomHelpInjected => ({ openSession }) },
    RoomHelpRequestView,
  ))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
