/**
 * Claude Code harness instantiation of the local-agent family. Registers the
 * `claude-code` harness into the core registry: scoped home under the shared
 * homes root (`CLAUDE_CONFIG_DIR`), login as a manual handoff (claude ≥2.1
 * prints no OAuth URL off a TTY, so `/login` replies with the exact terminal
 * command and the registry watches for the credential), and project-file
 * session records. Delegation mounts through the `claude-local` provider
 * (one-shot `claude -p --output-format json` under the scoped home); the
 * bundle patch's `tool-subagent-claude-code-local` row puts the tool on the
 * profile root, so every agent preset can delegate.
 *
 * @module @khorsheed/dsh-local-agent-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@khorsheed/dsh-local-agent'
import { endpointHost } from '@khorsheed/dsh-local-agent/types'
import { ClaudeCliProvider, claudeCliVersion } from './claude-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { claudeAuthenticated, claudeCredentialStamp, listClaudeSessions, syncClaudeCredentialFile } from './records.ts'
import { claudeLogout, provisionClaudeHome, readClaudeConfiguredModel } from './provision.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-claude-code'

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'settings']

/** Plugin config: the permission mode fresh delegations default to, plus the live driver. */
export interface Config {
  /**
   * `claude -p` permission handling; `skip` passes
   * `--dangerously-skip-permissions` so the child can write files without an
   * interactive approval prompt. Defaults to `skip` because a one-shot CLI
   * subagent has no approval surface.
   */
  permissionMode?: 'skip' | 'normal'
  /**
   * The model every delegation round starts the CLI with (`claude -p --model
   * <model>`, the same flag in resident mode). Absent — the default — passes
   * NO model flag at all: the scoped `settings.json`'s own `model`, or the
   * CLI's built-in default with none, decides exactly as it did before this
   * key existed. The settings card writes the same key, so a change applies
   * to the next round without a reload.
   */
  model?: string
  /**
   * `ANTHROPIC_BASE_URL` for the child CLI; absent inherits the host
   * process environment (a user-level proxy like `https://proxy.example.com/anthropic`
   * is typically exported there). Set when delegations must route through a
   * different endpoint than the login flow used.
   */
  baseUrl?: string
  /**
   * HTTP proxy for the child CLI's own traffic (model calls AND OAuth
   * refresh), provisioned into the scoped `settings.json` env block. Needed
   * when the host process environment carries no proxy (a supervisor-spawned
   * instance does not inherit the user's shell exports).
   */
  proxyUrl?: string
  /**
   * Live driver: keep one resident stream-json process per member and drive
   * turns over stdin messages (runtime-level graceful interrupt, same-shape
   * push stream) instead of one `claude -p` process per round. Default off;
   * the exec one-shot stays the fallback whenever the channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /**
   * Live mirror granularity: `event` mirrors the shared stream fold. `token`
   * still spawns with `--include-partial-messages` and reports per-token
   * deltas over the run-progress channel, but host 0.1.5 removed the
   * per-chunk session event, so deltas no longer land in the child session
   * log (the round settles as one combined final message).
   */
  liveMirrorGranularity?: 'event' | 'token'
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<Config> = z.object({
  permissionMode: z.union([
    z.const('skip'),
    z.const('normal'),
  ]),
  model: z.string(),
  baseUrl: z.string(),
  proxyUrl: z.string(),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

/** The permission mode a fresh delegation defaults to. */
export const DEFAULT_PERMISSION_MODE: NonNullable<Config['permissionMode']> = 'skip'

/**
 * Settings namespace for the settings-page card. The Cordis config feeds the
 * composition `base` layer, so a field absent from the user layer inherits the
 * YAML value — the card only ever stores deliberate overrides.
 */
export const CLAUDE_SETTINGS_NAMESPACE = 'local-agent-claude-code'

/**
 * The card's schema; field defaults are the innermost layer below `base`.
 * `model` deliberately carries NO default: an unset key must resolve to
 * undefined, which is what keeps the pre-key behavior byte-identical.
 */
const CLAUDE_SETTINGS_SCHEMA = z.object({
  live: z.boolean().default(false),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
  model: z.string(),
  recentModels: z.array(z.string()).default([]),
})

/**
 * Register the Claude Code harness into the local-agent registry.
 * @param ctx - plugin context carrying the registry.
 * @param config - plugin config; `permissionMode` selects the `claude -p` policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const permissionMode = config.permissionMode ?? DEFAULT_PERMISSION_MODE
    const baseUrl = config.baseUrl
    const homeDir = ctx.localAgent.homeDir('claude-code')
    // Claude creates the scoped home lazily; create it eagerly so the
    // harness's homeDir contract is uniform with the other harnesses.
    void provisionClaudeHome(homeDir, config.proxyUrl).catch((error: unknown) => {
      ctx.logger.warn(`local-agent-claude-code: scoped home provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // The live driver is settings-driven: the settings card's toggle (user
    // layer over the YAML composition base) swaps driver generations without
    // a reload. Toggling OFF drains the retiring generation — new rounds fall
    // back to exec, in-flight rounds finish on their runtime, idle runtimes
    // are reclaimed at once. A granularity change needs no new generation:
    // the driver reads it per round.
    const scope = ctx.settings.register(CLAUDE_SETTINGS_NAMESPACE, CLAUDE_SETTINGS_SCHEMA, {
      base: {
        ...config.live === undefined ? {} : { live: config.live },
        ...config.liveMirrorGranularity === undefined ? {} : { liveMirrorGranularity: config.liveMirrorGranularity },
        ...config.model === undefined ? {} : { model: config.model },
      },
    })
    // The model is read PER ROUND, not captured at apply: the settings card
    // writes the same namespace field, so a change has to reach the next
    // delegation without a plugin reload — exactly like the live toggle.
    // Blank is not a model: a whitespace-only value means "unset", which is
    // the pre-key argv.
    const resolveModel = (): string | undefined => {
      const model = scope.get().model?.trim()
      return model === undefined || model === '' ? undefined : model
    }
    const liveSwitch = new LiveDriverSwitch(ctx, scope, {
      ...config.permissionMode === undefined ? {} : { permissionMode: config.permissionMode },
      ...config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl },
      ...config.liveIdleMs === undefined ? {} : { liveIdleMs: config.liveIdleMs },
      model: resolveModel,
    })
    const disposeProvider = ctx.subagents.registerProvider(new ClaudeCliProvider(ctx, permissionMode, baseUrl, liveSwitch.resolve, resolveModel))
    const disposeHarness = ctx.localAgent.register({
      name: 'claude-code',
      displayName: 'Claude Code',
      homeEnvVar: 'CLAUDE_CONFIG_DIR',
      delegationProvider: 'claude-local',
      login: {
        // claude ≥2.1 (verified 2.1.235+) runs its auth only on a TTY: under
        // the pty wrapper it auto-opens the user's browser and prints the
        // OAuth URL as fallback; the page hands back a code the user pastes
        // via /claude-code code <value>. The relay env is scrubbed and the
        // scoped home pinned so the credential lands where delegations read
        // it (the wrapper passes the harness env through).
        // The argv pins the config directory itself (an `env NAME=VALUE`
        // assignment outranks the spawn env), so it is built from the
        // directory being logged in: `/claude-code login --scope <name>`
        // authorizes THAT scope, not the default one.
        pty: {
          command: 'env',
          args: (scopedHome: string) => ['-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_BASE_URL', `CLAUDE_CONFIG_DIR=${scopedHome}`, 'claude', 'auth', 'login'],
        },
        // The watch syncs the keychain credential into the runtime-readable
        // file first (claude 2.1.236 writes keychain but reads the file),
        // then probes.
        watch: async (home) => {
          await syncClaudeCredentialFile(home)
          return claudeAuthenticated(home)
        },
      },
      records: { listSessions: homeDir => listClaudeSessions(homeDir) },
      // A NAMED scope's directory is provisioned through this hook when the
      // registry materializes it — the same eager creation and settings the
      // default scope gets from the apply above.
      provision: scopedHome => provisionClaudeHome(scopedHome, config.proxyUrl).then(() => {}),
      isAuthenticated: claudeAuthenticated,
      credentialStamp: claudeCredentialStamp,
      logout: claudeLogout,
      // The eval snapshot: the permission mode is the plugin config resolved
      // at apply (it selects the spawn flags); the endpoint mirrors the
      // provider's own resolution order — the config item wins over the host
      // process environment's ANTHROPIC_BASE_URL. The model follows the
      // family's fixed order: the plugin config key (it rides every argv)
      // before the scoped settings.json's own `model`. The CLI's own default
      // model is never guessed, so neither one configured means no field.
      // The directory is a PARAMETER, not the apply-time capture: a status
      // read (or an evaluation snapshot) of a named scope must report the
      // settings that scope's rounds would run with.
      effectiveSettings: async (scopedHome) => {
        const effectiveBaseUrl = baseUrl ?? process.env.ANTHROPIC_BASE_URL
        const baseUrlHost = effectiveBaseUrl !== undefined ? endpointHost(effectiveBaseUrl) : undefined
        const [scopedModel, cliVersion] = await Promise.all([
          readClaudeConfiguredModel(scopedHome).catch(() => undefined),
          claudeCliVersion(ctx, scopedHome).catch(() => undefined),
        ])
        const model = resolveModel() ?? scopedModel
        return {
          drive: scope.get().live ? 'live' : 'exec',
          permissionMode,
          baseUrlSet: effectiveBaseUrl !== undefined,
          ...baseUrlHost !== undefined ? { baseUrlHost } : {},
          ...model !== undefined ? { model } : {},
          ...cliVersion !== undefined ? { cliVersion } : {},
        }
      },
      subcommand: (input: string, invocation: CommandInvocation): Promise<CommandResult> | undefined => {
        const [verb] = input.split(/\s+/)
        if (verb === 'sessions') {
          return listClaudeSessions(invocation.agent.ctx.localAgent.homeDir('claude-code'))
            .then(records => ({
              kind: 'success',
              text: records.length === 0
                ? 'No claude sessions in the scoped home yet.'
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
  }, 'local-agent-claude-code: harness')
}
