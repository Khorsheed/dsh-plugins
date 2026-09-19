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
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@khorsheed/dsh-local-agent'
import { endpointHost } from '@khorsheed/dsh-local-agent/types'
import { CodexCliProvider, codexCliVersion } from './codex-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { CodexModelBroker } from './model-broker.ts'
import { CodexModelCatalog } from './model-catalog.ts'
import { codexAuthenticated, listCodexSessions } from './records.ts'
import { codexCredentialStamp, codexLogout, provisionCodexConfig, readCodexBaseUrl, readCodexModel, readCodexReasoningEffort } from './provision.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-codex'

/**
 * Boot delay before the model catalog's eager warmup probe fires. The probe
 * spawns a `codex app-server` — cheap, but not free — so it waits out the
 * boot storm instead of competing with it, and the FIRST settings-card open
 * usually hits a warm cache. A card opened before the timer fires simply
 * triggers the probe itself (the read path's lazy kick), so the delay never
 * costs correctness. Kept short: a setting visible within seconds of boot.
 */
export const CATALOG_WARMUP_DELAY_MS = 1_500

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'settings']

/** Plugin config: the sandbox mode fresh delegations default to, plus the live driver. */
export interface Config {
  /** Codex sandbox policy for `codex exec` / app-server threads; defaults to workspace-write. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /**
   * The model every delegation round starts the CLI with (`codex exec -m
   * <model>`, and `-c model=…` for the resident app-server). Absent — the
   * default — passes NO model flag at all: the scoped `config.toml`'s own
   * `model`, or codex's built-in default with none, decides exactly as it did
   * before this key existed. The settings card writes the same key, so a
   * change applies to the next round without a reload.
   */
  model?: string
  /**
   * Live driver: keep one resident `codex app-server` process per member and
   * drive turns over the app-server wire (runtime-level interrupt, push-mode
   * mirroring) instead of one `codex exec` process per round. Default off;
   * the exec one-shot stays the fallback whenever the channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /** @deprecated Accepted for old profiles; live output is always incremental. */
  liveMirrorGranularity?: 'event' | 'token'
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<Config> = z.object({
  sandbox: z.union([
    z.const('read-only'),
    z.const('workspace-write'),
    z.const('danger-full-access'),
  ]),
  model: z.string(),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('token'),
})

/** The sandbox policy a fresh delegation defaults to. */
export const DEFAULT_SANDBOX: NonNullable<Config['sandbox']> = 'workspace-write'

/**
 * Settings namespace for the settings-page card. The Cordis config feeds the
 * composition `base` layer, so a field absent from the user layer inherits the
 * YAML value — the card only ever stores deliberate overrides.
 */
export const CODEX_SETTINGS_NAMESPACE = 'local-agent-codex'

/**
 * The card's schema; field defaults are the innermost layer below `base`.
 * `model` deliberately carries NO default: an unset key must resolve to
 * undefined, which is what keeps the pre-key behavior byte-identical.
 */
const CODEX_SETTINGS_SCHEMA = z.object({
  live: z.boolean().default(false),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('token'),
  model: z.string(),
  recentModels: z.array(z.string()).default([]),
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
    // are reclaimed at once. Legacy granularity settings are accepted but ignored.
    const scope = ctx.settings.register(CODEX_SETTINGS_NAMESPACE, CODEX_SETTINGS_SCHEMA, {
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
    // The member-level model surface: the composer picker's session-level
    // overrides (in-memory, deliberately lost on a host restart), shared by
    // reference with the broker (which writes them), the exec provider (which
    // consults them per round), and the live driver (which binds them at
    // runtime spawn). A switch on a member with a live runtime bound to a
    // different model retires that runtime — the next round respawns onto the
    // new model while the codex thread itself resumes.
    const memberModelOverrides = new Map<string, string>()
    const modelCatalog = new CodexModelCatalog({
      spawn: spec => ctx.subprocess.spawn(spec),
      warn: message => ctx.logger.warn(message),
    })
    // Eager warmup: kick one background probe of the DEFAULT scoped home
    // shortly after apply completes (never blocking it — read() is the
    // synchronous cache read whose only side effect is the background
    // re-probe), so the first settings-card open usually serves the warm
    // cache instead of reading an empty one and waiting a TTL window. Named
    // scopes keep the lazy path: their first modelInfo read probes on demand.
    // The timer is unref'd (it must not hold the host process open) and
    // cleared on dispose (an unloaded plugin spawns nothing).
    const warmup = setTimeout(() => {
      void modelCatalog.read(homeDir)
    }, CATALOG_WARMUP_DELAY_MS)
    warmup.unref()
    const liveSwitch = new LiveDriverSwitch(ctx, scope, {
      sandbox,
      model: childSessionId => memberModelOverrides.get(childSessionId) ?? resolveModel(),
      ...config.liveIdleMs === undefined ? {} : { liveIdleMs: config.liveIdleMs },
    })
    const modelBroker = new CodexModelBroker({
      ctx,
      settingsModel: resolveModel,
      recentModels: () => scope.get().recentModels ?? [],
      homeDir: childSessionId => ctx.localAgent.homeDir('codex', childSessionId === undefined ? undefined : (ctx.localAgent.memberBinding?.(childSessionId) ?? ctx.localAgent.getDelegation(childSessionId))?.scope),
      cwd: childSessionId => childSessionId === undefined ? undefined : (ctx.localAgent.memberBinding?.(childSessionId) ?? ctx.localAgent.getDelegation(childSessionId))?.cwd,
      directory: (home, cwd) => modelCatalog.directory(home, cwd),
      refreshDirectory: (home, cwd) => modelCatalog.refresh(home, cwd),
      followDirectory: (home, cwd, signal) => modelCatalog.follow(home, signal, cwd),
      live: () => scope.get().live,
      overrides: memberModelOverrides,
      liveBoundModel: childSessionId => liveSwitch.boundModel(childSessionId),
      retireRuntime: childSessionId => liveSwitch.retireRuntime(childSessionId),
      // The account catalog probe is LAZY per read: read() serves the cache
      // and kicks a background probe when stale; the apply above warms the
      // default scope's cache so the first card open usually hits it.
      catalog: (scopedHome, cwd) => modelCatalog.read(scopedHome, cwd),
      // The account's built-in default slug (the probe's isDefault entry) —
      // the layer that names the CLI's compiled default, read off the same
      // cache.
      catalogDefault: (scopedHome, cwd) => modelCatalog.readDefault(scopedHome, cwd),
    })
    const disposeProvider = ctx.subagents.registerProvider(
      new CodexCliProvider(ctx, sandbox, liveSwitch.resolve, resolveModel, childSessionId => memberModelOverrides.get(childSessionId)),
    )
    const disposeHarness = ctx.localAgent.register({
      prepareMember: async ({ binding, childSession, configuration, signal }) => {
        const driver = liveSwitch.resolve(binding.childSessionId)
        if (driver === undefined || driver.disabled) throw new Error('Enable the native live harness before preparing a coordinator')
        await driver.prepare({ cwd: binding.cwd, homeDir: ctx.localAgent.homeDir('codex', binding.scope), childSession,
          parentSessionId: binding.parentSessionId, configuration: configuration.resolved,  }, signal)
      },
      name: 'codex',
      displayName: 'Codex',
      homeEnvVar: 'CODEX_HOME',
      delegationProvider: 'codex-local',
      modelBroker,
      // A PTY run of plain `codex login` starts a localhost callback server
      // (no device code, no paste) and opens the browser itself — the
      // first-class flow. `--device-auth` remains the documented headless
      // fallback for remote terminals.
      login: { pty: { command: 'codex', args: ['login'] } },
      records: { listSessions: homeDir => listCodexSessions(homeDir) },
      // A NAMED scope's directory is provisioned through this hook when the
      // registry materializes it — the same `config.toml` storage pin the
      // default scope gets from the apply above, so a scope's first login
      // lands in its own `auth.json` instead of the macOS keychain.
      provision: scopedHome => provisionCodexConfig(scopedHome).then(() => {}),
      isAuthenticated: codexAuthenticated,
      credentialStamp: codexCredentialStamp,
      logout: codexLogout,
      // The eval snapshot: the sandbox policy comes from the plugin config
      // (it rides every spawn argv); effort and endpoint are read live from
      // the scoped config, which codex itself reads — a person-edited value
      // is exactly what the rounds run with. The model follows the family's
      // fixed order: the plugin config key (it overrides the file on every
      // argv) before the scoped config's own `model`, absent when neither
      // names one.
      // The directory is a PARAMETER, not the apply-time capture: a status
      // read (or an evaluation snapshot) of a named scope must report the
      // config that scope's rounds would run with, which is the config in
      // that scope's own directory.
      effectiveSettings: async (scopedHome) => {
        const [reasoningEffort, baseUrl, scopedModel, cliVersion] = await Promise.all([
          readCodexReasoningEffort(scopedHome).catch(() => undefined),
          readCodexBaseUrl(scopedHome).catch(() => undefined),
          readCodexModel(scopedHome).catch(() => undefined),
          codexCliVersion(ctx, scopedHome).catch(() => undefined),
        ])
        const model = resolveModel() ?? scopedModel
        const baseUrlHost = baseUrl !== undefined ? endpointHost(baseUrl) : undefined
        return {
          drive: scope.get().live ? 'live' : 'exec',
          sandbox,
          ...reasoningEffort !== undefined ? { reasoningEffort } : {},
          baseUrlSet: baseUrl !== undefined,
          ...baseUrlHost !== undefined ? { baseUrlHost } : {},
          ...model !== undefined ? { model } : {},
          ...cliVersion !== undefined ? { cliVersion } : {},
        }
      },
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
      clearTimeout(warmup)
      modelCatalog.dispose()
      disposeProvider()
      disposeHarness()
      liveSwitch.dispose()
    }
  }, 'local-agent-codex: harness')
}
