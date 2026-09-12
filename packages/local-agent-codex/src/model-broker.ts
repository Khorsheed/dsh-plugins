/**
 * The codex harness's model broker: the member-aware model surface the core
 * gateway routes to (`harnessModel` for the settings card, `memberModel` /
 * `setMemberModel` for the composer picker). It owns the session-level
 * override map — shared with the exec provider (which consults it per round)
 * and the live driver (which binds it at runtime spawn) — and retires a
 * member's resident runtime when a switch leaves it bound to a different
 * model, so the NEXT round respawns onto the new one while the codex thread
 * itself carries over via thread/resume.
 *
 * Resolution order is the family's fixed one (first match wins): override →
 * the delegation's recorded model → the plugin-config `model` (settings) →
 * the scoped config.toml's own `model` (cliDefault) → the CLI's built-in
 * default, which names nothing. The pickable vocabulary is what the instance
 * actually knows — settings + cliDefault + the identifiers the scoped config
 * itself carries (profiles) + the card's recent-model memory — never a
 * hardcoded catalog.
 * @module @khorsheed/dsh-local-agent-codex/model-broker
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentModelBroker, LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
import { listCodexConfigModels, readCodexModel } from './provision.ts'

/** Everything the broker reads or drives, injected so the unit specs stay small. */
export interface CodexModelBrokerDeps {
  /** Host context carrying the family registry (in-flight reads, delegation records). */
  readonly ctx: Context
  /** The plugin-config `model` resolver — the settings layer, blank reads unset. */
  readonly settingsModel: () => string | undefined
  /** The card's recent-model memory (the suggestion vocabulary's tail). */
  readonly recentModels: () => readonly string[]
  /** The default scope's scoped home; config discovery reads it live. */
  readonly homeDir: () => string
  /** Whether the live driver is on (the member's rounds bind resident runtimes). */
  readonly live: () => boolean
  /**
   * The session-level overrides this broker owns. Shared by reference with the
   * exec provider's per-round resolution and the live driver's spawn binding,
   * so a switch reaches every path without a reload.
   */
  readonly overrides: Map<string, string>
  /**
   * The model the member's live runtime bound at spawn: the identifier,
   * undefined for "bound to no model", null for "no live runtime".
   */
  readonly liveBoundModel: (childSessionId: string) => string | undefined | null
  /** Retire the member's live runtime; the next round respawns onto the new model. */
  readonly retireRuntime: (childSessionId: string) => Promise<void>
}

/** Dedupe the choice vocabulary, dropping unset layers and blanks. */
function dedupeChoices(layers: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>()
  const choices: string[] = []
  for (const layer of layers) {
    const value = layer?.trim()
    if (value === undefined || value === '' || seen.has(value)) continue
    seen.add(value)
    choices.push(value)
  }
  return choices
}

export class CodexModelBroker implements LocalAgentModelBroker {
  constructor(private readonly deps: CodexModelBrokerDeps) {}

  /** The member's in-flight rounds (an empty answer on a core that predates the read). */
  private activeDelegations(): readonly string[] {
    const registry = this.deps.ctx.localAgent as unknown as {
      activeDelegations?: () => readonly string[]
    }
    return typeof registry.activeDelegations === 'function' ? registry.activeDelegations() : []
  }

  /** The model the member's NEXT spawn binds explicitly: override → recorded → settings. */
  private boundLayer(childSessionId: string): string | undefined {
    const override = this.deps.overrides.get(childSessionId)
    if (override !== undefined) return override
    const record = this.deps.ctx.localAgent.getDelegation(childSessionId)
    const recorded = record?.model?.trim()
    if (recorded !== undefined && recorded !== '') return recorded
    return this.deps.settingsModel()
  }

  /**
   * Read the model surface. The cliDefault and the discovered identifiers come
   * from the scoped config.toml LIVE (a person-edited file is authoritative);
   * a read failure degrades that layer to absent, never to a guessed value.
   */
  async modelInfo(childSessionId?: string, delegationModel?: string): Promise<LocalAgentModelInfo> {
    const settings = this.deps.settingsModel()
    const [cliDefault, discovered] = await Promise.all([
      readCodexModel(this.deps.homeDir()).catch(() => undefined),
      listCodexConfigModels(this.deps.homeDir()).catch(() => [] as string[]),
    ])
    const override = childSessionId === undefined ? undefined : this.deps.overrides.get(childSessionId)
    const delegation = delegationModel?.trim() === '' ? undefined : delegationModel
    const effective = override ?? delegation ?? settings ?? cliDefault
    const source = override !== undefined ? 'override'
      : delegation !== undefined ? 'delegation'
        : settings !== undefined ? 'settings'
          : cliDefault !== undefined ? 'cli-config' : 'cli-builtin'
    const inFlight = childSessionId !== undefined && this.activeDelegations().includes(childSessionId)
    return {
      ...effective === undefined ? {} : { effective },
      source,
      ...override === undefined ? {} : { override },
      ...delegation === undefined ? {} : { delegation },
      ...settings === undefined ? {} : { settings },
      ...cliDefault === undefined ? {} : { cliDefault },
      choices: dedupeChoices([settings, cliDefault, ...discovered, ...this.deps.recentModels()]),
      live: this.deps.live(),
      switchable: !inFlight,
      ...inFlight ? { reason: '成员有进行中的委派轮次，等其完成后再切换模型' } : {},
    }
  }

  /**
   * Set (or clear) the member's session-level override. Same-model is a
   * no-op; a different model with a live runtime bound elsewhere retires the
   * runtime so the next round respawns (the codex thread resumes). Throws
   * while a round is in flight — retiring mid-round would kill the run.
   */
  async setMemberModel(childSessionId: string, model: string | undefined): Promise<void> {
    if (this.activeDelegations().includes(childSessionId)) {
      throw new Error(`subagent-codex: 成员有进行中的委派轮次，等其完成后再切换模型 (child session ${childSessionId})`)
    }
    const trimmed = model?.trim()
    const next = trimmed === undefined || trimmed === '' ? undefined : trimmed
    if (this.deps.overrides.get(childSessionId) === next) return
    if (next === undefined) this.deps.overrides.delete(childSessionId)
    else this.deps.overrides.set(childSessionId, next)
    const bound = this.deps.liveBoundModel(childSessionId)
    if (bound !== null && bound !== this.boundLayer(childSessionId)) {
      await this.deps.retireRuntime(childSessionId)
    }
  }
}
