/**
 * Video studio, host half: provides the `videoStudio` service (shows,
 * projects, settings layers, media jobs) and mounts its Remote face for the
 * 剪辑 panel. State lives under $DSH_HOME/state/video-studio; media files stay
 * where the user keeps them. The model tools are the separate `./tool` entry,
 * granted by the dsh-video preset.
 *
 * @module @khorsheed/dsh-video-studio
 */
import type { Context } from '@deepseek-ai/cordis'
import { VideoStudioRemoteService } from './remote.ts'
import { VideoStudioService } from './service.ts'

export { VideoStudioService } from './service.ts'
export { VideoStudioRemoteService } from './remote.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    videoStudio: VideoStudioService
  }
}

export interface VideoStudioConfig {
  /** Override the state directory (default $DSH_HOME/state/video-studio). */
  stateDir?: string
}

export const name = 'video-studio'

export function apply(ctx: Context, config: VideoStudioConfig = {}): void {
  const service = new VideoStudioService(config.stateDir, ctx.logger as unknown as Console)
  ctx.provide('videoStudio', service)
  ctx.effect(() => () => service.dispose(), 'video-studio: jobs')
  void service.sweepCaches().catch(() => {})
  ctx.plugin(VideoStudioRemoteService, {})
}
