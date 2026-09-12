/**
 * Kimi Code harness instantiation of the local-agent family. Registers the
 * `kimi` harness into the core registry: scoped home under the shared homes
 * root (`KIMI_CODE_HOME`), device-code login through `kimi login`, and the
 * `session_index.jsonl` records adapter. Delegation mounts through the
 * `kimi-cli` provider (one-shot `kimi -p` under the scoped home); the
 * bundle patch's `tool-subagent-kimi` row puts the `subagent_kimi` tool on
 * the profile root, so every agent preset can delegate without variants.
 *
 * @module @khorsheed/dsh-local-agent-kimi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@khorsheed/dsh-local-agent'
import { endpointHost } from '@khorsheed/dsh-local-agent/types'
import { KimiCliProvider, kimiCliVersion } from './kimi-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS } from './live-driver.ts'
import { LiveDriverSwitch } from './live-switch.ts'
import { KimiModelBroker } from './model-broker.ts'
import { kimiAuthenticated, kimiCredentialStamp, listKimiSessions } from './records.ts'
import { removeLegacyVariants } from './preset-tools.ts'
import {
  DEFAULT_THINKING_EFFORT,
  ensureKimiPermissions,
  kimiLogout,
  KIMI_MANAGED_BASE_URL,
  provisionKimiConfig,
  readKimiAutoApprove,
  readKimiBaseUrl,
  readKimiDefaultModel,
  readKimiReasoningEffort,
} from './provision.ts'
import { findKimiSessionDir, readKimiTranscript, renderTranscript } from './session-view.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-kimi'

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess', 'settings']

/** Plugin config: the model every round runs, plus the live driver. */
export interface Config {
  /**
   * The model every delegation round starts the CLI with (`kimi -m <model>`;
   * the resident `kimi acp`, which takes no model flag, gets the scoped
   * config's `default_model` rewritten before each spawn instead). The value
   * must name a model the scoped config.toml defines (a `[models."…"]` key).
   *
   * Absent — the default — passes no model at all: `default_model` decides,
   * exactly as it did before this key rode every round. The settings card
   * writes the same key, so a change applies to the next round without a
   * reload.
   *
   * This key ALSO still seeds a FRESH scoped home's `default_model` when
   * there is no user config to mirror, which is all it used to do.
   */
  model?: string
  /**
   * Reasoning effort a FRESH scoped home's config.toml pins (`[thinking]
   * effort` and the model's `default_effort`). Provision-time only: an
   * existing config is respected untouched, exactly like the mirrored model.
   * Default 'high' — the value the pre-config-item provisioning hardcoded,
   * so the default changes nothing.
   */
  thinkingEffort?: 'low' | 'high' | 'max'
  /**
   * Live driver: keep one resident `kimi acp` process per member and drive
   * turns over ACP (runtime-level graceful cancel, push-triggered mirroring)
   * instead of one `kimi -p` process per round. Default off; the exec
   * one-shot stays the fallback whenever the channel cannot come up.
   */
  live?: boolean
  /** Idle lifetime of an unused resident runtime before reclaim. */
  liveIdleMs?: number
  /**
   * Live mirror granularity: `event` mirrors the wire.jsonl fold via
   * throttled passes. `token` folds the same items 1:1 and additionally
   * appends throttled snapshot messages for the in-flight item at its
   * reserved (turn, step) — the host merges repeated settles at one
   * coordinate into one live-updating message.
   */
  liveMirrorGranularity?: 'event' | 'token'
}

export const Config: z<Config> = z.object({
  model: z.string(),
  thinkingEffort: z.union([z.const('low'), z.const('high'), z.const('max')]),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
})

/**
 * Settings namespace for the settings-page card. The Cordis config feeds the
 * composition `base` layer, so a field absent from the user layer inherits the
 * YAML value — the card only ever stores deliberate overrides.
 */
export const KIMI_SETTINGS_NAMESPACE = 'local-agent-kimi'

/**
 * The card's schema; field defaults are the innermost layer below `base`.
 * `model` deliberately carries NO default: an unset key must resolve to
 * undefined, which is what keeps the pre-key behavior byte-identical.
 */
const KIMI_SETTINGS_SCHEMA = z.object({
  live: z.boolean().default(false),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
  model: z.string(),
  recentModels: z.array(z.string()).default([]),
})

/**
 * Handle the harness's extra subcommands: `session <id>` renders a kimi
 * session transcript. Returns synchronously with undefined for any input
 * that is not this harness's own.
 * @param input - the trimmed subcommand input.
 * @param invocation - the full command invocation.
 * @returns the command result promise, or undefined when not this harness's.
 */
function handleSubcommand(input: string, invocation: CommandInvocation): Promise<CommandResult> | undefined {
  const [verb] = input.split(/\s+/)
  if (verb === 'session') return handleSessionSubcommand(input, invocation)
  return undefined
}

