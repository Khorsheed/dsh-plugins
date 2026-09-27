/**
 * 准备好了没有, row by row (T84 §三): for the dataset, each group, each judge
 * and the verdict sources, the one-line 依据 and the checks behind it.
 *
 * Everything is read from what the page already has — the review's condition
 * rows (declaration hash, lock, home hash, status), validate's flat check
 * list (by CODE and by the condition it names, never by a sentence's
 * meaning), and, once a run started, the readiness probe each group got.
 *
 * Two kinds of 就绪 are kept apart on purpose: before the start it is an
 * offline file check; at the start the orchestrator sends each group one
 * real delegation and that result replaces the offline one.
 */
import type { EvalConditionRow, EvalPlanCheck, EvalPlanCondition, EvalReadinessLine } from '../types.ts'
import type { EvalKey } from './locales.ts'

/** One check behind a row: its verdict and its sentence. */
export interface BasisLine {
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  key: EvalKey
  params?: Record<string, string | number>
  /** validate's code, for the hover; null for a structural fact. */
  code: string | null
}

/** One row of the table. */
export interface ReadinessRowModel {
  key: string
  kind: 'dataset' | 'player' | 'judge' | 'sources'
  label: string
  /** The row's verdict: `ok`, `warn` (reminders only) or `danger` (not ready / blocks). */
  state: 'ok' | 'warn' | 'danger'
  /** The short 依据 phrases, joined with ` · ` on screen. */
  basis: Array<{ key: EvalKey; params?: Record<string, string | number> }>
  /** The expansion: every check, with its evidence. */
  lines: BasisLine[]
  /** validate's warnings about THIS group — shown in its expansion, not in 提醒. */
  warns: EvalPlanCheck[]
  /** The real probe the run sent at its start; null before a start. */
  probe: EvalReadinessLine | null
  /** A judge that shares a player's model: it is grading itself. */
  selfJudge: boolean
}

const DATASET_CODES = new Set(['COMMIT_UNRESOLVED', 'DATASET_ROOT_UNRESOLVABLE', 'ITEMS_EMPTY', 'STAGES_EMPTY'])
const isStageSchema = (code: string): boolean => code.startsWith('STAGE_SCHEMA_')
const SOURCE_CODES = new Set(['EXPECTED_NS_EMPTY', 'EXPECTED_NS_NO_LLM_DRAFT_CRITERIA', 'EXPECTED_NS_NO_PROBE', 'EXPECTED_NS_NO_RUBRIC', 'EXPECTED_NS_RUBRIC_UNPARSEABLE', 'JUDGE_REQUIRED_FOR_LLM_DRAFT'])
const PROVISION_CODES = new Set(['PROVISION_RECORD_MISSING', 'PROVISION_MISMATCH', 'HOME_NOT_PROVISIONED', 'SCOPE_NOT_PROVISIONED', 'CAPABILITIES_NOT_PROVISIONED'])

const short = (sha: string | null): string => (sha === null ? '—' : sha.slice(0, 8))
const worst = (tones: ReadonlyArray<BasisLine['tone']>): ReadinessRowModel['state'] => (
  tones.includes('danger') ? 'danger' : tones.includes('warn') ? 'warn' : 'ok'
)
const toneOf = (check: EvalPlanCheck): BasisLine['tone'] => (check.severity === 'error' ? 'danger' : check.severity === 'warn' ? 'warn' : 'ok')

/** The dataset row: the commit resolves, each stage has its schema. */
function datasetRow(input: ReadinessInput): ReadinessRowModel | null {
  const { dataset, stages, checks } = input
  if (dataset === null || !input.reviewed) return null
  const mine = checks.filter(check => check.severity !== 'ok' && (DATASET_CODES.has(check.code) || isStageSchema(check.code)))
  const commitBad = mine.filter(check => check.code === 'COMMIT_UNRESOLVED' || check.code === 'DATASET_ROOT_UNRESOLVABLE')
  const schemaBad = mine.filter(check => isStageSchema(check.code))
  const lines: BasisLine[] = [
    commitBad.length === 0
      ? { tone: 'ok', key: 'basis.dataset.commit', params: { commit: short(dataset.commit) }, code: null }
      : { tone: toneOf(commitBad[0] as EvalPlanCheck), key: 'basis.dataset.commitBad', code: commitBad[0]?.code ?? null },
    ...(stages.length === 0
      ? [{ tone: 'neutral' as const, key: 'basis.dataset.noStages' as EvalKey, code: null }]
      : [{
          tone: schemaBad.length === 0 ? 'ok' as const : worst(schemaBad.map(toneOf)) === 'danger' ? 'danger' as const : 'warn' as const,
          key: 'basis.dataset.schemas' as EvalKey,
          params: { ok: Math.max(0, stages.length - schemaBad.length), n: stages.length, stages: stages.join('、') },
          code: schemaBad[0]?.code ?? null,
        }]),
    ...mine.filter(check => check.severity === 'error' && !commitBad.includes(check) && !schemaBad.includes(check)).map(check => ({
      tone: toneOf(check), key: 'basis.check' as EvalKey, params: { text: check.message }, code: check.code,
    })),
  ]
  return {
    key: 'dataset',
    kind: 'dataset',
    label: `${dataset.id ?? '—'} @ ${short(dataset.commit)}`,
    state: worst([...lines.map(line => line.tone), ...mine.filter(check => check.severity === 'warn').map(() => 'warn' as const)]),
    basis: [
      { key: commitBad.length === 0 ? 'basis.dataset.commitShort' : 'basis.dataset.commitBadShort' },
      ...(stages.length === 0 ? [] : [{ key: 'basis.dataset.schemasShort' as EvalKey, params: { ok: Math.max(0, stages.length - schemaBad.length), n: stages.length } }]),
    ],
    lines,
    warns: mine.filter(check => check.severity === 'warn'),
    probe: null,
    selfJudge: false,
  }
}

