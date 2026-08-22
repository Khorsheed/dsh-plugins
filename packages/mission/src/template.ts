/**
 * Run-template loading, validation, and lint. A template is policy (reviewed
 * in git); mission enforces whatever it declares — `lintTemplate` is the
 * fallback gate for the policy's own holes, and its rules reuse existing
 * semantics (a non-empty `releasableStates` declares "this run holds
 * resources to release"):
 *
 *   - error:   a transition ENTERING a releasable state carries no guard
 *              (an unguarded release permission is an empty gate);
 *   - warning: a terminal state is reachable WITHOUT passing through any
 *              releasable state (resources may leak; flagged, not blocked).
 *
 * A lint error refuses run creation. v1 template files are JSON (YAML waits
 * on a dependency decision — see the README's Known Limitations).
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { assertSchemaSubset } from './schema.ts'
import type { Guard, RunTemplate, StateMachineDecl, TemplateMission, TransitionDecl } from './types.ts'

/**
 * The built-in default template (`queued → active → done | failed`) — data,
 * not special-case code. Its `releasableStates` is intentionally EMPTY: the
 * lint rule would otherwise demand a guard on every `active → done` of an
 * everyday work item, and a template that fails its own lint could never
 * back the zero-config implicit run.
 */
export const SIMPLE_TEMPLATE: RunTemplate = {
  name: 'simple',
  stateMachine: {
    states: ['queued', 'active', 'done', 'failed'],
    transitions: [
      { from: 'queued', to: 'active' },
      { from: 'active', to: 'done' },
      { from: 'active', to: 'failed' },
    ],
    releasableStates: [],
  },
  missions: [],
}

/** State-machine shape derived from the declared transitions: terminal = no out-edge, initial = no in-edge. */
export interface MachineShape {
  initials: string[]
  terminals: string[]
}

/** Derive initial/terminal states from transitions alone (works for any template shape). */
export function deriveShape(machine: StateMachineDecl): MachineShape {
  const withIn = new Set(machine.transitions.map(t => t.to))
  const withOut = new Set(machine.transitions.map(t => t.from))
  return {
    initials: machine.states.filter(s => !withIn.has(s)),
    terminals: machine.states.filter(s => !withOut.has(s)),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readGuard(raw: unknown, where: string, problems: string[]): Guard | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || typeof raw['type'] !== 'string') {
    problems.push(`${where}: guard must be an object with a type`)
    return undefined
  }
  switch (raw['type']) {
    case 'file-check': {
      const dir = raw['dir']
      const expectedFiles = raw['expectedFiles']
      if (typeof dir !== 'string' || dir === '') problems.push(`${where}: file-check guard needs a non-empty dir`)
      if (!Array.isArray(expectedFiles) || expectedFiles.length === 0 || expectedFiles.some(f => typeof f !== 'string' || f === '')) {
        problems.push(`${where}: file-check guard needs a non-empty expectedFiles string array`)
      }
      if (problems.length > 0) return undefined
      return { type: 'file-check', dir: dir as string, expectedFiles: expectedFiles as string[] }
    }
    case 'schema-check': {
      const schemaPath = raw['schemaPath']
      if (typeof schemaPath !== 'string' || schemaPath === '') {
        problems.push(`${where}: schema-check guard needs a non-empty schemaPath`)
        return undefined
      }
      const inputFrom = raw['inputFrom']
      if (inputFrom !== undefined && inputFrom !== 'submission' && inputFrom !== 'run-meta') {
        problems.push(`${where}: schema-check inputFrom only supports 'submission' | 'run-meta'`)
        return undefined
      }
      return inputFrom === 'run-meta'
        ? { type: 'schema-check', schemaPath, inputFrom }
        : { type: 'schema-check', schemaPath }
    }
    case 'attested': {
      const key = raw['key']
      if (typeof key !== 'string' || key === '') {
        problems.push(`${where}: attested guard needs a non-empty key`)
        return undefined
      }
      return { type: 'attested', key }
    }
    default:
      problems.push(`${where}: unknown guard type ${JSON.stringify(raw['type'])}`)
      return undefined
  }
}

/**
 * Parse and validate a raw template document (already JSON-parsed). Accepts
 * the state machine either nested under `stateMachine` or flattened at the
 * top level (`states` / `transitions` / `releasableStates`).
 * @param raw - the parsed template document.
 * @param origin - where the document came from, for error messages.
 * @returns the normalized template.
 * @throws listing every problem found.
 */
