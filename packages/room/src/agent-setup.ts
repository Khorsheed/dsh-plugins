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
import type AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** The slice of a session log the preset derivation reads. */
interface PersistedPresetSource {
  header: { agentPreset?: string | null }
  events: readonly { type: string; data?: unknown }[]
}

/**
 * The preset-derivation surface of the preset-registry module: the
 * `agentPresetProjectionDefinition` unit. Probed structurally (mirrors
 * ankh-guard's PresetDerivationSurface), so a host without preset
 * composition reads as `{}`.
 */
export interface PresetDerivationSurface {
  agentPresetProjectionDefinition?: {
    init(header: { agentPreset?: string | null }): string | null
    apply(state: string | null, event: { type: string; data?: unknown }): string | null
  }
}

/**
 * Which preset a session actually runs, newest selection winning: the header
 * plus `agent-preset/selected` events folded through
 * `agentPresetProjectionDefinition`. A host without it yields undefined: the
 * resume falls back to the deployment's default preset, the same outcome a
 * preset-less session has.
 * @param host - the agent-presets module namespace, structurally probed.
 * @param session - the session's header and event log.
 * @returns the preset id, or `undefined` when the session names none.
 */
export function deriveSessionPreset(host: PresetDerivationSurface, session: PersistedPresetSource): string | undefined {
  const projection = host.agentPresetProjectionDefinition
  if (projection === undefined) return undefined
  let state = projection.init(session.header)
  for (const event of session.events) state = projection.apply(state, event)
  return state ?? undefined
}

let presetRegistryProbe: Promise<unknown> | undefined
let probedHost: PresetDerivationSurface = {}

/**
 * Resolve the preset-registry module. A host without preset composition does
 * not install it — `null`, and the derivation host stays `{}`, the
 * established no-preset degrade (the resume falls back to the deployment's
 * default preset). A STATIC import would be a module-resolution failure at
 * load on such a host — pack-dist strips `dependencies`, so the specifier
 * resolves against the host's install tree. The specifier stays a static
 * string literal so tsdown externalizes it and tsc type-checks it.
 * @returns the module namespace, or null when it does not resolve.
 */
export function loadPresetRegistry(): Promise<unknown> {
  presetRegistryProbe ??= import('@deepseek-ai/dsh-agent-preset-registry')
    .catch((): null => null)
  return presetRegistryProbe
}

/**
 * The derivation input resolved by the last preload. `{}` before it, which
 * the derivation reads as "no preset surface" — the no-preset degrade.
 */
export function presetDerivationHost(): PresetDerivationSurface {
  return probedHost
}

/**
 * Populate {@link presetDerivationHost} once, at apply time — every
 * derivation happens on the resume/create paths that run after apply.
 */
export async function preloadPresetDerivationHost(): Promise<void> {
  probedHost = ((await loadPresetRegistry()) ?? {}) as PresetDerivationSurface
}

/** Test seam: drop the cached probe and host so a mocked resolution re-runs. */
export function resetPresetRegistryProbeForTest(): void {
  presetRegistryProbe = undefined
  probedHost = {}
}

/** The agentPresets face this package consumes (probed, never injected). */
export type AgentPresetsProbe = Pick<AgentPresets, 'resolve' | 'mount'> & Partial<Pick<AgentPresets, 'list'>>

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
  return deriveSessionPreset(presetDerivationHost(), { header: session.header, events: session.snapshotEvents() })
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
 * anything (the read-only remotes' cold path): open a read handle (no write
 * ownership), read the full log, close.
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
