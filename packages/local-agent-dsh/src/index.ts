/**
 * dsh harness instantiation of the local-agent family. At startup the plugin
 * registers the `dsh` harness into the core registry (scoped home under the
 * shared homes root, `$DSH_HOME`) and the `dsh-cli` delegation provider
 * (sub-dsh headless runs with the parent's selected supported model route).
 * The delegation tool is the package's `./tool` entry, granted per session by
 * a preset, so installing the plugin alone adds nothing model-visible.
 *
 * The `local-agent-dsh` row carries the resident-mode preferences (`live`,
 * `liveMirrorGranularity`) and the default model: the row config is the
 * base, the settings card's writes are overrides on top, and a
 * LiveDriverSwitch hot-swaps driver generations on a change — no reload,
 * in-flight rounds never interrupted.
 *
 * The sub-dsh half lives in the sibling bundle
 * `@khorsheed/dsh-local-agent-dsh-headless`: a headless profile under the
 * scoped home that the provider spawns with `--session-id <uuid>` (fresh) or
 * `--resume <uuid>` (continuation).
 *
 * @module @khorsheed/dsh-local-agent-dsh
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import { settingsFace, vol } from '@khorsheed/dsh-local-agent'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type {} from '@khorsheed/dsh-local-agent'
import type { LocalAgentUnrecordedDeclaration } from '@khorsheed/dsh-local-agent'
import { CONTAINER_NODE_OPTIONS, DshCliProvider, dshCliVersion } from './dsh-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { DshModelCatalog, type DshModelDirectoryFace } from './model-catalog.ts'
import { canInheritModelProvider, localModelLaunch } from './model-launch.ts'
import { DshModelBroker } from './model-broker.ts'
import { listDshSessions } from './records.ts'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshScope } from './provision.ts'
import type { DshSubProfilePermissions } from './provision.ts'

/**
 * What the sub-dsh mirror leaves out (batch 5 S1), copied onto every
 * execution's `local-agent/execution` end record: the mirror copies only
 * user/assistant/tool/step events (session-mirror.ts), so the sub-dsh's own
 * `compaction/start|summary|end` and its summary call never cross —
 * `internal-calls` on every path; and a `/compact` round runs as a plain
 * prompt (the provider ignores the intent's `operation`) with no
 * `local-agent/compaction` written — `compaction`.
 */
export const DSH_UNRECORDED: LocalAgentUnrecordedDeclaration = {
  exec: ['internal-calls'],
  live: ['internal-calls'],
  compact: ['internal-calls', 'compaction'],
}

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-dsh'

/** Services required before the controller can mount. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'credentials', 'settings']

/** Plugin config: the sub-dsh profile and the credential it resolves. */
export interface LocalAgentDshConfig {
  /** Sub-dsh profile name under the scoped home. */
  profileName?: string
  /** Credential reference resolving the sub-dsh API key. */
  apiKeyRef?: string
  /**
   * dsh launch argv prefix override (node + entry + launcher flags). Absent
   * uses Desktop's packaged CLI when present, else the parent's own launch.
   */
  cliLaunch?: string[]
  /** Override the headless bundle directory the sub-profile symlinks to. */
  headlessBundleDir?: string
  /**
   * The headless bundle directory as an evaluation unit (container round)
   * sees it — the image's own install. Present, provisioning also writes a
   * `<profileName>-unit` sub-profile linking it, and container rounds launch
   * that one, while host rounds keep `headlessBundleDir` (default: this
   * instance's own headless). Absent, both share one sub-profile.
   */
  unitHeadlessBundleDir?: string
  /**
   * The sub-dsh's permission boundary: the sandbox mode every confined call
   * runs under, paired with the approval policy `dsh-base`'s own preset table
   * pairs it with. Provisioning writes it into the scope's sub-profile as a
   * patch layer, so a scoped home carries its own boundary — including into a
   * container unit that bind-mounts it.
   *
   * Absent — the default — writes no layer at all: the sub-dsh runs whatever
   * `dsh-base` composes (`workspace-write` plus `ask`), byte for byte the
   * behavior before this key existed. Pin `danger-full-access` only where
   * something else IS the boundary (an evaluation unit, a disposable
   * container); on a developer's machine the sub-dsh shares the real home.
   */
  permissions?: DshSubProfilePermissions
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
  /** @deprecated Accepted for old profiles; live output is always incremental. */
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
  /** Model identifiers the settings card saved before (settings field). */
  recentModels?: readonly string[]
}

