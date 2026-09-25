/**
 * Side-chat agent lifecycle helpers: the probes and compositions the service
 * builds each context's agent with.
 *
 * A side-chat context IS an ordinary agent session, created through the agent
 * factory (`ctx.agents.create`, the eval/room precedent) with the profile's
 * default preset mounted into its scope — the same composition a normal
 * conversation gets, so the side agent's file tools work under the inherited
 * cwd. A cold context (after a host restart nothing republishes it) resumes
 * through `ctx.agents.resume` with the recorded preset re-mounted; read-only
 * paths never resume, they answer from a persistence inspection instead.
 *
 * Every host capability here is PROBED (`ctx.get`), never injected: a
 * composition without the presets roster composes plain (chat-only), one
 * without persistence simply has no cold history, and neither absence may
 * fail the boot.
 *
 * @module @khorsheed/dsh-sidechat/agent-setup
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentSetup } from '@deepseek-ai/dsh-agent'
import type AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** The agentPresets face this package consumes (probed, never injected). */
export type AgentPresetsProbe = Pick<AgentPresets, 'resolve' | 'mount'>

/**
 * Probe the agent-presets roster.
 * @param ctx - host context.
 * @returns the roster slice, or undefined when the composition mounts none
 * (the side agent then composes plain — chat without preset tools).
 */
export function probeAgentPresets(ctx: Context): AgentPresetsProbe | undefined {
  const service = ctx.get('agentPresets') as AgentPresetsProbe | undefined
  if (service === undefined || service === null) return undefined
  return typeof service.resolve === 'function' && typeof service.mount === 'function'
    ? service
    : undefined
}

/** One side agent's preset composition: the id to record plus the setup mounting it. */
export interface SideAgentComposition {
  /** Preset id to record on the creation header (absent without a roster). */
  readonly agentPreset?: string
  /** Creation/resume setup mounting the preset into the agent's scope. */
  readonly setup?: AgentSetup
}

/**
 * Compose the create/resume setup for a side-chat agent, mirroring the
 * official web path (room's `composeRoomAgent`): resolve first (creation
 * records the id on the header and the contexts doc), then mount into the
 * agent's scope during setup.
 * @param ctx - host context.
 * @param presetId - the preset to compose; undefined resolves the deployment default.
 * @returns the composition (empty when no presets roster is mounted).
 */
export async function composeSideAgent(ctx: Context, presetId: string | undefined): Promise<SideAgentComposition> {
  const presets = probeAgentPresets(ctx)
  if (presets === undefined) return {}
  const resolved = await presets.resolve(presetId)
  return {
    agentPreset: resolved.id,
    setup: async (agentCtx: Context) => { await presets.mount(agentCtx, resolved.id) },
  }
}

/** The sessionPersistence face this package consumes (probed, never injected). */
export type SessionPersistenceProbe = Pick<SessionPersistence, 'open'>

/**
 * Probe the session-persistence service.
 * @param ctx - host context.
 * @returns the handle-opening slice, or undefined when no backend is mounted.
 */
export function probeSessionPersistence(ctx: Context): SessionPersistenceProbe | undefined {
  const service = ctx.get('sessionPersistence') as SessionPersistenceProbe | undefined
  if (service === undefined || service === null) return undefined
  return typeof service.open === 'function' ? service : undefined
}

/**
 * Read a cold session's log from persistence without attaching or resuming
 * anything (room's `inspectCold`, the read-only path's cold answer). The
 * 0.1.5 handle-based API: open a read handle (no write ownership), read the
 * full log, close.
 * @param ctx - host context.
 * @param sessionId - the persisted session.
 * @returns the inspection, or undefined when absent/unreadable.
 */
export async function inspectCold(ctx: Context, sessionId: SessionId): Promise<SessionInspection | undefined> {
  const persistence = probeSessionPersistence(ctx)
  if (persistence === undefined) return undefined
  try {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const cold = await handle.read(0)
      return {
        meta: structuredClone(handle.header),
        inheritedEventCount: handle.inheritedEventCount,
        events: [...cold.events],
      }
    } finally {
      await handle.close()
    }
  } catch {
    // Unknown id, torn log, refused vocabulary: the probe answers "absent".
    return undefined
  }
}
