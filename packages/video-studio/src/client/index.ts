/**
 * Video studio, browser half: the 剪辑 right-Sidebar tab. It mounts the
 * videoStudio Remote and registers the tab type plus its body. The tab type
 * registers exactly while the current session can reach the video_* tools —
 * the dsh-video 剪辑模式 preset naming the ./tool row (every unreadable path
 * fails open). A profile that should not offer editing at all does not install
 * the package.
 *
 * @module @khorsheed/dsh-video-studio/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-video-studio/remote'
// Type-only: the ctx.sidebarRightTabs merge and the 'sidebar.right.pane.tab' seat.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import videoRemote from '@khorsheed/dsh-video-studio/remote'
import type { VideoPaneInjected } from './contract.ts'
import { followerHostOf, openDestination, registerDestinationCards, startNavFollower } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import { VIDEO_KIND, VIDEO_TAB_ID, videoDefinition, type VideoNavParams } from './definition.tsx'
import { DESK_OWNER, DESK_ROW_KIND, deskDestinationsOf, deskRowDefinition, setDeskRowSeated } from './desk-row.ts'
import { DeskAttachment } from './DeskAttachment.tsx'
import { DeskOpenRow, type DeskOpenRowFace } from './DeskOpenRow.tsx'
import { mainSessionId, RegistrationToggle, VideoTabVisibility, type VideoPluginInventorySnapshot } from './preset-visibility.ts'
import { en, NS, zh } from './locales.ts'
import { createVideoStudioStore } from './store.ts'
import { VideoPane } from './VideoPane.tsx'

export { VIDEO_KIND, VIDEO_TAB_ID } from './definition.tsx'
export type { VideoNavParams } from './definition.tsx'

export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs', 'sessions']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(videoRemote))
  } catch (error) {
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'video-studio: dictionaries')
  const t = ctx.locale.bind(NS)
  // ctx.get, not an inject: without the host half the pane shows its error
  // state instead of the whole plugin pending.
  const remote = ctx.get('remote.videoStudio')

  const face = (sessionId: SessionId): VideoPaneInjected => ({
    overview: () => remote.overview(),
    bound: () => remote.bound({ sessionId }),
    bind: projectId => remote.bind({ sessionId, projectId }),
    createShow: name => remote.createShow({ name }),
    updateShow: request => remote.updateShow(request),
    deleteVoiceprint: request => remote.deleteVoiceprint(request),
    createProject: request => remote.createProject({ ...request, sessionId }),
    renameProject: request => remote.renameProject(request),
    project: projectId => remote.project({ projectId }),
    importSources: request => remote.importSources(request),
    listMedia: request => remote.listMedia(request),
    // The host's native directory picker (host ≥ 0.1.2). ctx.get, not an
    // inject: a composition without the picker yields undefined and the
    // gesture degrades to a cancel-shaped null (the local-files pattern —
    // declaring the namespace would pend the whole plugin instead).
    pickDirectory: async () => {
      const picker = ctx.get('remote.directoryPicker') as {
        pick(): Promise<{ ok: boolean; value?: string | null; error?: { message: string } }>
      } | undefined
      if (picker === undefined) return null
      const result = await picker.pick()
      if (!result.ok) throw new Error(result.error?.message ?? 'directory picker failed')
      return result.value ?? null
    },
    // Prime the session's composer with a draft (library's primeConversation
    // pattern): a structural probe, false when no input machine exists — the
    // caller falls back to the clipboard.
    primeConversation: text => {
      const scope = ctx.get('sessions')?.scope(sessionId)
      const input = (scope?.get('conversation') as {
        input?: { for(actx: unknown): { setDraft?: (text: string) => void; state?: { getSnapshot(): { draft: string } } } | undefined }
      } | undefined)?.input?.for(scope)
      if (typeof input?.setDraft !== 'function' || typeof input.state?.getSnapshot !== 'function') return false
      const draft = input.state.getSnapshot().draft
      input.setDraft(draft.trim() === '' ? text : `${draft}\n\n${text}`)
      return true
    },
    setCut: request => remote.setCut(request),
    decide: request => remote.decide(request),
    scan: projectId => remote.scan({ projectId }),
    renameSpeaker: request => remote.renameSpeaker(request),
    mergeSpeakers: request => remote.mergeSpeakers(request),
    reassignSegment: request => remote.reassignSegment(request),
    fixText: request => remote.fixText(request),
    replaceAll: request => remote.replaceAll(request),
    cutMatches: request => remote.cutMatches(request),
    audioChunk: request => remote.audioChunk(request),
    projectSetting: request => remote.projectSetting(request),
    setGlobal: request => remote.setGlobal(request),
    clip: request => remote.clip(request),
    startExport: request => remote.startExport(request),
    retryTranscribe: projectId => remote.retryTranscribe({ projectId }),
    cancelJob: jobId => remote.cancelJob({ jobId }),
    models: () => remote.models(),
    downloadModels: () => remote.downloadModels(),
  })

  // The tab type registers exactly while the current session reaches the
  // video_* tools (the 剪辑模式 preset names the ./tool row). Hidden means NOT
  // registered: the guide enumerates the registry, opened tabs are stored per
  // session, and an unregistered kind renders the host's tab.unavailable
  // fallback. Every unreadable path fails open (preset-visibility.ts).
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<VideoPluginInventorySnapshot>>
  } | undefined
  const tabVisibility = new VideoTabVisibility(ctx, pluginInventory)
  ctx.effect(() => {
    const toggle = new RegistrationToggle(
      () => ctx.sidebarRightTabs.register(videoDefinition(t)),
      () => tabVisibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'video-studio: tab type visibility')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: VIDEO_TAB_ID,
    locale: NS,
    store: createVideoStudioStore,
    inject: face,
  }, VideoPane)), 'video-studio: sidebar tab body')

  /**
   * The one way into the panel from outside (proposal
   * 2026-10-30-agent-sidebar-navigation): open the 剪辑 tab at an address,
   * which the pane applies once per navigation revision. A session whose mode
   * hides the tab has no tab type to open; the miss is logged, never thrown.
   */
  const get = (name: string): unknown => (ctx.get.bind(ctx) as (key: string) => unknown)(name)
  const go = (params: VideoNavParams): void => {
    openDestination(get, { kind: VIDEO_KIND, params: params as unknown as Readonly<Record<string, unknown>> }, line => { ctx.logger.warn(line) })
  }

  // The follower: a video tool's answer names where it landed (the project,
  // 素材, a proposal group in 文稿, 导出); watched live, the tab goes there.
  const followerHost = followerHostOf(get)
  if (followerHost !== undefined) {
    ctx.effect(() => startNavFollower(followerHost, {
      kinds: [VIDEO_KIND],
      open: destination => { go(destination.params as unknown as VideoNavParams) },
      events: event => deskDestinationsOf(VIDEO_KIND, event),
    }), 'video-studio: destination follower')
  }

  // The room desk (proposal 2026-10-29-room-desk): a room member's
  // video_project create/open writes room's `room/desk-opened` (owner = this
  // package) into the ROOM session (../desk.ts). Its row says what was opened
  // and keeps an 打开 → door; a coordinator's open seen arriving brings the
  // room's 剪辑 panel to that project (desk-row.ts). The seats are declared by
  // packages this one does not depend on (ui-chat, room), so registrations go
  // through a structural view of the registry and simply never fire without
  // them. The sidebar is probed, not injected: without it the door is inert.
  const anySlots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  // The conversation cards (proposal 2026-10-30-agent-sidebar-navigation):
  // the one shell under each write tool and in the Turn tail; its door is the
  // answer's destination (the project, 素材, the proposal group in 文稿, 导出).
  registerDestinationCards(
    (body, label) => { ctx.effect(body, label) },
    anySlots,
    () => get('uiConversation') as { events?: { register?: (definition: unknown) => () => void } } | undefined,
    {
      owner: DESK_OWNER,
      tools: ['video_project', 'video_import', 'video_propose_edit', 'video_render'],
      locale: NS,
      face: () => ({
        copy: () => ({ kind: t('tab.label'), running: t('card.running'), failed: t('card.failed'), open: t('card.open') }),
        go: () => destination => { go(destination.params as unknown as VideoNavParams) },
      }),
    },
  )

  const deskFace: DeskOpenRowFace = {
    // Showing is not binding: the session's binding is the tools' business.
    openProject: (_sessionId, projectId) => { go({ projectId }) },
  }
  ctx.effect(() => anySlots.inject('conversation.chat.node', () => {
    const conversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as {
      events?: { register?: (definition: unknown) => () => void }
    } | undefined
    const register = conversation?.events?.register
    if (register === undefined) return () => undefined
    const disposeDefinition = register.call(conversation?.events, deskRowDefinition)
    const disposeEntry = anySlots.register({
      name: 'conversation.chat.node',
      key: DESK_ROW_KIND,
      locale: NS,
      inject: () => deskFace,
    }, DeskOpenRow)
    return () => {
      disposeEntry()
      disposeDefinition()
    }
  }), 'video-studio: room desk row')
  // The same row at the end of the member's card, where the room seats it
  // (`room.member.attachment` on the reply, `room.run.attachment` on the
  // running card): the row's own node then steps aside for every event that
  // names a run.
  for (const seat of ['room.member.attachment', 'room.run.attachment'] as const) {
    ctx.effect(() => anySlots.inject(seat, () => {
      const dispose = anySlots.register({
        name: seat,
        key: DESK_OWNER,
        locale: NS,
        inject: () => deskFace,
      }, DeskAttachment)
      if (seat === 'room.member.attachment') setDeskRowSeated(true)
      return () => {
        if (seat === 'room.member.attachment') setDeskRowSeated(false)
        dispose()
      }
    }), `video-studio: room card desk row (${seat})`)
  }

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