/**
 * Runtime schema so the Loader always passes an object, never undefined.
 * The settings fields (`live`, `liveMirrorGranularity`, `model`,
 * `recentModels`) ride the same schema marked `.volatile()`: the
 * SettingsForms writes hot-track the running fiber's Volatile references
 * without a remount. A row still carrying the retired `enabled` key loads
 * unchanged (the object schema is not strict) and the key is ignored.
 *
 * Bare `z` annotation: `z<LocalAgentDshConfig>` fails schemastery 3.18.4's
 * variance under exactOptionalPropertyTypes (TS2375) and dropping the
 * annotation trips TS2742; the interface stays the apply signature's contract.
 */
export const Config: z = z.object({
  profileName: z.string().default(DEFAULT_SUB_PROFILE_NAME),
  apiKeyRef: z.string(),
  cliLaunch: z.array(z.string()),
  headlessBundleDir: z.string(),
  unitHeadlessBundleDir: z.string(),
  permissions: z.union([z.const('read-only'), z.const('workspace-write'), z.const('danger-full-access')]),
  // `model` deliberately carries NO default: an unset key must resolve to
  // undefined, which is what keeps the pre-key behavior byte-identical.
  model: z.string().volatile(),
  live: z.boolean().default(true).volatile(),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('token').volatile(),
  recentModels: z.array(z.string()).default([]).volatile(),
})

/**
 * The settings row id: the namespace `settings/document-updated` emits for
 * this provider (the row config IS the settings document).
 */
const SETTINGS_NAMESPACE = 'local-agent-dsh'

/** The resolved settings the controller and the live switch consume. */
export interface DshSettings {
  /** Resident (live) mode. */
  live: boolean
  /** @deprecated Legacy granularity; live output is always incremental. */
  liveMirrorGranularity: 'event' | 'token'
  /** The delegation-start model, undefined when unset (pass no `--model`). */
  model: string | undefined
  /** Model identifiers saved before; the input's suggestions. */
  recentModels: readonly string[]
}

