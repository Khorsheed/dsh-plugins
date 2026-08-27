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
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@khorsheed/dsh-local-agent'
import { CodexCliProvider } from './codex-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { codexAuthenticated, listCodexSessions } from './records.ts'
import { codexCredentialStamp, codexLogout, provisionCodexConfig } from './provision.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-codex'

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'settings']

/** Plugin config: the sandbox mode fresh delegations default to, plus the live driver. */
export interface Config {
  /** Codex sandbox policy for `codex exec` / app-server threads; defaults to workspace-write. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /**
   * Live driver: keep one resident `codex app-server` process per member and
   * drive turns over the app-server wire (runtime-level interrupt, push-mode
   * mirroring) instead of one `codex exec` process per round. Default off;
   * the exec one-shot stays the fallback whenever the channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /**
   * Live mirror granularity: `event` mirrors completed items; `token`
   * additionally appends `assistant/chunk` deltas (write amplification —
   * opt-in).
   */
  liveMirrorGranularity?: 'event' | 'token'
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<Config> = z.object({
  sandbox: z.union([
    z.const('read-only'),
    z.const('workspace-write'),
    z.const('danger-full-access'),
  ]),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

/** The sandbox policy a fresh delegation defaults to. */
export const DEFAULT_SANDBOX: NonNullable<Config['sandbox']> = 'workspace-write'

/**
 * Settings namespace for the settings-page card. The Cordis config feeds the
 * composition `base` layer, so a field absent from the user layer inherits the
 * YAML value — the card only ever stores deliberate overrides.
 */
export const CODEX_SETTINGS_NAMESPACE = settingsNamespace('local-agent-codex')

/** The card's schema; field defaults are the innermost layer below `base`. */
const CODEX_SETTINGS_SCHEMA = z.object({
  live: z.boolean().default(false),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

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
    // The live driver is settings-driven: the settings card's toggle (user
    // layer over the YAML composition base) swaps driver generations without
    // a reload. Toggling OFF drains the retiring generation — new rounds fall
    // back to exec, in-flight rounds finish on their runtime, idle runtimes
    // are reclaimed at once. A granularity change needs no new generation:
    // the driver reads it per round.
    const scope = ctx.settings.register(CODEX_SETTINGS_NAMESPACE, CODEX_SETTINGS_SCHEMA, {
      base: {
        ...config.live === undefined ? {} : { live: config.live },
        ...config.liveMirrorGranularity === undefined ? {} : { liveMirrorGranularity: config.liveMirrorGranularity },
      },
    })
    const liveSwitch = new LiveDriverSwitch(ctx, scope, {
      sandbox,
      ...config.liveIdleMs === undefined ? {} : { liveIdleMs: config.liveIdleMs },
    })
    const disposeProvider = ctx.subagents.registerProvider(new CodexCliProvider(ctx, sandbox, liveSwitch.resolve))
    const disposeHarness = ctx.localAgent.register({
      name: 'codex',
      displayName: 'Codex',
      homeEnvVar: 'CODEX_HOME',
      delegationProvider: 'codex-local',
      // A PTY run of plain `codex login` starts a localhost callback server
      // (no device code, no paste) and opens the browser itself — the
      // first-class flow. `--device-auth` remains the documented headless
      // fallback for remote terminals.
      login: { pty: { command: 'codex', args: ['login'] } },
      records: { listSessions: homeDir => listCodexSessions(homeDir) },
      isAuthenticated: codexAuthenticated,
      credentialStamp: codexCredentialStamp,
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
    return () => {
      disposeProvider()
      disposeHarness()
      liveSwitch.dispose()
    }
  }, 'local-agent-codex: harness')
}
