/**
 * Eval plugin, browser half: the experiment list and detail as the 'lab'
 * entry in the conversation's `conversation.view` tab ring (beside chat and
 * trajectory). The eval Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages.
 *
 * The tab is labelled 实验室 / Experiments while the plugin id stays `eval`
 * (ui-spec R5 — `lab` in this repository is the container-unit plugin, and
 * the two must not be confused). It self-hides unless the current session's
 * preset composition names the `@khorsheed/dsh-eval-tool` row — the tools it
 * views are granted there, and a viewer over a toolset the session never got
 * is an empty shell. Composing this plugin out of cordis.yml removes the tab.
 *
 * The browser half imports NOTHING from mission or datasets (ui-spec R2 and
 * §八): both projections are computed host-side behind eval's own Remote, so
 * the tab reads one face and the client bundle stays free of sibling packages.
 * @module @khorsheed/dsh-eval/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-eval/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import evalRemote from '@khorsheed/dsh-eval/remote'
import type { EvalExperimentRequest, EvalExperimentsRequest } from '../types.ts'
import type { EvalRemote, LabViewInjected } from './contract.ts'
import { LabView } from './LabView.tsx'
import { en, NS, zh } from './locales.ts'
import { EvalPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createLabViewStore } from './store.ts'

export { LabView }

/** Required services: the slot registry, the remote channel, the copy, and the
 * session list (the preset-composition criterion reads the current session).
 * `remote.dshEval` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis property
 * proxy only resolves services declared in `inject` or provided by an ancestor
 * fiber — declaring it would deadlock the loader. The mount is awaited and the
 * namespace is then read back from the global store with `ctx.get` (the
 * ui-file-preview precedent, which mission and datasets both follow). */
export const inject = ['slots', 'remote', 'locale', 'sessions']

/**
 * Client plugin body: mount the Remote, register the dictionaries, and
 * inject the lab view tab (registered exactly while the current session's
 * preset composition grants the eval tool row).
 * @param ctx - client root context.
 * @returns the teardown that disposes the Remote mount.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(evalRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the view surfaces the typed RPC
    // error an unmounted namespace answers).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'eval: dictionaries')
  const t = ctx.locale.bind(NS)
  // The namespace is registered by $mount above; read it back from the global
  // store once the mount has settled (a lazy `ctx.remote.dshEval` read would
  // trip the property proxy — the namespace lives in the sibling fiber $mount
  // spawned).
  const remote = ctx.get('remote.dshEval') as EvalRemote

  // The self-hide criterion for the 实验室 tab: the official preset
  // composition data, fail-open on every unreadable path. Hidden means NO
  // registration (the tab strip's buttons enumerate registrations), so the
  // strip never carries an empty-body button.
  const chrome = new EvalPresetVisibility(ctx)
  const labToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'lab',
      order: 40,
      locale: NS,
      label: () => t('open'),
      store: createLabViewStore,
      inject: (_sessionId: SessionId): LabViewInjected => ({
        fetchExperiments: (sid: SessionId, request: EvalExperimentsRequest) => remote.runs(sid, request),
        fetchExperiment: (sid: SessionId, request: EvalExperimentRequest) => remote.run(sid, request),
      }),
    }, LabView),
    () => chrome.show(ctx.sessions.list.getSnapshot().current),
  )
  ctx.slots.inject('conversation.view', () => {
    labToggle.setReady(true)
    return () => { labToggle.setReady(false) }
  })
  ctx.effect(() => chrome.subscribe(() => { labToggle.sync() }), 'eval: lab tab visibility')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