/** One group or judge row. */
function subjectRow(id: string, role: 'player' | 'judge', input: ReadinessInput): ReadinessRowModel {
  const entry = input.conditions.find(each => each.id === id)
  const mine = input.checks.filter(check => check.condition === id && check.severity !== 'ok')
  const probe = input.probes.find(line => line.condition === id) ?? null
  const lines: BasisLine[] = []
  const basis: ReadinessRowModel['basis'] = []
  if (!input.reviewed) {
    // A started run whose plan review has not come back: the probe below is
    // the whole verdict.
  } else if (entry === undefined || entry.status === 'missing') {
    lines.push({ tone: 'danger', key: 'basis.subject.missing', code: 'CONDITION_FILE_MISSING' })
    basis.push({ key: 'basis.subject.missingShort' })
  } else {
    if (!entry.lock.present) {
      lines.push({ tone: 'danger', key: 'basis.subject.noLock', params: { sha: short(entry.sha) }, code: 'LOCK_MISSING' })
      basis.push({ key: 'basis.subject.noLockShort' })
    } else if (!entry.lock.matches) {
      lines.push({ tone: 'danger', key: 'basis.subject.lockStale', params: { sha: short(entry.sha) }, code: 'LOCK_STALE' })
      basis.push({ key: 'basis.subject.lockStaleShort' })
    } else {
      lines.push({ tone: 'ok', key: 'basis.subject.lockMatch', params: { sha: short(entry.sha) }, code: null })
      basis.push({ key: 'basis.subject.lockMatchShort' })
    }
    const homeBad = mine.find(check => check.code.startsWith('HOME_') || check.code.startsWith('UNIT_SCOPED_HOME'))
    if (homeBad !== undefined) {
      lines.push({ tone: toneOf(homeBad), key: 'basis.check', params: { text: homeBad.message }, code: homeBad.code })
      basis.push({ key: 'basis.subject.homeBadShort' })
    } else if (entry.lock.homeSha !== null) {
      lines.push({ tone: 'ok', key: 'basis.subject.home', params: { sha: short(entry.lock.homeSha) }, code: null })
      basis.push({ key: 'basis.subject.homeShort' })
    } else if (entry.status !== 'ready') {
      // The review calls it unready and no home digest was ever written back:
      // that is one of the reasons, not a default.
      lines.push({ tone: 'danger', key: 'basis.subject.homeMissing', code: null })
      basis.push({ key: 'basis.subject.homeMissingShort' })
    } else {
      lines.push({ tone: 'neutral', key: 'basis.subject.homeDefault', code: null })
    }
    if (role === 'player') {
      const provisionBad = mine.find(check => PROVISION_CODES.has(check.code))
      if (provisionBad !== undefined) {
        lines.push({ tone: toneOf(provisionBad), key: 'basis.check', params: { text: provisionBad.message }, code: provisionBad.code })
        basis.push({ key: 'basis.subject.provisionBadShort' })
      } else if (entry.status === 'ready') {
        lines.push({ tone: 'ok', key: 'basis.subject.provisioned', code: null })
        basis.push({ key: 'basis.subject.provisionedShort' })
      }
    }
  }
  const registry = input.registry.find(row => row.id === id)
  let selfJudge = false
  if (role === 'judge') {
    const undeclared = mine.find(check => check.code === 'JUDGE_MODEL_UNDECLARED')
    if (undeclared !== undefined) {
      lines.push({ tone: toneOf(undeclared), key: 'basis.judge.modelUndeclared', code: undeclared.code })
      basis.push({ key: 'basis.judge.modelUndeclaredShort' })
    } else {
      lines.push({ tone: 'ok', key: 'basis.judge.model', params: { model: registry?.model ?? '—' }, code: null })
      basis.push({ key: 'basis.judge.modelShort' })
    }
    const model = registry?.model ?? null
    selfJudge = model !== null && input.players.some(player => input.registry.find(row => row.id === player)?.model === model)
    if (selfJudge) lines.push({ tone: 'warn', key: 'basis.judge.self', params: { model: model ?? '—' }, code: null })
  }
  // Every other error of this group (an endpoint, a malformed declaration)
  // is part of its verdict; its warnings go under it rather than into 提醒.
  const shown = new Set(lines.map(line => line.code))
  const hadDanger = lines.some(line => line.tone === 'danger')
  let otherBad = false
  for (const check of mine) {
    if (check.severity === 'error' && !shown.has(check.code)) {
      lines.push({ tone: 'danger', key: 'basis.check', params: { text: check.message }, code: check.code })
      otherBad = true
    }
  }
  // Unready with nothing above saying why: say that validate refused it, so
  // a red row never stands without a reason.
  if (input.reviewed && entry !== undefined && entry.status !== 'ready' && !hadDanger && !otherBad) {
    lines.push({ tone: 'danger', key: 'basis.subject.unready', code: null })
    otherBad = true
  }
  if (otherBad) basis.push({ key: 'basis.subject.otherBadShort' })
  const warns = mine.filter(check => check.severity === 'warn' && !shown.has(check.code))
  if (probe !== null) {
    lines.push({
      tone: probe.ok ? 'ok' : 'danger',
      key: probe.ok ? 'basis.probe.ok' : 'basis.probe.failed',
      params: {
        model: probe.observedModel ?? probe.requestedModel ?? probe.declaredModel ?? '—',
        seconds: Math.round(probe.durationMs / 100) / 10,
        reason: probe.reason ?? '',
      },
      code: null,
    })
  } else {
    lines.push({ tone: 'neutral', key: 'basis.probe.atStart', code: null })
  }
  const tones = lines.map(line => line.tone)
  const offlineReady = entry !== undefined && entry.status === 'ready'
  const state: ReadinessRowModel['state'] = probe !== null
    ? (probe.ok ? (warns.length > 0 ? 'warn' : 'ok') : 'danger')
    : !offlineReady || tones.includes('danger') ? 'danger' : warns.length > 0 || tones.includes('warn') ? 'warn' : 'ok'
  return {
    key: `${role}:${id}`,
    kind: role,
    label: id,
    state,
    basis: probe === null ? basis : [{ key: probe.ok ? 'basis.probe.okShort' : 'basis.probe.failedShort' }, ...basis],
    lines,
    warns,
    probe,
    selfJudge,
  }
}

