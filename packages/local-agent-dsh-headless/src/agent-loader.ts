/**
 * Agent loading and turn aggregation shared by the one-shot runner and the
 * serve loop: both drive a direct Agent over the core registry with the same
 * model selection, the same scoped installModelSelection setup, the same
 * preset join, and the same caller-supplied session identity, differing only
 * in process lifetime.
 * @module @khorsheed/dsh-local-agent-dsh-headless/agent-loader
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Outcome of one owned turn interval. */
export interface TurnOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/**
 * Aggregate the last assistant text and turn outcome in one owned interval.
 * @param events - the agent session's full event log.
 * @param firstSeq - the session seq at which this driver's interval opened.
 */
export function summarizeTurn(events: readonly SessionEvent[], firstSeq: number): TurnOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Apply a `--model` request onto the instance's default selection.
 *
 * The request is spelled `provider/model` — the same shape
 * `effectiveSettings.model` reports the configured model in — and splits at
 * the FIRST slash, so a provider-qualified id survives a model id that
 * contains none. A request with no slash names the MODEL only and keeps the
 * default selection's provider, which is what a caller switching between two
 * models of the same route means.
 *
 * Everything else on the selection is carried through untouched (the
 * reasoning effort in particular): `--model` changes the model, not the rest
 * of the instance's configuration. An absent or blank request returns the
 * default selection unchanged — byte for byte the behavior before the flag
 * existed.
 * @param selection - the instance's default model selection.
 * @param request - the `--model` value, when the launch carried one.
 * @returns the selection this launch runs.
 */
export function applyModelRequest(selection: ModelSelection, request: string | undefined): ModelSelection {
  const wanted = request?.trim()
  if (wanted === undefined || wanted === '') return selection
  const slash = wanted.indexOf('/')
  if (slash <= 0 || slash === wanted.length - 1) return { ...selection, model: wanted }
  return { ...selection, provider: wanted.slice(0, slash), model: wanted.slice(slash + 1) }
}

/**
 * The optional agent-preset roster: present only when the sub-profile's patch
 * composes one (`local-agent-dsh`'s provisioning writes that layer when a
 * scope names a preset).
 */
interface PresetRosterSlice {
  mount?: (agentCtx: Context, id?: string) => Promise<{ id: string }>
  defaultId?: string
}

/**
 * Join this agent to the sub-profile's preset, when the sub-profile composes
 * a roster.
 *
 * Without a roster this is a no-op and the agent reads the model-facing rows
 * off the global layer — byte for byte the behavior of every sub-dsh before
 * the roster layer existed, and the right answer for a rosterless
 * composition (`@deepseek-ai/dsh-agent-presets` README, "Composing a child
 * agent"). With one, the preset decides the tools, prompt sections and
 * skills of every session this process hosts, which is what makes the
 * scope's capability face a per-condition factor instead of an instance-wide
 * constant.
 *
 * A roster that REFUSES (unknown preset id, broken composition) is not
 * degraded past: mounting rejects, the agent creation rolls back, and the
 * launch fails naming the preset. A sub-dsh that silently ran the global
 * layer after being told to run preset X would attribute the round to a
 * capability face it never had.
 * @param ctx - plugin context (where the roster service is resolved).
 * @param agentCtx - the agent's scope context, which joins the standing mount.
 * @returns the preset id joined, or undefined when the composition has no roster.
 */
export async function joinSubDshPreset(ctx: Context, agentCtx: Context): Promise<string | undefined> {
  const roster = ctx.get('agentPresets' as never) as PresetRosterSlice | undefined
  if (roster?.mount === undefined) return undefined
  return (await roster.mount(agentCtx)).id
}

/**
 * Create or resume the direct Agent for one caller-named session. The caller
 * resolved the core services first (both call sites bail out on a disposed
 * tree). The caller-supplied id is authoritative for both branches: the
 * parent provider generated one uuid and passes the same value on every round
 * of the same delegation, so resume finds exactly the sub-dsh session the
 * fresh round created.
 * @param ctx - plugin context carrying the Agent registry and default model.
 * @param identity - fresh (`sessionId`) or continuation (`resumeSessionId`).
 * @returns the owned agent handle (its disposer unwinds the agent's world).
 */
export async function loadSubDshAgent(
  ctx: Context,
  identity: { sessionId?: string; resumeSessionId?: string; model?: string },
): Promise<AgentHandle> {
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) {
    throw new Error('local-agent-dsh-headless: the agents/agentDefaultModel services are not mounted')
  }
  // The instance default is the base; `--model` overrides it for this launch
  // (one-shot: this round; `--serve`: every session the process hosts).
  const selection = applyModelRequest(defaultModel.currentSelection(), identity.model)
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = async (agentCtx: Context): Promise<void> => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    // The released installModelSelection registers the two scoped waterfall
    // listeners and returns their disposer; the run owns the whole process
    // lifetime, so the disposer is deliberately dropped.
    installModelSelection(agentCtx, selected)
    // The preset join happens INSIDE setup, before the agent is published:
    // the roster parents this agent's scope key to the preset's standing
    // mount, so the preset's tools and prompt sections exist before the first
    // prompt assembly. A rejection here rolls the creation back.
    await joinSubDshPreset(ctx, agentCtx)
  }
  if (identity.resumeSessionId !== undefined) {
    return agents.resume({
      resumeSessionId: SessionId(identity.resumeSessionId),
      agentOptions,
      setup,
    })
  }
  return agents.create({
    sessionId: SessionId(identity.sessionId ?? `session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions,
    setup,
  })
}
