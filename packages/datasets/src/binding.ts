/**
 * Per-session dataset binding, stored as a log-only session event (the
 * `goal/change` precedent): the binding persists with the session, is
 * auditable in its log, and never enters derived model history. Binding
 * WRITES are human operations (slash `/datasets bind`, the CLI, later the tab
 * button); agent tools only resolve the binding — which datasets an agent may
 * use is decided by the human, not the agent.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DatasetsError } from './dataset.ts'

/** A session's dataset binding. Absent fields mean "everything in the repo". */
export interface DatasetBinding {
  /** Absolute path of the git repository holding the datasets. */
  repoPath: string
  /** Dataset-id whitelist; absent = every dataset in the repository. */
  datasets?: string[]
  /** Layer whitelist; absent = every layer. Enforced on ALL read paths. */
  layers?: string[]
}

/** Durable binding event payload. `binding: null` is the unbind tombstone. */
export interface DatasetsBindingChange {
  readonly kind: 'datasets/binding'
  readonly version: 1
  readonly binding: DatasetBinding | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whole-binding snapshot; latest write wins on replay. Log-only UI/agent
     * state; never derived history.
     */
    'datasets/binding': DatasetsBindingChange
  }
}

/**
 * The narrow slice of `Session` the binding store needs. Structural, so tests
 * and the offline CLI path can supply minimal fakes.
 */
export interface BindingSession {
  readonly events: readonly SessionEvent[]
  append(type: 'datasets/binding', data: DatasetsBindingChange): unknown
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry !== '')
}

/**
 * Validate a binding object (from an event payload, CLI flags, or a tool
 * caller).
 * @param value - the candidate binding.
 * @returns the validated binding.
 */
export function validateBinding(value: unknown): DatasetBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetsError('binding must be an object {repoPath, datasets?, layers?}', 'SHAPE_INVALID')
  }
  const record = value as Record<string, unknown>
  const repoPath = record['repoPath']
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new DatasetsError('binding requires a non-empty "repoPath"', 'SHAPE_INVALID')
  }
  const datasets = record['datasets']
  if (datasets !== undefined && !isStringArray(datasets)) {
    throw new DatasetsError('binding "datasets" must be an array of dataset ids', 'SHAPE_INVALID')
  }
  const layers = record['layers']
  if (layers !== undefined && !isStringArray(layers)) {
    throw new DatasetsError('binding "layers" must be an array of layer names', 'SHAPE_INVALID')
  }
  return {
    repoPath,
    ...(datasets !== undefined ? { datasets: [...datasets] } : {}),
    ...(layers !== undefined ? { layers: [...layers] } : {}),
  }
}

/**
 * Runtime-validate a persisted binding event payload (replay-safe: a malformed
 * event fails loud instead of silently dropping the binding).
 * @param data - the event payload.
 * @returns the validated change.
 */
export function decodeBindingChange(data: unknown): DatasetsBindingChange {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DatasetsError('datasets/binding event payload must be an object', 'SHAPE_INVALID')
  }
  const record = data as Record<string, unknown>
  if (record['kind'] !== 'datasets/binding' || record['version'] !== 1) {
    throw new DatasetsError('datasets/binding event carries an unknown kind/version', 'SHAPE_INVALID')
  }
  const binding = record['binding']
  return {
    kind: 'datasets/binding',
    version: 1,
    binding: binding === null ? null : validateBinding(binding),
  }
}

/**
 * Fold a session's events to its current binding: last write wins, a
 * tombstone clears.
 * @param events - the session log (any prefix of it).
 * @returns the current binding, or undefined when none is in effect.
 */
export function bindingFromEvents(events: readonly SessionEvent[]): DatasetBinding | undefined {
  let binding: DatasetBinding | undefined
  for (const event of events) {
    if (event.type !== 'datasets/binding') continue
    const change = decodeBindingChange(event.data)
    binding = change.binding === null ? undefined : change.binding
  }
  return binding
}

/**
 * Append a binding change to a live session (slash command path).
 * @param session - the session to bind.
 * @param binding - the new binding, or null to unbind.
 * @returns the validated binding that was recorded.
 */
export function appendBinding(session: BindingSession, binding: DatasetBinding | null): DatasetBinding | null {
  const validated = binding === null ? null : validateBinding(binding)
  session.append('datasets/binding', { kind: 'datasets/binding', version: 1, binding: validated })
  return validated
}
