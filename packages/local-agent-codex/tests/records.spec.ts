import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexAuthenticated, listCodexSessions, rolloutRecord } from '../src/records.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A scoped home with one rollout session under a dated subdirectory. */
function homeWithSession(sessionId: string, cwd: string, timestamp: string): string {
  const home = tempHome('codex-records-')
  const dir = join(home, 'sessions', '2026', '08', '16')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `rollout-2026-08-16T00-00-00-${sessionId}.jsonl`), JSON.stringify({
    type: 'session_meta',
    payload: { session_id: sessionId, cwd, timestamp },
  }) + '\n')
  return home
}

describe('codex records', () => {
  it('parses a session_meta head into a listing record', () => {
    const record = rolloutRecord(JSON.stringify({
      type: 'session_meta',
      payload: { session_id: 's1', cwd: '/work', timestamp: '2026-08-16T01:02:03.000Z' },
    }))
    expect(record).toEqual({ id: 's1', workDir: '/work', startedAt: Date.parse('2026-08-16T01:02:03.000Z') })
  })

  it('refuses a non-session_meta head or a missing cwd', () => {
    expect(rolloutRecord(JSON.stringify({ type: 'event_msg', payload: {} }))).toBeUndefined()
    expect(rolloutRecord(JSON.stringify({ type: 'session_meta', payload: { session_id: 's1' } }))).toBeUndefined()
    expect(rolloutRecord('not-json')).toBeUndefined()
  })

  it('lists sessions across dated directories, skipping malformed files', async () => {
    const home = homeWithSession('s1', '/work', '2026-08-16T01:02:03.000Z')
    const dir = join(home, 'sessions', '2026', '08', '17')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'rollout-torn.jsonl'), '{"type":"session_meta","payload":')
    const records = await listCodexSessions(home)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({ id: 's1', workDir: '/work', startedAt: Date.parse('2026-08-16T01:02:03.000Z') })
  })

  it('returns [] when no sessions exist yet', async () => {
    expect(await listCodexSessions(tempHome('codex-empty-'))).toEqual([])
  })

  it('treats auth.json presence as authenticated', async () => {
    const authed = tempHome('codex-auth-ok-')
    writeFileSync(join(authed, 'auth.json'), '{}')
    expect(await codexAuthenticated(authed)).toBe(true)
    const notAuthed = tempHome('codex-auth-none-')
    expect(await codexAuthenticated(notAuthed)).toBe(false)
  })
})