/** Run one `session` subcommand: render the transcript of a kimi session. */
async function handleSessionSubcommand(input: string, invocation: CommandInvocation): Promise<CommandResult> {
  const id = input.split(/\s+/)[1]
  if (id === undefined) {
    return { kind: 'error', text: 'Usage: /kimi session <session-id> (see /kimi sessions for ids)' }
  }
  const homeDir = invocation.agent.ctx.localAgent.homeDir('kimi')
  const sessionDir = await findKimiSessionDir(homeDir, id)
  if (sessionDir === undefined) {
    return { kind: 'error', text: `no kimi session "${id}" in the scoped home` }
  }
  try {
    const transcript = await readKimiTranscript(sessionDir)
    return { kind: 'success', text: renderTranscript(transcript) }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Register the Kimi harness into the local-agent registry.
 * @param ctx - plugin context carrying the registry.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const homeDir = ctx.localAgent.homeDir('kimi')
    // The ACP server refuses to authenticate without provider/model config;
    // provision a redacted config once so the scoped home stands alone. The
    // reasoning effort rides the same provisioning (fresh homes only).
    const thinkingEffort = config.thinkingEffort ?? DEFAULT_THINKING_EFFORT
    // Earlier versions bootstrapped <base>-kimi preset variants; the tool row
    // now mounts at the profile root, so remove the leftovers once.
    void removeLegacyVariants(ctx).catch((error: unknown) => {
      ctx.logger.warn(`local-agent-kimi: legacy preset cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // The one-shot CLI provider delegates through `kimi -p` in the scoped
    // home; ensure the scoped config allows the subagent's tool use. Chained
    // AFTER provisioning: both used to fire concurrently and the permission
    // bootstrap raced the config write — on a fresh home it could read
    // ENOENT and return early, leaving the Bash(*) allow rule unwritten
    // until the next boot (first-boot delegations answered without tools).
    void provisionKimiConfig(homeDir, config.model ?? 'kimi-code/k3', thinkingEffort)
      .then(() => ensureKimiPermissions(homeDir))
      .catch((error: unknown) => {
        ctx.logger.warn(`local-agent-kimi: config provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    // The live driver is settings-driven: the settings card's toggle (user
    // layer over the YAML composition base) swaps driver generations without
    // a reload. Toggling OFF drains the retiring generation — new rounds fall
    // back to exec, in-flight rounds finish on their runtime, idle runtimes
    // are reclaimed at once. A granularity change needs no new generation:
    // the driver reads it per round.
    const scope = ctx.settings.register(KIMI_SETTINGS_NAMESPACE, KIMI_SETTINGS_SCHEMA, {
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
    // The model broker owns the per-member state (session-level overrides,
    // start models) and the gateway-facing surface. The live driver's spawn
    // resolver defers to it through a closure because the broker itself needs
    // the switch (a switch retires runtimes through it) — the circularity is
    // construction-order only, and no round can run before both exist.
    let broker: KimiModelBroker
    const liveSwitch = new LiveDriverSwitch(ctx, scope, config.liveIdleMs, child => broker.spawnModel(child))
    broker = new KimiModelBroker(ctx, {
      homeDir: () => ctx.localAgent.homeDir('kimi'),
      settingsModel: resolveModel,
      recentModels: () => scope.get().recentModels ?? [],
      isLive: () => scope.get().live,
      liveSwitch,
    })
    const disposeProvider = ctx.subagents.registerProvider(new KimiCliProvider(ctx, liveSwitch.resolve, resolveModel, broker))
    const disposeHarness = ctx.localAgent.register({
      name: 'kimi',
      displayName: 'Kimi Code',
      homeEnvVar: 'KIMI_CODE_HOME',
      delegationProvider: 'kimi-cli',
      login: { command: 'kimi', args: ['login'] },
      records: { listSessions: homeDir => listKimiSessions(homeDir) },
      // A NAMED scope's directory is provisioned through this hook when the
      // registry materializes it — the same provider/model config and
      // permission bootstrap the default scope gets from the apply above, in
      // the same order (the permission write reads the config file).
      provision: async (scopedHome) => {
        await provisionKimiConfig(scopedHome, config.model ?? 'kimi-code/k3', thinkingEffort)
        await ensureKimiPermissions(scopedHome)
      },
      isAuthenticated: kimiAuthenticated,
      credentialStamp: kimiCredentialStamp,
      logout: kimiLogout,
      subcommand: handleSubcommand,
      // The model surface: the settings card reads the memberless info, the
      // member composer reads/switches per member. Registered unconditionally —
      // the gateway answers null only for harnesses WITHOUT one.
      modelBroker: broker,
      // The eval snapshot reads the scoped config as-is — it is authoritative
      // once provisioned, so a person-edited (or user-mirrored) effort and
      // endpoint report what actually applies, not what the config item
      // would have written. The MODEL is the one exception, and the family's
      // fixed order says why: a set `model` key rides every round's launch,
      // so it beats the file it is about to overrule; with no key, the
      // scoped `default_model` is what runs.
      // The directory is a PARAMETER, not the apply-time capture: a status
      // read (or an evaluation snapshot) of a named scope must report the
      // config that scope's rounds would run with.
      effectiveSettings: async (scopedHome) => {
        const [reasoningEffort, baseUrl, autoApprove, defaultModel, cliVersion] = await Promise.all([
          readKimiReasoningEffort(scopedHome).catch(() => undefined),
          readKimiBaseUrl(scopedHome).catch(() => undefined),
          readKimiAutoApprove(scopedHome).catch(() => false),
          readKimiDefaultModel(scopedHome).catch(() => undefined),
          kimiCliVersion(ctx, scopedHome).catch(() => undefined),
        ])
        // The managed endpoint IS kimi's own service — routing through it is
        // the default, not a pinned custom route.
        const custom = baseUrl !== undefined && baseUrl !== KIMI_MANAGED_BASE_URL
        const baseUrlHost = custom ? endpointHost(baseUrl) : undefined
        const model = resolveModel() ?? defaultModel
        return {
          drive: scope.get().live ? 'live' : 'exec',
          autoApprove,
          ...reasoningEffort !== undefined ? { reasoningEffort } : {},
          baseUrlSet: custom,
          ...baseUrlHost !== undefined ? { baseUrlHost } : {},
          ...model !== undefined ? { model } : {},
          ...cliVersion !== undefined ? { cliVersion } : {},
        }
      },
    })
    return () => {
      disposeProvider()
      disposeHarness()
      liveSwitch.dispose()
    }
  }, 'local-agent-kimi: harness')
}