export function parseTemplate(raw: unknown, origin: string): RunTemplate {
  const problems: string[] = []
  if (!isRecord(raw)) throw new Error(`mission: template ${origin} must be a JSON object`)

  const machineRaw = isRecord(raw['stateMachine']) ? raw['stateMachine'] : raw
  const statesRaw = machineRaw['states']
  const transitionsRaw = machineRaw['transitions']
  const releasableRaw = machineRaw['releasableStates']

  const states: string[] = []
  if (!Array.isArray(statesRaw) || statesRaw.length === 0 || statesRaw.some(s => typeof s !== 'string' || s === '')) {
    problems.push('states: must be a non-empty string array')
  } else {
    states.push(...statesRaw as string[])
    const seen = new Set<string>()
    for (const s of states) {
      if (seen.has(s)) problems.push(`states: duplicate state ${JSON.stringify(s)}`)
      seen.add(s)
    }
  }
  const stateSet = new Set(states)

  const transitions: TransitionDecl[] = []
  if (!Array.isArray(transitionsRaw)) {
    problems.push('transitions: must be an array')
  } else {
    transitionsRaw.forEach((t, i) => {
      const where = `transitions[${i}]`
      if (!isRecord(t) || typeof t['from'] !== 'string' || typeof t['to'] !== 'string') {
        problems.push(`${where}: needs string from/to`)
        return
      }
      if (!stateSet.has(t['from'])) problems.push(`${where}: from ${JSON.stringify(t['from'])} is not a declared state`)
      if (!stateSet.has(t['to'])) problems.push(`${where}: to ${JSON.stringify(t['to'])} is not a declared state`)
      const guard = readGuard(t['guard'], where, problems)
      transitions.push(guard === undefined
        ? { from: t['from'], to: t['to'] }
        : { from: t['from'], to: t['to'], guard })
    })
  }

  const releasableStates: string[] = []
  if (releasableRaw !== undefined) {
    if (!Array.isArray(releasableRaw) || releasableRaw.some(s => typeof s !== 'string')) {
      problems.push('releasableStates: must be a string array')
    } else {
      for (const s of releasableRaw as string[]) {
        if (!stateSet.has(s)) problems.push(`releasableStates: ${JSON.stringify(s)} is not a declared state`)
        releasableStates.push(s)
      }
    }
  }

  const missions: TemplateMission[] = []
  const missionsRaw = raw['missions']
  if (missionsRaw !== undefined) {
    if (!Array.isArray(missionsRaw)) {
      problems.push('missions: must be an array')
    } else {
      const ids = new Set<string>()
      missionsRaw.forEach((m, i) => {
        const where = `missions[${i}]`
        if (!isRecord(m) || typeof m['id'] !== 'string' || m['id'] === '') {
          problems.push(`${where}: needs a non-empty string id`)
          return
        }
        const id = m['id']
        if (ids.has(id)) {
          problems.push(`${where}: duplicate mission id ${JSON.stringify(id)}`)
          return
        }
        ids.add(id)
        const mission: TemplateMission = { id }
        if (typeof m['title'] === 'string') mission.title = m['title']
        if (m['labels'] !== undefined) {
          if (!isRecord(m['labels']) || Object.values(m['labels']).some(v => typeof v !== 'string')) {
            problems.push(`${where}: labels must be a string map`)
            return
          }
          mission.labels = m['labels'] as Record<string, string>
        }
        if (m['dependsOn'] !== undefined) {
          if (!Array.isArray(m['dependsOn']) || m['dependsOn'].some(d => typeof d !== 'string')) {
            problems.push(`${where}: dependsOn must be a string array`)
            return
          }
          mission.dependsOn = m['dependsOn'] as string[]
        }
        if (m['scheduledAt'] !== undefined) {
          if (typeof m['scheduledAt'] !== 'number' || !Number.isFinite(m['scheduledAt'])) {
            problems.push(`${where}: scheduledAt must be a finite number (epoch ms)`)
            return
          }
          mission.scheduledAt = m['scheduledAt']
        }
        missions.push(mission)
      })
      for (const m of missions) {
        for (const dep of m.dependsOn ?? []) {
          if (!ids.has(dep)) problems.push(`mission ${JSON.stringify(m.id)}: dependsOn ${JSON.stringify(dep)} is not a mission of this template`)
        }
      }
    }
  }

  if (problems.length === 0) {
    const shape = deriveShape({ states, transitions, releasableStates })
    if (shape.initials.length === 0) {
      problems.push('state machine has no initial state (every state has an incoming edge) — missions would have nowhere to start')
    } else if (shape.initials.length > 1) {
      problems.push(`state machine has ${shape.initials.length} initial states (${shape.initials.join(', ')}) — exactly one is required so mission start is unambiguous`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`mission: invalid template ${origin}:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  }
  const template: RunTemplate = { stateMachine: { states, transitions, releasableStates }, missions }
  if (typeof raw['name'] === 'string' && raw['name'] !== '') template.name = raw['name']
  return template
}

/** A template document plus the directory its relative paths resolve against. */
export interface LoadedTemplate {
  template: RunTemplate
  /** Directory of the template file (undefined for inline templates). */
  templateDir?: string
}

/**
 * Load and validate a template from a JSON file.
 * @param path - template file path.
 * @returns the parsed template and its directory (schemaPath base).
 */
export function loadTemplateFile(path: string): LoadedTemplate {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`mission: cannot read template ${path}: ${String(error)}`)
  }
  return { template: parseTemplate(raw, path), templateDir: dirname(resolve(path)) }
}

/** Resolve a guard's schemaPath: absolute as-is, else against the template's directory. */
export function resolveSchemaPath(schemaPath: string, templateDir: string | undefined): string {
  if (isAbsolute(schemaPath)) return schemaPath
  if (templateDir === undefined) {
    throw new Error(`mission: schema-check schemaPath ${JSON.stringify(schemaPath)} is relative but the template has no file location (inline template) — use an absolute schemaPath`)
  }
  return resolve(templateDir, schemaPath)
}

/** Lint verdict for one template. */
export interface LintResult {
  errors: string[]
  warnings: string[]
}

/**
 * Run the lint rules over a validated template. `templateDir` enables the
 * schema-check probes (schema exists, parses, stays in the subset).
 * @param template - the validated template.
 * @param templateDir - base for schemaPath resolution, when the template came from a file.
 * @returns errors (refuse run creation) and warnings (advisory).
 */
export function lintTemplate(template: RunTemplate, templateDir?: string): LintResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { transitions, releasableStates } = template.stateMachine

  if (releasableStates.length > 0) {
    const releasable = new Set(releasableStates)
    for (const t of transitions) {
      if (releasable.has(t.to) && t.guard === undefined) {
        errors.push(`transition ${t.from} → ${t.to} enters a releasable state without a guard — an unguarded release permission is an empty gate`)
      }
    }
    // Terminal reachable without passing through any releasable state:
    // walk the graph with releasable states removed, from the initial state.
    const shape = deriveShape(template.stateMachine)
    const reachable = new Set<string>()
    const queue = shape.initials.filter(s => !releasable.has(s))
    for (const s of queue) reachable.add(s)
    while (queue.length > 0) {
      const from = queue.shift() as string
      for (const t of transitions) {
        if (t.from !== from || releasable.has(t.to) || reachable.has(t.to)) continue
        reachable.add(t.to)
        queue.push(t.to)
      }
    }
    for (const terminal of shape.terminals) {
      if (!releasable.has(terminal) && reachable.has(terminal)) {
        warnings.push(`terminal state ${JSON.stringify(terminal)} is reachable without passing through a releasable state — held resources may leak past it`)
      }
    }
  }

  for (const t of transitions) {
    if (t.guard?.type !== 'schema-check') continue
    let schemaFile: string
    try {
      schemaFile = resolveSchemaPath(t.guard.schemaPath, templateDir)
    } catch (error) {
      errors.push(`transition ${t.from} → ${t.to}: ${String(error)}`)
      continue
    }
    let schema: unknown
    try {
      schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
    } catch (error) {
      errors.push(`transition ${t.from} → ${t.to}: schema-check schema unreadable at ${schemaFile}: ${String(error)}`)
      continue
    }
    try {
      assertSchemaSubset(schema, `${schemaFile} (transition ${t.from} → ${t.to})`)
    } catch (error) {
      errors.push(String(error))
    }
  }

  return { errors, warnings }
}
