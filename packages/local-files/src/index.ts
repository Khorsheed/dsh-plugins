/**
 * Local-files plugin, host half: provides the git-agnostic file-browser data
 * service and mounts its Remote face. The plugin never writes to disk — every
 * call is a read of an absolute local path (the user's own machine, file-preview
 * trust model). Composing this plugin out of cordis.yml removes every surface
 * it adds.
 *
 * @module @khorsheed/dsh-local-files
 */
import type { Context } from '@deepseek-ai/cordis'
import { LocalFilesService } from './service.ts'
import { LocalFilesRemoteService } from './remote.ts'

export { LocalFilesService } from './service.ts'
export { LocalFilesRemoteService } from './remote.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    localFiles: LocalFilesService
  }
}

export const name = 'localFiles'

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 * @param ctx - owning Cordis Context.
 */
export function apply(ctx: Context): void {
  const service = new LocalFilesService()
  ctx.provide('localFiles', service)
  ctx.plugin(LocalFilesRemoteService, {})
}
