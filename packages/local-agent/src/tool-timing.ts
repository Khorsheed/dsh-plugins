/** A tool's execution interval, distinct from the mirror events' write times. */
export interface LocalAgentToolTiming {
  startedAt: number
  endedAt?: number
  /** `provider` comes from the CLI record; `observed` is the driver's arrival time. */
  source: 'provider' | 'observed'
}

/**
 * Build the transitional `tool/result.meta` payload for a fully observed execution.
 * @param provider - the local-agent provider that produced the mirrored call.
 * @param timing - the execution interval captured from the CLI or its driver.
 * @returns the versioned metadata, or undefined when the interval is incomplete or invalid.
 */
export function localAgentToolTimingMeta(provider: string, timing: LocalAgentToolTiming) {
  if (!Number.isFinite(timing.startedAt) || timing.startedAt < 0
    || timing.endedAt === undefined || !Number.isFinite(timing.endedAt)
    || timing.endedAt < timing.startedAt) return undefined
  return {
    localAgentTiming: {
      version: 1 as const,
      provider,
      startedAt: timing.startedAt,
      endedAt: timing.endedAt,
      source: timing.source,
    },
  }
}
