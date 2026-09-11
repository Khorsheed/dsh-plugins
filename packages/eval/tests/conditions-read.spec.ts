import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffConditionDocuments, diffConditions, listConditions } from '../src/read.ts'
import { hashConditionDocument } from '../src/hash.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

/**
 * T31 — the two READ verbs beside provision. `list` gains the provisioned
 * column (what the lock says the scope answered); `diff` shows which fields
 * two declarations differ on, and deliberately nothing more.
 */

const CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: [] },
} as const

const PROVISIONED = {
  at: 1_757_500_000_000,
  cliVersion: '0.144.0',
  effective: { model: 'gpt-5.6-sol', reasoningEffort: 'default', permissions: 'workspace-write', endpoint: 'default' },
}

/** A repo with the given conditions under one dataset set. */
function repoWith(conditions: Record<string, Record<string, unknown>>, locks: Record<string, unknown> = {}): string {
  const repo = join(tmpTree(), 'repo')
  const dataset = join(repo, 'datasets', 'ds')
  for (const [id, document] of Object.entries(conditions)) writeJson(dataset, `conditions/${id}.json`, document)
  for (const [id, lock] of Object.entries(locks)) writeJson(dataset, `conditions/${id}.lock.json`, lock)
  return repo
}

describe('conditions list — the provisioned column', () => {
  it('reports what the lock says provision saw', async () => {
    const document = { ...CONDITION }
    const repo = repoWith({ c1: document }, {
      c1: { schema: 'dataseek.condition-lock/1', condition: 'c1', sha: hashConditionDocument(document), home: { sha: 'b'.repeat(64) }, provisioned: PROVISIONED },
    })
    const report = await listConditions(repo)
    const summary = report.conditions[0]

    expect(summary?.lock.present).toBe(true)
    expect(summary?.lock.matches).toBe(true)
    expect(summary?.lock.provisioned).toEqual(PROVISIONED)
  })

  it('reports null — not a blank — for a lock written before provision existed', async () => {
    const document = { ...CONDITION }
    const repo = repoWith({ c1: document }, {
      c1: { schema: 'dataseek.condition-lock/1', condition: 'c1', sha: hashConditionDocument(document) },
    })
    const report = await listConditions(repo)

    expect(report.conditions[0]?.lock.provisioned).toBeNull()
    expect(report.conditions[0]?.warnings.map(w => w.code)).toContain('PROVISION_RECORD_MISSING')
  })
})

describe('conditions diff — shows, never chooses', () => {
  it('finds the one field two otherwise identical conditions differ on', async () => {
    const repo = repoWith({
      a: { ...CONDITION, notes: 'the default scope' },
      b: { ...CONDITION, scope: 'eval-b', notes: 'the named scope' },
    })
    const diff = await diffConditions(repo, 'a', 'b')

    expect(diff.identical).toBe(false)
    expect(diff.differences.filter(difference => difference.path !== 'notes')).toEqual([
      { path: 'scope', b: 'eval-b' },
    ])
    expect(diff.a.sha).not.toBe(diff.b.sha)
    // No verdict, no advice: the answer is the field list and the two values.
    expect(Object.keys(diff).sort()).toEqual(['a', 'b', 'differences', 'identical', 'notesOnly'])
  })

  it('calls two conditions identical when only notes differ — a comment is not a factor', async () => {
    const repo = repoWith({ a: { ...CONDITION, notes: 'one' }, b: { ...CONDITION, notes: 'two' } })
    const diff = await diffConditions(repo, 'a', 'b')

    expect(diff.identical).toBe(true)
    expect(diff.notesOnly).toBe(true)
    expect(diff.a.sha).toBe(diff.b.sha)
    // Still SHOWN, so a reader is never surprised by text that changed.
    expect(diff.differences.map(difference => difference.path)).toEqual(['notes'])
  })

  it('takes a path as readily as an id', async () => {
    const repo = repoWith({ a: { ...CONDITION }, b: { ...CONDITION, permissions: 'read-only' } })
    const diff = await diffConditions(repo, join(repo, 'datasets/ds/conditions/a.json'), 'b')
    expect(diff.differences).toEqual([{ path: 'permissions', a: 'workspace-write', b: 'read-only' }])
  })

  it('refuses an id that resolves nowhere rather than diffing against nothing', async () => {
    const repo = repoWith({ a: { ...CONDITION } })
    await expect(diffConditions(repo, 'a', 'nope')).rejects.toThrow(/no condition "nope"/)
  })

  it('reports an absent field as a difference, both ways round', () => {
    const { differences } = diffConditionDocuments({ unit: { scopedHome: { container: '/creds/codex' } } }, {})
    expect(differences).toEqual([{ path: 'unit.scopedHome.container', a: '/creds/codex' }])
  })

  it('treats an array as one leaf — env.keys is a fact a reader wants whole', () => {
    const { differences } = diffConditionDocuments({ env: { keys: ['A', 'B'] } }, { env: { keys: ['A'] } })
    expect(differences).toEqual([{ path: 'env.keys', a: ['A', 'B'], b: ['A'] }])
  })
})
