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
 * The sub-dsh half lives in the sibling bundle
 * `@khorsheed/dsh-local-agent-dsh-headless`: a headless profile under the
 * scoped home that the provider spawns with `--session-id <uuid>` (fresh) or
 * `--resume <uuid>` (continuation).
 *
 * @module @khorsheed/dsh-local-agent-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type {} from '@khorsheed/dsh-local-agent'
import * as toolModule from '@khorsheed/dsh-local-agent-tool-subagent'
import { DshCliProvider } from './dsh-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS, DshLiveDriver } from './live-driver.ts'
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
   * instead of one process per round. Default off; the exec one-shot stays
   * the fallback whenever the serve channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /**
   * Live mirror granularity: `event` mirrors finalized messages;
   * `token` additionally appends `assistant/chunk` deltas (write amplification
   * — opt-in).
   */
  liveMirrorGranularity?: 'event' | 'token'
}

/** Runtime schema so the Loader always passes an object, never undefined. */
export const Config: z<LocalAgentDshConfig> = z.object({
  profileName: z.string().default(DEFAULT_SUB_PROFILE_NAME),
  apiKeyRef: z.string().default('DEEPSEEK_API_KEY'),
  cliLaunch: z.array(z.string()),
  headlessBundleDir: z.string(),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

/** Settings namespace owning the DeepSeek toggle. */
export const DSH_SETTINGS_NAMESPACE = settingsNamespace('local-agent-dsh')

/** The toggle's schema: OFF (default) means the official in-process subagent stays the only delegation path. */
const DSH_SETTINGS_SCHEMA = z.object({ enabled: z.boolean().default(false) })

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
    const scope = ctx.settings.register(DSH_SETTINGS_NAMESPACE, DSH_SETTINGS_SCHEMA)
    const harness: LocalAgentHarness = {
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      delegationProvider: 'dsh-cli',
      records: { listSessions: homeDir => listDshSessions(homeDir) },
      isAuthenticated: async () => {
        try {
          return (await resolveApiKey(ctx, config)) !== undefined
        } catch {
          return false
        }
      },
    }
    const homeDir = ctx.localAgent.homeDir('dsh')

    let generation = 0
    const disposers: Array<() => void> = []
    const sync = (enabled: boolean): void => {
      generation += 1
      const gen = generation
      for (const dispose of disposers.splice(0)) dispose()
      if (!enabled) return
      // Idempotent: heals a deleted or drifted sub-profile before each round.
      provisionDshSubProfile(homeDir, config)
      disposers.push(ctx.localAgent.register(harness))
      // The live driver owns every resident runtime of this generation; its
      // disposal runs after the provider unregisters, so no in-flight round
      // can re-spawn a runtime the teardown already reclaimed.
      const liveDriver = config.live === true ? new DshLiveDriver(ctx, config) : undefined
      disposers.push(ctx.subagents.registerProvider(new DshCliProvider(ctx, config, liveDriver)))
      if (liveDriver !== undefined) {
        disposers.push(() => { void liveDriver.disposeAll() })
      }
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
