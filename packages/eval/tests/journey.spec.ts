/**
 * T72 — the browser-side rules of the lab journey: list grouping, the session
 * filter and its 另有 n 个 count, the readiness checklist's split and its
 * code → button table, and the conclusion card's source sentence. Pure
 * functions, so the pages' specs can assert the rendering and trust these.
 */
import { describe, expect, it } from 'vitest'
import {
  conclusionSourceKey, fixLabel, groupRows, listGroupOf, READINESS_CODES, readinessField, readinessFix, readinessKey,
  readinessSentence, readListScope, scopeRows, splitReadiness, validityCount, writeListScope,
} from '../src/client/journey.ts'
import { en, zh } from '../src/client/locales.ts'
import type { EvalExperimentRow } from '../src/types.ts'

type Row = Pick<EvalExperimentRow, 'status' | 'archived' | 'runId' | 'originSession'>
const row = (over: Partial<Row>): Row => ({ status: 'running', archived: false, runId: 'r', originSession: 's1', ...over })

describe('list grouping', () => {
  it('puts every status whose next step is a person\'s under 需要你处理', () => {
    for (const status of ['draft', 'pending-approval', 'stalled', 'judging', 'refused'] as const) {
      expect(listGroupOf(row({ status }))).toBe('attention')
    }
    expect(listGroupOf(row({ status: 'running' }))).toBe('running')
    for (const status of ['done', 'void', 'cancelled'] as const) {
      expect(listGroupOf(row({ status }))).toBe('finished')
    }
  })

  it('archive moves the row and nothing else', () => {
    const archived = row({ status: 'stalled', archived: true })
    expect(listGroupOf(archived)).toBe('archived')
    expect(archived.status).toBe('stalled')
    const groups = groupRows([row({ status: 'judging' }), archived, row({ status: 'done' })])
    expect(groups.attention).toHaveLength(1)
    expect(groups.archived).toEqual([archived])
    expect(groups.finished).toHaveLength(1)
  })
})

describe('the session filter', () => {
  const rows = [
    row({ runId: null, originSession: null }), // a draft: everyone's
    row({ originSession: 's1' }),
    row({ originSession: 's2' }),
    row({ originSession: null }), // a CLI run
  ]

  it('shows drafts and this session\'s runs, and COUNTS the rest instead of dropping them', () => {
    const { shown, others } = scopeRows(rows, 's1', 'session')
    expect(shown).toEqual([rows[0], rows[1]])
    expect(others).toBe(2)
  })

  it('全部 shows everything and still reports the count', () => {
    expect(scopeRows(rows, 's1', 'all')).toEqual({ shown: rows, others: 2 })
  })

  it('a call from no session owns no run', () => {
    expect(scopeRows(rows, null, 'session')).toEqual({ shown: [rows[0]], others: 3 })
  })

  it('remembers the toggle, and survives storage that throws', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    } as unknown as Storage
    expect(readListScope(storage)).toBe('session')
    writeListScope('all', storage)
    expect(readListScope(storage)).toBe('all')
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    } as unknown as Storage
    expect(readListScope(broken)).toBe('session')
    expect(() => { writeListScope('all', broken) }).not.toThrow()
  })
})

