/**
 * Room agent lifecycle. A room IS its session's agent: the local-agent
 * delegation facade resolves the dispatch parent through `ctx.agents.get`
 * (live agents only — a harness hard constraint), and the main-agent member
 * speaks through the same agent. So a room is created THROUGH the agent
 * factory (the official `session.create` shape: session + live agent + the
 * preset recorded on the header), and a mutating Remote on a cold room
 * (after a host restart nothing republishes it — history reads never resume
 * an agent) cold-resumes the agent first, composing the preset the session's
 * log records (mirroring apiproxy's agentFor). Read-only remotes
 * (isRoom/getState) never resume: a cold room answers from a persistence
 * inspection instead.
 * @module @khorsheed/dsh-room/agent-setup
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentSetup } from '@deepseek-ai/dsh-agent'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** The agentPresets face this package consumes (probed, never injected). */
export type AgentPresetsProbe = Pick<AgentPresets, 'resolve' | 'mount'>

/**
 * Probe the agent-presets roster.
 * @param ctx - host context.
 * @returns the roster slice, or undefined when the composition mounts none
 * (the agent then composes plain — the pre-presets host behavior).
 */
export function probeAgentPresets(ctx: Context): AgentPresetsProbe | undefined {
  const service = ctx.get('agentPresets') as AgentPresetsProbe | undefined
  if (service === undefined || service === null) return undefined
  return typeof service.resolve === 'function' && typeof service.mount === 'function'
    ? service
    : undefined
}

/** One agent's preset composition: the header-recorded id plus the setup. */
export interface RoomAgentComposition {
  /** Preset id to record on the creation header (absent without a roster). */
  readonly agentPreset?: string
  /** Creation/resume setup mounting the preset into the agent's scope. */
  readonly setup?: AgentSetup
}

/**
 * Compose the create/resume setup for a room session's agent, mirroring the
 * official web path: resolve first (creation records the id on the header),
 * then mount into the agent's scope during setup.
 * @param ctx - host context.
 * @param presetId - the preset to compose; undefined resolves the default.
 * @returns the composition (empty when no presets roster is mounted).
 */
export async function composeRoomAgent(ctx: Context, presetId: string | undefined): Promise<RoomAgentComposition> {
  const presets = probeAgentPresets(ctx)
  if (presets === undefined) return {}
  const resolved = await presets.resolve(presetId)
  return {
    agentPreset: resolved.id,
    setup: async (agentCtx: Context) => { await presets.mount(agentCtx, resolved.id) },
  }
}

/**
 * The preset a room session runs, read from its log (a blank-window switch
 * wins over the creation header — the official reconstruction rule).
 * @param session - the live room session.
 * @returns the preset id, or undefined when none was recorded.
 */
export function roomSessionPreset(session: Session): string | undefined {
  return resolveSessionPreset({ header: session.header, events: session.events })
}

/** The sessionPersistence face this package consumes (probed, never injected). */
export type SessionPersistenceProbe = Pick<SessionPersistence, 'inspect'>

/**
 * Probe the session-persistence service.
 * @param ctx - host context.
 * @returns the inspection slice, or undefined when no backend is mounted.
 */
export function probeSessionPersistence(ctx: Context): SessionPersistenceProbe | undefined {
  const service = ctx.get('sessionPersistence') as SessionPersistenceProbe | undefined
  if (service === undefined || service === null) return undefined
  return typeof service.inspect === 'function' ? service : undefined
}

/**
 * Read a cold session's log from persistence without attaching or resuming
 * anything (the read-only remotes' cold path).
 * @param ctx - host context.
 * @param sessionId - the persisted session.
 * @returns the inspection, or undefined when absent/unreadable.
 */
export async function inspectCold(ctx: Context, sessionId: SessionId): Promise<SessionInspection | undefined> {
  const persistence = probeSessionPersistence(ctx)
  if (persistence === undefined) return undefined
  try {
    return await persistence.inspect(sessionId)
  } catch {
    // Unknown id, torn log, refused vocabulary: the probe answers "absent".
    return undefined
  }
}
