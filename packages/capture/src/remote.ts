/**
 * The capture Remote: the wire face, and nothing else.
 *
 * `render` is a one-line delegation to {@link CaptureService} and returns the
 * BARE domain value; the wire layer wraps it in the protocol's result
 * envelope, and the service's thrown `RemoteError`s arrive as that envelope's
 * error branch. There is no second `{ ok }` union nested in the value.
 *
 * @module @khorsheed/dsh-capture/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CaptureService } from './service.ts'
import type { CaptureRenderRequest, CaptureRenderedPage } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    captureRemote: CaptureRemoteService
  }
}

/** Reserved for future config-driven knobs; the service owns today's config. */
export interface CaptureRemoteConfig {}

/** The wire namespace is `capture`: the browser calls `remote.capture.render`. */
export class CaptureRemoteService extends TypertRemoteService<CaptureRemoteConfig> {
  static inject = ['capture']

  constructor(ctx: Context, _config: CaptureRemoteConfig = {}) {
    super(ctx, 'captureRemote', { namespace: 'capture' })
  }

  /** The service core this face delegates to. */
  private get core(): CaptureService {
    return this.ctx.capture
  }

  /**
   * Render a URL in the managed headless Chrome and hand back the serialized
   * rendered page. Refusals (bad URL, private target, no browser, timeout,
   * full queue) throw `RemoteError`s with `capture/*` codes.
   */
  @Remote('render')
  render(request: CaptureRenderRequest): Promise<CaptureRenderedPage> {
    return this.core.render(request)
  }
}

export default CaptureRemoteService
