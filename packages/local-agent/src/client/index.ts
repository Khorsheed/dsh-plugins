/**
 * Local-agent records plugin, browser half: the settings section managing
 * harness auth and preset delegation. Roster and status ride the read-only
 * local-agent Remote channel (no session events); only the user-initiated
 * login/logout/preset commands go through the commands Remote, whose visible
 * command node is the expected feedback. Delegation records live with the
 * shared subagent surface — there is no separate header dropdown, so kimi
 * delegations appear under the standard 子代理 list like every other
 * subagent. The plugin holds no host data — every open pulls fresh.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API, the ctx.remote merge, and the
// locale Context merge.
import type {} from '@khorsheed/dsh-local-agent/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import localAgentRemote from '@khorsheed/dsh-local-agent/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { LocalAgentSettingsSection, type LocalAgentSettingsInjected } from './LocalAgentSettingsSection.tsx'
import { en, NS, zh, type LocalAgentKey } from './locales.ts'

export type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
export type { LocalAgentSettingsInjected, LocalAgentSettingsProps } from './LocalAgentSettingsSection.tsx'
export type { LocalAgentSettingsRowOwnerProps } from './slot-contract.ts'

/** The mounted local-agent gateway namespace, read back from the global store. */
export type LocalAgentGatewayRemote = TypertRemoteNamespaceMap['localAgentGateway']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The local-agent settings section copy. */
    'local-agent': LocalAgentKey
  }
}

/** Required services: slot registry, the Remote channel, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/** The run-command face for user-initiated login/logout/preset actions. */
function runCommand(ctx: ClientContext, sessionId: SessionId, line: string): Promise<string | undefined> {
  return ctx.remote.commands.execute(sessionId, line).then(result => (result.ok ? result.value?.result.text : undefined))
}

/**
 * Client plugin body: mount the local-agent Remote channel, register the
 * dictionaries and the settings section managing the harnesses.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    // The namespace is registered by $mount; `ctx.remote.localAgentGateway`
    // cannot see it (the property proxy walks the fiber chain, and the
    // namespace lives in the sibling fiber $mount spawned), so read it from
    // the global store once the mount has settled.
    disposers.push(await ctx.remote.$mount(localAgentRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the settings section would answer an
    // unmounted namespace with a typed RPC error, which the surfaces render).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  const gateway = ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-local-agent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject(
    'settings.section',
    () => ctx.slots.register({
      name: 'settings.section',
      id: 'local-agent',
      // After the Models section.
      order: 20,
      label: () => t('settings.nav'),
      locale: NS,
      children: {
        'local-agent.settings.row': { kind: 'list', scope: 'root' },
        'local-agent.settings.row-action': { kind: 'list', scope: 'root' },
      },
      inject: (): LocalAgentSettingsInjected => ({
        roster: () => gateway.roster().then(result => (result.ok ? result.value : undefined)),
        status: name => gateway.status(name).then(result => (result.ok ? result.value : undefined)),
        runCommand: (target, line) => runCommand(ctx, target, line),
      }),
    }, LocalAgentSettingsSection),
  )
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
