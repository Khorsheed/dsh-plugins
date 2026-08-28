/**
 * Local-agent records plugin, browser half: the member composer for delegated
 * CLI sessions, plus the shared settings-card building blocks the provider
 * packages compose (ProviderAuthBlock, the auth-status bus, AuthStatusDot).
 * The per-harness auth/live settings live in each provider's own
 * `settings.plugin.item` card (Plugins → 可配置插件); the standalone「本地
 * Agent」section was retired once the cards carried auth (the live-settings
 * proposal's M3). Roster and status ride the read-only local-agent Remote
 * channel (no session events); only the user-initiated login/logout/preset
 * commands go through the commands Remote, whose visible command node is the
 * expected feedback. Delegation records live with the shared subagent
 * surface — there is no separate header dropdown, so kimi delegations appear
 * under the standard 子代理 list like every other subagent. The plugin holds
 * no host data — every open pulls fresh.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API, the ctx.remote merge, and the
// locale Context merge.
import type {} from '@khorsheed/dsh-local-agent/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the 'conversation.composer' SlotMap merge (chain registration).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import localAgentRemote from '@khorsheed/dsh-local-agent/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { MemberComposer, selectCliMember, type MemberComposerInjected } from './MemberComposer.tsx'
import { en, NS, zh, type LocalAgentKey } from './locales.ts'

export type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
export { ProviderAuthBlock } from './ProviderAuthBlock.tsx'
export type { ProviderAuthBlockProps, ProviderAuthInjected } from './ProviderAuthBlock.tsx'
export { AuthStatusDot } from './AuthStatusDot.tsx'
export type { AuthStatusDotProps } from './AuthStatusDot.tsx'
export { publishAuthStatus, useHarnessAuthStatus, resetAuthStatuses, readAuthStatus } from './auth-status.ts'
export type { HarnessAuthStatusKind } from './auth-status.ts'
export type { MemberComposerInjected, MemberComposerMatch, MemberComposerProps } from './MemberComposer.tsx'
export { selectCliMember } from './MemberComposer.tsx'

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

/**
 * Client plugin body: mount the local-agent Remote channel, register the
 * dictionaries, and put the member composer on the conversation chain.
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
    // rest of the plugin still registers (callers would answer an unmounted
    // namespace with a typed RPC error, which the surfaces render).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  const gateway = ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote
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
        memberOf: childSessionId => gateway.memberOf(childSessionId).then(result => (result.ok ? result.value : undefined)),
        promptMember: (childSessionId, text) => gateway.promptMember(childSessionId, text).then(result => (result.ok ? result.value : undefined)),
        stopMember: childSessionId => gateway.stopMember(childSessionId).then(result => (result.ok ? result.value : undefined)),
      }),
    }, MemberComposer),
  )
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
