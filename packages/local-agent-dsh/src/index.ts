/**
 * dsh harness instantiation of the local-agent family, plus the DeepSeek
 * settings toggle that gates it. Registers the `local-agent-dsh` settings
 * namespace (default off); while ON, the controller registers the `dsh`
 * harness into the core registry (scoped home under the shared homes root,
 * `$DSH_HOME`), the `dsh-cli` delegation provider (sub-dsh headless runs with
 * the parent's resolved DeepSeek key), and the family delegation tool for it.
 * While OFF — the default — nothing model-visible mounts, so the instance
 * keeps exactly the current behavior (official in-process subagent tools) and
 * the model never sees two overlapping delegation tools at once.
 *
 * The same namespace carries the resident-mode preferences (`live`,
 * `liveMirrorGranularity`): the YAML config is the composition base, the
 * settings card's writes are user-layer overrides, and a LiveDriverSwitch
 * inside each enabled generation hot-swaps driver generations on a change —
 * no reload, in-flight rounds never interrupted.
 *
 * The sub-dsh half lives in the sibling bundle
 * `@khorsheed/dsh-local-agent-dsh-headless`: a headless profile under the
 * scoped home that the provider spawns with `--session-id <uuid>` (fresh) or
 * `--resume <uuid>` (continuation).
 *
 * @module @khorsheed/dsh-local-agent-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type {} from '@khorsheed/dsh-local-agent'
import * as toolModule from '@khorsheed/dsh-local-agent-tool-subagent'
import { CONTAINER_NODE_OPTIONS, DshCliProvider, dshCliVersion } from './dsh-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { DshModelBroker } from './model-broker.ts'
import { listDshSessions } from './records.ts'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshSubProfile } from './provision.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-dsh'

/** Services required before the toggle controller can mount. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'credentials', 'settings']

/** Plugin config: the sub-dsh profile and the credential it resolves. */
export interface LocalAgentDshConfig {
  /** Sub-dsh profile name under the scoped home. */
  profileName?: string
  /** Credential reference resolving the sub-dsh API key. */
  apiKeyRef?: string
  /**
   * dsh launch argv prefix override (node + entry + launcher flags). Absent
   * means replicate the parent instance's own launch.
   */
  cliLaunch?: string[]
  /** Override the headless bundle directory the sub-profile symlinks to. */
  headlessBundleDir?: string
  /**
   * Live driver: keep one resident sub-dsh serve process per member and drive
   * turns over the family wire (runtime-level interrupt, push-mode mirror)
   * instead of one process per round. Deployment default only — the settings
   * namespace carries it as the composition base, so the settings card can
   * override it live; the exec one-shot stays the fallback whenever the serve
   * channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /**
   * Live mirror granularity: `event` mirrors finalized messages. `token`
   * still reports per-token deltas over the run-progress channel, but host
   * 0.1.5 removed the per-chunk session event, so deltas no longer land in
   * the child session log (the round settles as one combined final message).
   * Deployment default; the settings card can override it live.
   */
  liveMirrorGranularity?: 'event' | 'token'
  /**
   * The model every delegation round starts the sub-dsh with, spelled
   * `provider/model` (a bare id names the model and keeps the instance's
   * provider) — passed as the headless launch's `--model`. Absent — the
   * default — passes no flag at all: the sub-dsh runs the host instance's own
   * `agentDefaultModel` selection, exactly as it did before this key existed.
   *
   * A delegation that names its own model outranks this key; the settings
   * card writes the same key, so a change applies to the next round without a
   * reload.
   */
  model?: string
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<LocalAgentDshConfig> = z.object({
  profileName: z.string().default(DEFAULT_SUB_PROFILE_NAME),
  apiKeyRef: z.string().default('DEEPSEEK_API_KEY'),
  cliLaunch: z.array(z.string()),
  headlessBundleDir: z.string(),
  model: z.string(),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

/**
 * Settings namespace owning the DeepSeek toggle and the live preferences. The
 * Cordis config feeds the composition `base` layer, so a field absent from
 * the user layer inherits the YAML value — the settings card only ever stores
 * deliberate overrides.
 */
export const DSH_SETTINGS_NAMESPACE = 'local-agent-dsh'

/**
 * The card's schema: `enabled` OFF (default) means the official in-process
 * subagent stays the only delegation path; the live fields mirror the YAML
 * config's deployment defaults through the composition base.
 */
const DSH_SETTINGS_SCHEMA = z.object({
  enabled: z.boolean().default(false),
  live: z.boolean().default(false),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
  // `model` deliberately carries NO default: an unset key must resolve to
  // undefined, which is what keeps the pre-key behavior byte-identical.
  model: z.string(),
  recentModels: z.array(z.string()).default([]),
})

/** The delegation tool the toggle mounts while ON. */
const DSH_TOOL_NAME = 'subagent_dsh'

/** Resolve the sub-dsh credential or report unconfigured. */
async function resolveApiKey(ctx: Context, config: LocalAgentDshConfig): Promise<ResolvedCredential | undefined> {
  return ctx.credentials.resolve(credentialRef(config.apiKeyRef ?? 'DEEPSEEK_API_KEY'))
}

/**
 * Mount the toggle controller: register the settings namespace, then mirror
 * its value into harness/provider/tool registrations, live.
 * @param ctx - plugin context carrying the family registry, subagents,
 *   subprocess, credentials, and settings services.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: LocalAgentDshConfig): void {
  ctx.effect(() => {
    const scope = ctx.settings.register(DSH_SETTINGS_NAMESPACE, DSH_SETTINGS_SCHEMA, {
      base: {
        ...config.live === undefined ? {} : { live: config.live },
        ...config.liveMirrorGranularity === undefined ? {} : { liveMirrorGranularity: config.liveMirrorGranularity },
        ...config.model === undefined ? {} : { model: config.model },
      },
    })
    // Read PER ROUND, not captured at apply: the settings card writes the same
    // namespace field, so a change has to reach the next delegation without a
    // plugin reload. Blank is not a model — a whitespace-only value is unset.
    const resolveModel = (): string | undefined => {
      const model = scope.get().model?.trim()
      return model === undefined || model === '' ? undefined : model
    }
    // The host instance's default model selection spelled `provider/model` —
    // what a sub-dsh with no `--model` inherits. Undefined when the service or
    // the selection is unreadable: absence is the honest answer, never a guess.
    const hostDefaultModel = (): string | undefined => {
      try {
        const defaultModel = ctx.get('agentDefaultModel') as
          | { currentSelection?: () => { provider?: string; model?: string } }
          | undefined
        const selection = defaultModel?.currentSelection?.()
        if (typeof selection?.model === 'string' && selection.model !== '') {
          return typeof selection.provider === 'string' && selection.provider !== ''
            ? `${selection.provider}/${selection.model}`
            : selection.model
        }
      } catch {
        // Degrade: an unreadable selection reports no model instead of
        // breaking the status surface.
      }
      return undefined
    }
    // The host's own adapter enumeration — the pickable vocabulary for the
    // sub-dsh, which routes through the same host adapters spelled
    // `provider/model`. `ctx.llm` is the public LlmRuntime surface the host's
    // model picker itself is built on (listProviders × listModels, refreshed
    // on llm/adapters-updated); probed, never assumed, and a failed provider
    // costs only its own group — the picker's other layers still answer.
    const discoveredModels: string[] = []
    const refreshDiscoveredModels = async (): Promise<void> => {
      try {
        const llm = ctx.get('llm') as
          | {
              listProviders?: () => readonly { id: string }[]
              listModels?: (provider: string) => Promise<readonly { id: string }[]>
            }
          | undefined
        if (typeof llm?.listProviders !== 'function' || typeof llm.listModels !== 'function') return
        const listModels = llm.listModels.bind(llm)
        const groups = await Promise.all(llm.listProviders().map(async (provider) => {
          try {
            return (await listModels(provider.id)).map(model => `${provider.id}/${model.id}`)
          } catch {
            return []
          }
        }))
        discoveredModels.splice(0, discoveredModels.length, ...groups.flat())
      } catch {
        // Degrade: an unreadable enumeration leaves discovery empty.
      }
    }
    void refreshDiscoveredModels()
    ctx.on('llm/adapters-updated', () => { void refreshDiscoveredModels() })
    // The member-level model surface: the composer picker's session-level
    // overrides (in-memory, deliberately lost on a host restart), shared by
    // reference with the broker (which writes them), the exec provider (which
    // consults them per round), and the live driver (which binds them at
    // runtime spawn). A switch on a member with a live runtime bound to a
    // different model retires that runtime — the next round respawns onto the
    // new model while the sub-dsh session itself resumes from disk.
    const memberModelOverrides = new Map<string, string>()
    let currentLiveSwitch: LiveDriverSwitch | undefined
    const modelBroker = new DshModelBroker({
      ctx,
      settingsModel: resolveModel,
      cliDefault: hostDefaultModel,
      discovered: () => discoveredModels,
      recentModels: () => scope.get().recentModels ?? [],
      live: () => scope.get().live,
      overrides: memberModelOverrides,
      liveBoundModel: childSessionId => currentLiveSwitch?.boundModel(childSessionId) ?? null,
      retireRuntime: childSessionId => currentLiveSwitch?.retireRuntime(childSessionId) ?? Promise.resolve(),
    })
    const harness: LocalAgentHarness = {
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      delegationProvider: 'dsh-cli',
      modelBroker,
      records: { listSessions: homeDir => listDshSessions(homeDir) },
      // A NAMED scope's directory is provisioned through this hook when the
      // registry materializes it: the sub-profile the round launches from
      // lives inside the scoped home, so a scope needs its own. (The
      // credential does not: dsh authenticates through the host instance,
      // which is why `isAuthenticated` below reads no directory at all.)
      provision: scopedHome => { provisionDshSubProfile(scopedHome, config) },
      isAuthenticated: async () => {
        try {
          return (await resolveApiKey(ctx, config)) !== undefined
        } catch {
          return false
        }
      },
      // The eval snapshot. No sandbox or permission field: a headless sub-dsh
      // has no such knob (the web-eval frozen baseline calls this harness
      // unrestricted — absence IS the honest condition-hash input). The
      // endpoint is the host instance's model config, which this provider
      // never overrides, so no custom endpoint is ever pinned. The model is
      // the host's default selection the sub-dsh inherits (the headless agent
      // loader reads the same service), reported as `provider/model`; a
      // composition without the service — or a selection that fails to read —
      // reports no model rather than a guessed identifier.
      // The directory is a PARAMETER, not a re-resolution of the default
      // scope: an evaluation snapshot of a named scope must probe the CLI the
      // way that scope's rounds launch it.
      effectiveSettings: async (scopedHome) => {
        const cliVersion = await dshCliVersion(ctx, config, scopedHome).catch(() => undefined)
        // The family's fixed order: the plugin config key (it rides every
        // launch as `--model`) before the host selection the sub-dsh would
        // otherwise inherit.
        const model = resolveModel() ?? hostDefaultModel()
        return {
          drive: scope.get().live ? 'live' : 'exec',
          baseUrlSet: false,
          // dsh is the only harness that needs an extra node flag to run
          // inside a container (undici does not read the proxy variables on
          // its own). The provider injects it unconditionally on a container
          // target, so the snapshot states it unconditionally — the condition
          // file records the knob rather than leaving the fairest-to-compare
          // difference between the four harnesses invisible.
          containerNodeOptions: CONTAINER_NODE_OPTIONS,
          ...model !== undefined ? { model } : {},
          ...cliVersion !== undefined ? { cliVersion } : {},
        }
      },
    }
    const homeDir = ctx.localAgent.homeDir('dsh')

    let generation = 0
    let currentEnabled: boolean | undefined
    const disposers: Array<() => void> = []
    const sync = (enabled: boolean): void => {
      // The watch fires on ANY namespace field change; only an enabled flip
      // re-registers — the live fields ride the LiveDriverSwitch instead.
      if (enabled === currentEnabled) return
      currentEnabled = enabled
      generation += 1
      const gen = generation
      for (const dispose of disposers.splice(0)) dispose()
      if (!enabled) return
      // Idempotent: heals a deleted or drifted sub-profile before each round.
      provisionDshSubProfile(homeDir, config)
      disposers.push(ctx.localAgent.register(harness))
      // The live driver is settings-driven WITHIN this enabled generation:
      // the card's toggle (user layer over the YAML composition base) swaps
      // driver generations without a reload. Toggling live OFF drains the
      // retiring generation — new rounds fall back to exec, in-flight rounds
      // finish on their runtime, idle runtimes are reclaimed at once. A
      // granularity change needs no new generation: the driver reads it per
      // round. Toggling ENABLED off keeps the historical hard semantics:
      // provider unregisters and the switch disposes (disposeAll).
      const liveSwitch = new LiveDriverSwitch(ctx, scope, config, {
        modelFor: childSessionId => memberModelOverrides.get(childSessionId) ?? resolveModel(),
      })
      currentLiveSwitch = liveSwitch
      disposers.push(ctx.subagents.registerProvider(
        new DshCliProvider(ctx, config, liveSwitch.resolve, resolveModel, childSessionId => memberModelOverrides.get(childSessionId)),
      ))
      // The switch's disposal runs after the provider unregisters, so no
      // in-flight round can re-spawn a runtime the teardown already reclaimed.
      disposers.push(() => {
        if (currentLiveSwitch === liveSwitch) currentLiveSwitch = undefined
        liveSwitch.dispose()
      })
      // The family delegation tool is mounted dynamically so the toggle owns
      // its lifecycle — while OFF the model never sees `subagent_dsh`.
      void ctx.plugin(toolModule, { provider: 'dsh-cli', toolName: DSH_TOOL_NAME }).then(
        (fiber) => {
          if (gen !== generation) {
            void fiber.dispose()
            return
          }
          disposers.push(() => { void fiber.dispose() })
        },
        (error: unknown) => {
          ctx.logger.warn(`local-agent-dsh: delegation tool mount failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      )
    }
    sync(scope.get().enabled)
    const unwatch = scope.watch((next) => { sync(next.enabled) })
    return () => {
      unwatch()
      // Bump the generation so a tool mount still in flight disposes itself
      // instead of being pushed onto a dead disposer list.
      generation += 1
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'local-agent-dsh: toggle controller')
}
