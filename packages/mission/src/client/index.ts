/**
 * Mission plugin, browser half: the five-bucket task table as the 'missions'
 * entry in the conversation's `conversation.view` tab ring (beside chat and
 * trajectory). The mission Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages. Composing this plugin out of
 * cordis.yml removes the tab.
 * @module @khorsheed/dsh-mission/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-mission/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import missionRemote from '@khorsheed/dsh-mission/remote'
import type {
  MissionExportPlanRequest, MissionExportRequest, MissionGetRequest, MissionQueueRequest, MissionRefRequest,
  MissionRetryRequest,
} from '../types.ts'
import type { MissionRemote, MissionsViewInjected } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { MissionsView } from './MissionsView.tsx'
import { createMissionsViewStore } from './store.ts'

export { MissionsView }

/** Required services: the slot registry, the remote channel, and the copy.
 * `remote.mission` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis property
 * proxy only resolves services declared in `inject` or provided by an ancestor
 * fiber — declaring it would deadlock the loader. The mount is awaited and the
 * namespace is then read back from the global store with `ctx.get` (the
 * ui-file-preview precedent). */
export const inject = ['slots', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries and the
 * missions view tab.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(missionRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the view surfaces the typed RPC
    // error an unmounted namespace answers).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mission: dictionaries')
  const t = ctx.locale.bind(NS)
  // The namespace is registered by $mount above; read it back from the global
  // store once the mount has settled (a lazy `ctx.remote.mission` read would
  // trip the property proxy — the namespace lives in the sibling fiber $mount
  // spawned).
  const remote = ctx.get('remote.mission') as MissionRemote

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'missions',
    order: 35,
    locale: NS,
    label: () => t('open'),
    store: createMissionsViewStore,
    inject: (_sessionId: SessionId): MissionsViewInjected => ({
      fetchQueue: (sid: SessionId, request: MissionQueueRequest) => remote.queue(sid, request),
      fetchMission: (sid: SessionId, request: MissionGetRequest) => remote.get(sid, request),
      retryMission: (sid: SessionId, request: MissionRetryRequest) => remote.retry(sid, request),
      checkReleasable: (sid: SessionId, request: MissionRefRequest) => remote.isReleasable(sid, request),
      planExport: (sid: SessionId, request: MissionExportPlanRequest) => remote.exportPlan(sid, request),
      exportRun: (sid: SessionId, request: MissionExportRequest) => remote.exportRun(sid, request),
    }),
  }, MissionsView))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
