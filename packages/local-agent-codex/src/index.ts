/**
 * Codex harness instantiation of the local-agent family. Registers the
 * `codex` harness into the core registry: scoped home under the shared homes
 * root (`CODEX_HOME`), device-code login through `codex login --device-auth`
 * (prompt captured from stdout), and rollout-file session records.
 * Delegation mounts through the `codex-local` provider (one-shot
 * `codex exec` under the scoped home); the bundle patch's
 * `tool-subagent-codex-local` row puts the tool on the profile root, so
 * every agent preset can delegate.
 *
 * @module @khorsheed/dsh-local-agent-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@khorsheed/dsh-local-agent'
import { CodexCliProvider } from './codex-cli-provider.ts'
import { codexAuthenticated, listCodexSessions } from './records.ts'
import { codexLogout, provisionCodexConfig } from './provision.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-codex'

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess']

/** Plugin config: the sandbox mode fresh delegations default to. */
export interface Config {
  /** Codex sandbox policy for `codex exec`; defaults to workspace-write. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<Config> = z.object({
  sandbox: z.union([
    z.const('read-only'),
    z.const('workspace-write'),
    z.const('danger-full-access'),
  ]),
})

/** The sandbox policy a fresh delegation defaults to. */
export const DEFAULT_SANDBOX: NonNullable<Config['sandbox']> = 'workspace-write'

/**
 * Register the Codex harness into the local-agent registry.
 * @param ctx - plugin context carrying the registry.
 * @param config - plugin config; `sandbox` selects the `codex exec` policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const sandbox = config.sandbox ?? DEFAULT_SANDBOX
    const homeDir = ctx.localAgent.homeDir('codex')
    // Codex's default credential store on macOS is the keychain; pin
    // file-based storage so login lands in the scoped home's auth.json.
    void provisionCodexConfig(homeDir).catch((error: unknown) => {
      ctx.logger.warn(`local-agent-codex: config.toml provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    ctx.subagents.registerProvider(new CodexCliProvider(ctx, sandbox))
    return ctx.localAgent.register({
      name: 'codex',
      displayName: 'Codex',
      homeEnvVar: 'CODEX_HOME',
      delegationProvider: 'codex-local',
      login: {
        command: 'codex',
        args: ['login', '--device-auth'],
        // codex prints the device-code URL to stdout, not stderr.
        capture: 'stdout',
      },
      records: { listSessions: homeDir => listCodexSessions(homeDir) },
      isAuthenticated: codexAuthenticated,
      logout: codexLogout,
      subcommand: (input: string, invocation: CommandInvocation): Promise<CommandResult> | undefined => {
        const [verb] = input.split(/\s+/)
        if (verb === 'sessions') {
          return listCodexSessions(invocation.agent.ctx.localAgent.homeDir('codex'))
            .then(records => ({
              kind: 'success',
              text: records.length === 0
                ? 'No codex sessions in the scoped home yet.'
                : records.map(r => `${r.id} ${r.workDir}`).join('\n'),
            }))
        }
        return undefined
      },
    })
  }, 'local-agent-codex: harness')
}
