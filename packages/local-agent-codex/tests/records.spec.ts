import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codexAuthenticated,
  codexRolloutTokenUsage,
  codexRolloutUsage,
  listCodexSessions,
  rolloutRecord,
  usageFromCodex,
} from '../src/records.ts'

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

/** The real codex 0.144 rollout event shape for one token_count line. */
function tokenCountLine(info: unknown): string {
  return JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info } })
}

/** The real codex 0.144 `info` payload: per-turn + session totals. */
function tokenCountInfo(last: Record<string, number>, total: Record<string, number> = last): unknown {
  return { last_token_usage: last, total_token_usage: total, model_context_window: 258400 }
}

describe('codex records', () => {
  it('parses a session_meta head into a listing record', () => {
    const record = rolloutRecord(JSON.stringify({
      type: 'session_meta',
      payload: { session_id: 's1', cwd: '/work', timestamp: '2026-08-16T01:02:03.000Z' },
    }))
    expect(record).toEqual({ id: 's1', workDir: '/work', startedAt: Date.parse('2026-08-16T01:02:03.000Z') })
  })

  it('accepts the real codex 0.144 session_meta schema (payload.id)', () => {
    const record = rolloutRecord(JSON.stringify({
      type: 'session_meta',
      payload: { id: '019f2cfe-6e18', timestamp: '2026-07-04T11:58:19.696Z', cwd: '/work' },
    }))
    expect(record).toEqual({ id: '019f2cfe-6e18', workDir: '/work', startedAt: Date.parse('2026-07-04T11:58:19.696Z') })
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

describe('codex usage caliber (shared with turn.completed)', () => {
  it('subtracts cached input from the total input and reports the cache-read bucket', () => {
    expect(usageFromCodex({ input_tokens: 10, cached_input_tokens: 6, output_tokens: 4 }))
      .toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
  })

  it('omits the cache bucket when codex reports no cached input', () => {
    expect(usageFromCodex({ input_tokens: 5, output_tokens: 3 })).toEqual({ inputTokens: 5, outputTokens: 3 })
  })

  it('tolerates malformed numbers as zero', () => {
    expect(usageFromCodex({ input_tokens: 'x', cached_input_tokens: 1, output_tokens: undefined }))
      .toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1 })
  })
})

describe('codex rollout token_count recovery', () => {
  it('scans the LAST token_count event and maps its per-turn usage', () => {
    const text = [
      tokenCountLine(tokenCountInfo(
        { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, total_tokens: 125 },
      )),
      tokenCountLine(tokenCountInfo(
        { input_tokens: 200, cached_input_tokens: 80, output_tokens: 50, total_tokens: 250 },
      )),
    ].join('\n')
    expect(codexRolloutTokenUsage(text)).toEqual({ inputTokens: 120, outputTokens: 50, cacheReadTokens: 80 })
  })

  it('falls back to the session total when a token_count entry has no per-turn usage', () => {
    const text = tokenCountLine({ total_token_usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 } })
    expect(codexRolloutTokenUsage(text)).toEqual({ inputTokens: 5, outputTokens: 3, cacheReadTokens: 2 })
  })

  it('skips malformed lines and returns undefined when no token_count exists', () => {
    expect(codexRolloutTokenUsage('not-json\n{"type":"event_msg","payload":{"type":"turn_aborted"}}')).toBeUndefined()
  })

  it('locates the rollout file by thread id and recovers the last token_count from its tail', async () => {
    const home = tempHome('codex-usage-thread-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const threadId = 'thread-42'
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${threadId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: threadId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work' } }),
      tokenCountLine(tokenCountInfo(
        { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, total_tokens: 125 },
      )),
      '',
    ].join('\n'))
    const usage = await codexRolloutUsage(home, { threadId, windowStart: Date.parse('2026-08-16T01:00:05.000Z') })
    expect(usage).toEqual({ inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 })
  })

  it('falls back to the time window when the thread id matches nothing', async () => {
    const home = tempHome('codex-usage-window-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const sessionId = 'window-session'
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work' } }),
      tokenCountLine(tokenCountInfo(
        { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, total_tokens: 12 },
      )),
    ].join('\n'))
    const usage = await codexRolloutUsage(home, {
      threadId: 'no-such-thread',
      windowStart: Date.parse('2026-08-16T01:00:10.000Z'),
    })
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 2 })
  })

  it('returns undefined when nothing locates or the home has no sessions', async () => {
    expect(await codexRolloutUsage(tempHome('codex-usage-empty-'), { threadId: 'x', windowStart: Date.now() }))
      .toBeUndefined()
    const home = homeWithSession('s1', '/work', '2026-08-16T01:02:03.000Z')
    expect(await codexRolloutUsage(home, { threadId: 'other', windowStart: Date.parse('2026-09-01T00:00:00.000Z') }))
      .toBeUndefined()
  })
})
