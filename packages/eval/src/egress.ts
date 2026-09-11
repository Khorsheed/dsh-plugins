/**
 * The egress self-check: one declared command, run inside a freshly acquired
 * unit, before anything expensive happens in it.
 *
 * Why it exists (T29c, measured): `eval-net` is an `--internal` network whose
 * only way out is a sidecar proxy. With that sidecar stopped, codex came up
 * inside the unit, read its model and its sandbox policy, ran for 230 seconds
 * and returned `task_complete` with `last_agent_message: null` — an EMPTY
 * answer and not one word about the network. Every layer above read that as
 * "the probe failed"; nothing could say why, and the same four minutes would
 * have burned on every cell of the run.
 *
 * So the orchestrator asks the unit one question it can answer cheaply and
 * unambiguously, and refuses the whole run when the answer is no. The
 * question itself — which command, which address — belongs to the plan and
 * the dataset's env layer, never to this file.
 * @module @khorsheed/dsh-eval/egress
 */

import type { LabVerifyResult } from './faces.ts'
import { DEFAULT_EGRESS_CHECK_TIMEOUT_MS, type EgressCheckDecl } from './unit.ts'

/** The diagnostic code every egress refusal carries. */
export const EGRESS_UNAVAILABLE = 'EGRESS_UNAVAILABLE'

/**
 * A unit that cannot reach what its plan says it needs. Thrown by
 * {@link checkUnitEgress} and caught where the run is refused: this is an
 * INFRASTRUCTURE failure, so it never becomes a cell result and never gets
 * attributed to a condition's subject.
 */
export class EgressUnavailable extends Error {
  /** The stable diagnostic code (`EGRESS_UNAVAILABLE`). */
  readonly code = EGRESS_UNAVAILABLE

  constructor(message: string) {
    super(message)
    this.name = 'EgressUnavailable'
  }
}

/** The minimum a caller needs from lab to run the check. */
export interface EgressVerifier {
  verify(unitId: string, options: { command: string[]; source?: string; timeoutMs?: number }): Promise<LabVerifyResult>
}

/** Trim one stream for a one-line reason without losing the useful end of it. */
function tail(stream: string, limit = 300): string {
  const text = stream.trim().replace(/\s+/g, ' ')
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`
}

/**
 * Run one unit's declared egress check.
 *
 * The rule is deliberately crude — exit 0 passes, everything else refuses —
 * because the command is the plan's and only the plan knows what a good
 * answer looks like. A timeout, a non-zero exit and a `verify` that could not
 * run at all are all the same verdict: this unit cannot be trusted to reach
 * its endpoints, and running cells in it would produce results nobody can
 * attribute.
 * @param lab - the lab face (only `verify` is used).
 * @param unitId - the acquired unit.
 * @param decl - the plan's declaration.
 * @param where - whose unit this is, for the message (`the probe unit`,
 *   `cell p0-placeholder-codex-exec-rep1`). It does NOT name the condition:
 *   both readers of this message prefix it with one already.
 * @throws {@link EgressUnavailable} when the check does not pass.
 */
export async function checkUnitEgress(
  lab: EgressVerifier,
  unitId: string,
  decl: EgressCheckDecl,
  where: string,
): Promise<void> {
  const timeoutMs = decl.timeoutMs ?? DEFAULT_EGRESS_CHECK_TIMEOUT_MS
  const printable = decl.command.join(' ')
  let result: LabVerifyResult
  try {
    result = await lab.verify(unitId, { command: [...decl.command], timeoutMs })
  } catch (error: unknown) {
    throw new EgressUnavailable(
      `${where}: the egress check could not be run (${printable}): `
      + `${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (result.timedOut) {
    throw new EgressUnavailable(
      `${where}: the egress check (${printable}) exceeded ${timeoutMs}ms — the network this unit sits on`
      + ' has no way out right now (on an --internal network that means the egress sidecar is down)',
    )
  }
  if (result.exitCode !== 0) {
    const detail = tail(result.stderr) || tail(result.stdout)
    throw new EgressUnavailable(
      `${where}: the egress check (${printable}) exited ${result.exitCode}`
      + `${detail === '' ? '' : `: ${detail}`}`
      + ' — the unit cannot reach its endpoints, so no cell of this run could produce an attributable result',
    )
  }
}