/**
 * Mount the controller: resolve the settings face, then register the harness
 * and provider with a live-driver switch that follows the settings.
 * @param ctx - plugin context carrying the family registry, subagents,
 *   subprocess, credentials, and settings services.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: LocalAgentDshConfig): void {
  ctx.effect(() => {
    // The settings face reads the row config's volatile fields and re-reads
    // on `settings/document-updated`, hot-applying the card's writes without
    // a reload.
    const readSettings = (): DshSettings => ({
      live: vol(config.live) ?? true,
      liveMirrorGranularity: vol(config.liveMirrorGranularity) ?? 'token',
      model: vol(config.model),
      recentModels: vol(config.recentModels) ?? [],
    })
    const face = settingsFace<DshSettings>(ctx, {
      namespace: SETTINGS_NAMESPACE,
      // Card writes live in the harness's own store (card-settings.ts), never the profile patch.
      harness: 'dsh',
      read: readSettings,
    })
    // Read PER ROUND, not captured at apply: the settings card writes the same
    // field, so a change has to reach the next delegation without a
    // plugin reload. Blank is not a model — a whitespace-only value is unset.
    const resolveModel = (): string | undefined => {
      const model = face.get().model?.trim()
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
    const modelCatalog = new DshModelCatalog({
      llm: () => ctx.get('llm') as DshModelDirectoryFace | undefined,
      defaultModel: hostDefaultModel,
      canInheritProvider: provider => canInheritModelProvider(ctx, provider),
    })
    void modelCatalog.read()
    ctx.on('llm/adapters-updated', () => { modelCatalog.invalidate() })
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
      defaultEffort: () => ctx.get('agentDefaultModel')?.currentSelection().reasoningEffort,
      discovered: () => modelCatalog.read().entries.filter(entry => !entry.hidden).map(entry => entry.value),
      catalog: modelCatalog,
      recentModels: () => face.get().recentModels ?? [],
      live: () => face.get().live,
      overrides: memberModelOverrides,
      liveBoundModel: childSessionId => currentLiveSwitch?.boundModel(childSessionId) ?? null,
      retireRuntime: childSessionId => currentLiveSwitch?.retireRuntime(childSessionId) ?? Promise.resolve(),
    })
    /**
     * This instance's own profile directory — the loader's `baseUrl`, which
     * the host sets to the directory holding the profile's `cordis.yml`. Its
     * direct dependencies are where an installed preset package is found, and
     * the SOURCE every scope's own copy is taken from (the same package this
     * instance's capability catalog measures). Undefined when the loader
     * exposes no file URL, which leaves a scope able to keep the copy it has
     * but unable to take a new one.
     */
    const instanceProfileDir = (): string | undefined => {
      const baseUrl = (ctx as { baseUrl?: unknown }).baseUrl
      if (typeof baseUrl !== 'string' || !baseUrl.startsWith('file:')) return undefined
      try {
        return dirname(fileURLToPath(new URL('./package.json', baseUrl)))
      } catch {
        return undefined
      }
    }
    const profileDirOption = (): { instanceProfileDir?: string } => {
      const dir = instanceProfileDir()
      return dir === undefined ? {} : { instanceProfileDir: dir }
    }
    const harness: LocalAgentHarness = {
      prepareMember: async ({ binding, childSession, configuration, signal }) => {
        const driver = currentLiveSwitch?.resolve(binding.childSessionId)
        if (driver === undefined || driver.disabled) throw new Error('Enable the native live harness before preparing a coordinator')
        await driver.prepare({ cwd: binding.cwd, homeDir: ctx.localAgent.homeDir('dsh', binding.scope), childSession,
          parentSessionId: binding.parentSessionId, configuration: configuration.resolved, sessionId: binding.childSessionId }, signal)
      },
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      unrecorded: DSH_UNRECORDED,
      delegationProvider: 'dsh-cli',
      modelBroker,
      records: { listSessions: homeDir => listDshSessions(homeDir) },
      // A NAMED scope's directory is provisioned through this hook when the
      // registry materializes it: the sub-profile the round launches from
      // lives inside the scoped home, so a scope needs its own. (The
      // credential does not: dsh authenticates through the host instance,
      // which is why `isAuthenticated` below reads no directory at all.)
      // `options.preset` is the per-condition input an evaluation's
      // `conditions provision` hands in; the scope's own declaration answers
      // for every other call, which is what makes a rostered preset survive
      // a restart of this instance.
      provision: (scopedHome, options) => {
        const provisioned = provisionDshScope(scopedHome, config, {
          ...(options?.preset === undefined ? {} : { preset: options.preset }),
          ...(profileDirOption()),
        })
        return {
          ...(provisioned.preset === undefined ? {} : { preset: provisioned.preset }),
          ...(provisioned.presetSnapshot === undefined ? {} : { presetSnapshot: provisioned.presetSnapshot }),
        }
      },
      isAuthenticated: async () => {
        try {
          await localModelLaunch(ctx, config, resolveModel() ?? hostDefaultModel())
          return true
        } catch {
          return false
        }
      },
      // The eval snapshot. `sandbox` is the sub-profile's pinned permission
      // boundary, reported exactly when one is configured: absence still
      // means "this scope pins no boundary and runs what dsh-base composes",
      // which is the honest condition-hash input for every deployment that
      // never asked for one. Until T59 there was no knob to report at all,
      // and the dsh rounds inside an evaluation unit paid for it — bash
      // refused every call because the unit has no sandbox backend and a
      // headless sub-dsh has no approval channel.
      // The endpoint is the host instance's model config, which this provider
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
          drive: face.get().live ? 'live' : 'exec',
          baseUrlSet: false,
          // dsh is the only harness that needs an extra node flag to run
          // inside a container (undici does not read the proxy variables on
          // its own). The provider injects it unconditionally on a container
          // target, so the snapshot states it unconditionally — the condition
          // file records the knob rather than leaving the fairest-to-compare
          // difference between the four harnesses invisible.
          containerNodeOptions: CONTAINER_NODE_OPTIONS,
          // The CONFIGURED boundary, not a read-back of the sub-profile: this
          // key is what provisioning writes, and it is in force for the very
          // first round of a scope whose directory the hook has not
          // materialized yet. Same shape as codex, which reports the sandbox
          // policy its own config key puts on every argv.
          ...config.permissions !== undefined ? { sandbox: config.permissions } : {},
          ...model !== undefined ? { model } : {},
          ...cliVersion !== undefined ? { cliVersion } : {},
        }
      },
    }
    const homeDir = ctx.localAgent.homeDir('dsh')

    // Always on: installing the plugin is the intent; a preset still decides
    // which sessions see `subagent_dsh` (this package's `./tool` entry,
    // src/tool.ts — never mounted at the profile root).
    const disposers: Array<() => void> = []
    // Idempotent: heals a deleted or drifted sub-profile before each round.
    provisionDshScope(homeDir, config, profileDirOption())
    disposers.push(ctx.localAgent.register(harness))
    // The live driver is settings-driven: the card's toggle (overrides on top
    // of the row config) swaps driver generations without a reload. Toggling
    // live OFF drains the retiring generation — new rounds fall back to exec,
    // in-flight rounds finish on their runtime, idle runtimes are reclaimed at
    // once. A legacy granularity setting no longer changes live behavior.
    // Plugin unload keeps the hard semantics: the provider unregisters and
    // the switch disposes (disposeAll).
    const liveSwitch = new LiveDriverSwitch(ctx, face, config, {
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
    return () => {
      modelCatalog.dispose()
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'local-agent-dsh: controller')
}