describe('the readiness checklist', () => {
  const check = (severity: 'error' | 'warn' | 'ok', code: string, condition: string | null = null, message = '') => (
    { severity, code, condition, message }
  )

  it('errors block; a warning blocks when its condition is not ready; ok lines are not listed', () => {
    const checks = [
      check('error', 'PLAN_SCHEMA'),
      check('warn', 'LOCK_STALE', 'b'),
      check('warn', 'LOCK_STALE', 'a'),
      check('warn', 'COMMIT_UNRESOLVED'),
      check('ok', 'CONDITION_READY', 'a'),
    ]
    const conditions = [{ id: 'a', status: 'ready' as const }, { id: 'b', status: 'unready' as const }]
    const { blockers, reminders } = splitReadiness(checks, conditions)
    expect(blockers.map(entry => entry.code)).toEqual(['PLAN_SCHEMA', 'LOCK_STALE'])
    expect(blockers[1]!.condition).toBe('b')
    expect(reminders.map(entry => entry.code)).toEqual(['LOCK_STALE', 'COMMIT_UNRESOLVED'])
  })

  it('maps codes to the three fixes', () => {
    expect(readinessFix(check('error', 'LOCK_MISSING', 'a'))).toEqual({ kind: 'provision', condition: 'a' })
    expect(readinessFix(check('error', 'SCOPE_NOT_PROVISIONED', 'a'))).toEqual({ kind: 'provision', condition: 'a' })
    expect(readinessFix(check('error', 'CAPABILITIES_SNAPSHOT_STALE', 'a'))).toEqual({ kind: 'provision', condition: 'a' })
    // provision needs a condition to name; without one the agent gets it.
    expect(readinessFix(check('error', 'LOCK_MISSING'))).toEqual({ kind: 'agent' })
    expect(readinessFix(check('error', 'UNRESOLVED_FIELD', 'a', 'endpoint is unresolved')))
      .toEqual({ kind: 'endpoint', condition: 'a' })
    expect(readinessFix(check('error', 'UNRESOLVED_FIELD', 'a', 'model is unresolved'))).toEqual({ kind: 'agent' })
    // No binding since T73: an unresolvable dataset is the agent's to fix (re-draft with a pinned commit).
    expect(readinessFix(check('warn', 'DATASET_ROOT_UNRESOLVABLE'))).toEqual({ kind: 'agent' })
    expect(readinessFix(check('warn', 'COMMIT_UNRESOLVED'))).toEqual({ kind: 'agent' })
    expect(readinessFix(check('error', 'PLAN_SCHEMA'))).toEqual({ kind: 'agent' })
    expect(fixLabel({ kind: 'provision', condition: 'a' })).toEqual({ key: 'fix.provision', params: { condition: 'a' } })
    expect(fixLabel({ kind: 'agent' }).key).toBe('fix.agent')
  })

  it('has a sentence for every code in BOTH languages, and falls back to validate\'s words', () => {
    for (const code of READINESS_CODES) {
      const key = `readiness.${code}` as keyof typeof en
      expect(en[key], code).toBeTruthy()
      expect(zh[key], code).toBeTruthy()
    }
    expect(readinessKey('NOT_A_CODE_YET')).toBeNull()
    // A sentence that names a condition is not used for a plan-level line.
    expect(readinessKey('LOCK_MISSING', 'a')).toBe('readiness.LOCK_MISSING')
    expect(readinessKey('LOCK_MISSING', null)).toBeNull()
    expect(readinessKey('COMMIT_UNRESOLVED', null)).toBe('readiness.COMMIT_UNRESOLVED')
  })

  it('names the field, so two unfilled fields on one condition read as two lines', () => {
    expect(readinessField('endpoint.baseUrl is null — unresolved; the pre-run readiness gate refuses this condition'))
      .toBe('endpoint.baseUrl')
    expect(readinessField('model: not reported by the harness')).toBe('model')
    expect(readinessField('something went wrong')).toBeNull()
    expect(readinessField('condition codex-exec: home.sha is null — unresolved')).toBe('home.sha')
    expect(readinessField('judge condition j: model.endpoint is null — unresolved')).toBe('model.endpoint')
    const endpoint = readinessSentence({ code: 'UNRESOLVED_FIELD', condition: 'a', message: 'endpoint.baseUrl is null — unresolved' })
    const home = readinessSentence({ code: 'UNRESOLVED_FIELD', condition: 'a', message: 'home.sha is null — unresolved' })
    expect(endpoint).toEqual({ key: 'readiness.UNRESOLVED_FIELD', params: { condition: 'a', field: 'endpoint.baseUrl' } })
    expect(home?.params.field).toBe('home.sha')
    // No field to name: validate's own message, not a sentence with a hole.
    expect(readinessSentence({ code: 'UNRESOLVED_FIELD', condition: 'a', message: 'unresolved' })).toBeNull()
    expect(zh['readiness.UNRESOLVED_FIELD']).toContain('{field}')
  })
})

describe('the conclusion card', () => {
  it('names the source by the closure exit', () => {
    expect(conclusionSourceKey(null)).toBe('report.sourceDraft')
    expect(conclusionSourceKey({ exit: 'unreviewed' })).toBe('report.sourceDraft')
    expect(conclusionSourceKey({ exit: 'final' })).toBe('report.sourceFinal')
    expect(conclusionSourceKey({ exit: 'flagged' })).toBe('report.sourceFinal')
    expect(conclusionSourceKey({ exit: 'void' })).toBeNull()
    expect(zh['report.sourceFinal']).toBe('来源：判官初判 + 人终评')
    expect(zh['report.sourceDraft']).toBe('来源：判官初判，未经人工确认')
  })

  it('counts only ok checks as passed', () => {
    expect(validityCount([{ status: 'ok' }, { status: 'violated' }, { status: 'unverifiable' }, { status: 'ok' }, { status: 'ok' }]))
      .toEqual({ passed: 3, total: 5 })
  })
})