/** The verdict-sources row: each layer the plan expects has something to judge with. */
function sourcesRow(input: ReadinessInput): ReadinessRowModel | null {
  if (input.expectedNs.length === 0 || !input.reviewed) return null
  const mine = input.checks.filter(check => check.severity !== 'ok' && SOURCE_CODES.has(check.code))
  const lines: BasisLine[] = mine.length === 0
    ? [{ tone: 'ok', key: 'basis.sources.ok', params: { layers: input.expectedNs.join(' / ') }, code: null }]
    : mine.filter(check => check.severity === 'error').map(check => ({ tone: toneOf(check), key: 'basis.check' as EvalKey, params: { text: check.message }, code: check.code }))
  const warns = mine.filter(check => check.severity === 'warn')
  const state = worst([...lines.map(line => line.tone), ...warns.map(() => 'warn' as const)])
  return {
    key: 'sources',
    kind: 'sources',
    label: '',
    state,
    basis: [{ key: mine.length === 0 ? 'basis.sources.okShort' : 'basis.sources.badShort', params: { n: mine.length } }],
    lines,
    warns,
    probe: null,
    selfJudge: false,
  }
}

/** What the table reads. */
export interface ReadinessInput {
  /** The plan review has loaded; without it only the probes speak. */
  reviewed: boolean
  dataset: { id: string | null; commit: string | null } | null
  stages: readonly string[]
  expectedNs: readonly string[]
  players: readonly string[]
  judges: readonly string[]
  conditions: readonly EvalPlanCondition[]
  checks: readonly EvalPlanCheck[]
  /** The started run's probes; empty before a start. */
  probes: readonly EvalReadinessLine[]
  /** The comparison-group registry, for the models (自评). */
  registry: readonly EvalConditionRow[]
}

/**
 * The table's rows: the dataset, each group, each judge, the verdict sources.
 * @param input - the review, the run's probes and the registry.
 * @returns the rows, and the warnings that belong to no group (they stay in 提醒).
 */
export function readinessTable(input: ReadinessInput): { rows: ReadinessRowModel[]; attached: ReadonlySet<EvalPlanCheck> } {
  const rows: ReadinessRowModel[] = []
  const dataset = datasetRow(input)
  if (dataset !== null) rows.push(dataset)
  for (const id of input.players) rows.push(subjectRow(id, 'player', input))
  for (const id of input.judges) rows.push(subjectRow(id, 'judge', input))
  const sources = sourcesRow(input)
  if (sources !== null) rows.push(sources)
  // A warning about a group the review calls unready is a blocker
  // (splitReadiness) and stays in the blocker lines; only the reminders move
  // under their group, the dataset's and the verdict sources' under theirs.
  const unready = new Set(input.conditions.filter(entry => entry.status !== 'ready').map(entry => entry.id))
  for (const row of rows) {
    if (row.kind === 'player' || row.kind === 'judge') row.warns = row.warns.filter(check => !unready.has(row.label) || check.condition !== row.label)
  }
  return { rows, attached: new Set<EvalPlanCheck>(rows.flatMap(row => row.warns)) }
}
