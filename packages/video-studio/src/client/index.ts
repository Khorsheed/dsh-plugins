/**
 * Video studio, browser half: the 剪辑 right-Sidebar tab. It mounts the
 * videoStudio Remote and registers the tab type plus its body. Projects are
 * deployment-level (no session-preset self-hide): a profile that should not
 * show the tab does not install the package.
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
import videoRemote from '@khorsheed/dsh-video-studio/remote'
import type { VideoPaneInjected } from './contract.ts'
import { VIDEO_TAB_ID, videoDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { createVideoStudioStore } from './store.ts'
import { VideoPane } from './VideoPane.tsx'

export { VIDEO_KIND, VIDEO_TAB_ID } from './definition.tsx'

export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

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
    project: projectId => remote.project({ projectId }),
    importSources: request => remote.importSources(request),
    setCut: request => remote.setCut(request),
    decide: request => remote.decide(request),
    scan: projectId => remote.scan({ projectId }),
    renameSpeaker: request => remote.renameSpeaker(request),
    mergeSpeakers: request => remote.mergeSpeakers(request),
    reassignSegment: request => remote.reassignSegment(request),
    projectSetting: request => remote.projectSetting(request),
    setGlobal: request => remote.setGlobal(request),
    clip: request => remote.clip(request),
    startExport: request => remote.startExport(request),
    retryTranscribe: projectId => remote.retryTranscribe({ projectId }),
    cancelJob: jobId => remote.cancelJob({ jobId }),
    models: () => remote.models(),
    downloadModels: () => remote.downloadModels(),
  })

  ctx.effect(() => ctx.sidebarRightTabs.register(videoDefinition(t)), 'video-studio: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: VIDEO_TAB_ID,
    locale: NS,
    store: createVideoStudioStore,
    inject: face,
  }, VideoPane)), 'video-studio: sidebar tab body')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
