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
import type {} from '@khorsheed/dsh-local-agent'
import { KimiCliProvider } from './kimi-cli-provider.ts'
import { DEFAULT_LIVE_IDLE_MS, KimiAcpLiveDriver } from './live-driver.ts'
import { kimiAuthenticated, listKimiSessions } from './records.ts'
import { removeLegacyVariants } from './preset-tools.ts'
import { ensureKimiPermissions, kimiLogout, provisionKimiConfig } from './provision.ts'
import { findKimiSessionDir, readKimiTranscript, renderTranscript } from './session-view.ts'

/** Stable Cordis plugin name; the bundle patch row id. */
export const name = 'local-agent-kimi'

/** Services required before the harness can register. */
export const inject = ['localAgent', 'subagents', 'subprocess']

/** Plugin config: the model a fresh scoped home defaults to, plus the live driver. */
export interface Config {
  /** Kimi-managed model id; used only when no user config exists to mirror. */
  model?: string
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
   * throttled passes; `token` additionally appends `assistant/chunk` deltas
   * (write amplification — opt-in).
   */
  liveMirrorGranularity?: 'event' | 'token'
}

export const Config: z<Config> = z.object({
  model: z.string(),
  live: z.boolean().default(false),
  liveIdleMs: z.number().default(DEFAULT_LIVE_IDLE_MS),
  liveMirrorGranularity: z.union([z.const('event'), z.const('token')]).default('event'),
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
    // provision a redacted config once so the scoped home stands alone.
    void provisionKimiConfig(homeDir, config.model ?? 'kimi-code/k3').catch((error: unknown) => {
      ctx.logger.warn(`local-agent-kimi: config.toml provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // Earlier versions bootstrapped <base>-kimi preset variants; the tool row
    // now mounts at the profile root, so remove the leftovers once.
    void removeLegacyVariants(ctx).catch((error: unknown) => {
      ctx.logger.warn(`local-agent-kimi: legacy preset cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // The one-shot CLI provider delegates through `kimi -p` in the scoped
    // home; ensure the scoped config allows the subagent's tool use.
    void ensureKimiPermissions(homeDir).catch((error: unknown) => {
      ctx.logger.warn(`local-agent-kimi: permission provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // The live driver owns every resident runtime of this generation; its
    // disposal runs with the effect teardown, so no process survives an
    // unload.
    const liveDriver = config.live === true
      ? new KimiAcpLiveDriver(ctx, {
        ...config.liveIdleMs === undefined ? {} : { liveIdleMs: config.liveIdleMs },
        ...config.liveMirrorGranularity === undefined ? {} : { liveMirrorGranularity: config.liveMirrorGranularity },
      })
      : undefined
    const disposeProvider = ctx.subagents.registerProvider(new KimiCliProvider(ctx, liveDriver))
    const disposeHarness = ctx.localAgent.register({
      name: 'kimi',
      displayName: 'Kimi Code',
      homeEnvVar: 'KIMI_CODE_HOME',
      delegationProvider: 'kimi-cli',
      login: { command: 'kimi', args: ['login'] },
      records: { listSessions: homeDir => listKimiSessions(homeDir) },
      isAuthenticated: kimiAuthenticated,
      logout: kimiLogout,
      subcommand: handleSubcommand,
    })
    return () => {
      disposeProvider()
      disposeHarness()
      void liveDriver?.disposeAll()
    }
  }, 'local-agent-kimi: harness')
}
