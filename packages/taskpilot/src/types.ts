/**
 * TaskPilot shared types: the command-payload vocabulary the host half parses
 * and the trajectory entries the browser half renders. Wire-shaped, so the
 * types here are intentionally narrow subsets of the product contracts.
 *
 * @module dsh-taskpilot/types
 */

/**
 * One parsed `/taskpilot-*` invocation. The host half resolves these from the
 * raw input text; the browser half builds the same lines when a pill button
 * fires.
 */
export type TaskPilotCommand =
  | { readonly kind: 'stop-job'; readonly jobId: string }
  | { readonly kind: 'interrupt-subagent'; readonly childId: string; readonly parentId?: string }

/** Parse a `/taskpilot-*` line into its payload, or `undefined` when malformed. */
export function parseTaskPilotCommand(line: string): TaskPilotCommand | undefined {
  const trimmed = line.trim()
  const space = trimmed.search(/\s/)
  const name = space < 0 ? trimmed : trimmed.slice(0, space)
  const rest = space < 0 ? '' : trimmed.slice(space).trim()
  if (name === '/taskpilot-stop' && rest.length > 0) return { kind: 'stop-job', jobId: rest }
  if (name === '/taskpilot-interrupt' && rest.length > 0) {
    const parts = rest.split(/\s+/)
    const childId = parts[0]!
    const parentId = parts[1]
    return parentId !== undefined
      ? { kind: 'interrupt-subagent', childId, parentId }
      : { kind: 'interrupt-subagent', childId }
  }
  return undefined
}

/** Render one command into the slash line the client sends. */
export function renderTaskPilotCommand(command: TaskPilotCommand): string {
  if (command.kind === 'stop-job') return `/taskpilot-stop ${command.jobId}`
  return command.parentId !== undefined
    ? `/taskpilot-interrupt ${command.childId} ${command.parentId}`
    : `/taskpilot-interrupt ${command.childId}`
}

/**
 * One timeline row in the job detail drawer, folded from the session log.
 * `detail` holds the expandable full text (tool result / notice body).
 */
export interface TrajectoryEntry {
  /** Session log sequence, for stable React keys and chronological order. */
  readonly seq: number
  /** Unix epoch ms of the source event. */
  readonly time: number
  /** Row kind drives the icon and the default-collapsed presentation. */
  readonly kind: 'start' | 'read' | 'kill' | 'notice'
  /** One-line summary shown collapsed. */
  readonly title: string
  /** Full expandable text, present when the row carries output. */
  readonly detail?: string
}
