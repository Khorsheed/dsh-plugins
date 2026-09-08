import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codexAuthenticated,
  codexRolloutRoundFacts,
  codexRolloutTokenUsage,
  listCodexSessions,
  rolloutCliVersion,
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

/** The real codex 0.144 rollout event shape for one turn_context line. */
function turnContextLine(timestamp: string, model: string, cwd: string): string {
  return JSON.stringify({ type: 'turn_context', timestamp, payload: { turn_id: `turn-${timestamp}`, cwd, model } })
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

  it('locates the rollout file by thread id and reads back its usage, model, and codex build', async () => {
    const home = tempHome('codex-facts-thread-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const threadId = 'thread-42'
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${threadId}.jsonl`), [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: threadId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work', cli_version: '0.144.0' },
      }),
      turnContextLine('2026-08-16T01:00:01.000Z', 'gpt-5.6-sol', '/work'),
      tokenCountLine(tokenCountInfo(
        { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, total_tokens: 125 },
      )),
      '',
    ].join('\n'))
    const facts = await codexRolloutRoundFacts(home, { threadId, windowStart: Date.parse('2026-08-16T01:00:00.000Z') })
    expect(facts).toEqual({
      usage: { inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 },
      model: 'gpt-5.6-sol',
      cliVersion: '0.144.0',
    })
  })

  it('reads the model back from a turn_context far outside the tail window', async () => {
    // The regression that made a real evaluation run report a null model:
    // codex writes turn_context when the TURN STARTS, so a round that then
    // produces more than the tail window of events pushes it out of reach of a
    // tail-only scan. The file below is deliberately larger than the window.
    const home = tempHome('codex-facts-bigfile-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const threadId = 'thread-big'
    const filler = JSON.stringify({
      type: 'response_item',
      payload: { type: 'reasoning', text: 'x'.repeat(4096) },
    })
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${threadId}.jsonl`), [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: threadId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work', cli_version: '0.144.0' },
      }),
      turnContextLine('2026-08-16T01:00:01.000Z', 'gpt-5.6-sol', '/work'),
      ...Array.from({ length: 40 }, () => filler),
      tokenCountLine(tokenCountInfo({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 })),
      '',
    ].join('\n'))
    const facts = await codexRolloutRoundFacts(home, { threadId, windowStart: Date.parse('2026-08-16T01:00:00.000Z') })
    expect(facts.model).toBe('gpt-5.6-sol')
    expect(facts.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
  })

  it('ignores an earlier round\u2019s turn_context: only this round\u2019s window counts', async () => {
    const home = tempHome('codex-facts-resume-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const threadId = 'thread-resumed'
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${threadId}.jsonl`), [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: threadId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work', cli_version: '0.144.0' },
      }),
      turnContextLine('2026-08-16T01:00:01.000Z', 'old-model', '/work'),
      turnContextLine('2026-08-16T02:00:00.000Z', 'new-model', '/work'),
      '',
    ].join('\n'))
    const round1 = await codexRolloutRoundFacts(home, { threadId, windowStart: Date.parse('2026-08-16T01:00:00.000Z') })
    expect(round1.model).toBe('new-model')
    const round2 = await codexRolloutRoundFacts(home, { threadId, windowStart: Date.parse('2026-08-16T01:59:59.000Z') })
    expect(round2.model).toBe('new-model')
    const beforeAnyTurn = await codexRolloutRoundFacts(home, { threadId, windowStart: Date.parse('2026-08-16T03:00:00.000Z') })
    expect(beforeAnyTurn.model).toBeUndefined()
  })

  it('falls back to the time window when the thread id matches nothing', async () => {
    const home = tempHome('codex-facts-window-')
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const sessionId = 'window-session'
    writeFileSync(join(dir, `rollout-2026-08-16T01-00-00-${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId, timestamp: '2026-08-16T01:00:00.000Z', cwd: '/work' } }),
      tokenCountLine(tokenCountInfo(
        { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, total_tokens: 12 },
      )),
    ].join('\n'))
    const facts = await codexRolloutRoundFacts(home, {
      threadId: 'no-such-thread',
      windowStart: Date.parse('2026-08-16T01:00:10.000Z'),
    })
    expect(facts.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
  })

  describe('concurrent rounds inside one window', () => {
    /** Two rounds started seconds apart in different cell directories. */
    function concurrentHome(): string {
      const home = tempHome('codex-facts-concurrent-')
      const dir = join(home, 'sessions', '2026', '08', '16')
      mkdirSync(dir, { recursive: true })
      for (const [id, cwd, model, minute] of [
        ['cell-a-session', '/cells/a', 'model-a', '00'],
        ['cell-b-session', '/cells/b', 'model-b', '01'],
      ] as const) {
        writeFileSync(join(dir, `rollout-2026-08-16T01-${minute}-00-${id}.jsonl`), [
          JSON.stringify({
            type: 'session_meta',
            payload: { id, timestamp: `2026-08-16T01:${minute}:00.000Z`, cwd, cli_version: '0.144.0' },
          }),
          turnContextLine(`2026-08-16T01:${minute}:01.000Z`, model, cwd),
        ].join('\n'))
      }
      return home
    }

    it('separates the two files by the round\u2019s cwd when no thread id located one', async () => {
      const home = concurrentHome()
      // Without the cwd, the newest file in the window wins — which is the
      // OTHER cell's round.
      const blind = await codexRolloutRoundFacts(home, { windowStart: Date.parse('2026-08-16T01:00:00.000Z') })
      expect(blind.model).toBe('model-b')
      const own = await codexRolloutRoundFacts(home, {
        windowStart: Date.parse('2026-08-16T01:00:00.000Z'),
        cwd: '/cells/a',
      })
      expect(own.model).toBe('model-a')
    })

    it('reports nothing rather than a neighbour\u2019s round when no file matches the cwd', async () => {
      const home = concurrentHome()
      const facts = await codexRolloutRoundFacts(home, {
        windowStart: Date.parse('2026-08-16T01:00:00.000Z'),
        cwd: '/cells/never-ran',
      })
      expect(facts).toEqual({})
    })

    it('still answers on a lone in-window file whose cwd differs (path skew, not ambiguity)', async () => {
      const home = tempHome('codex-facts-skew-')
      const dir = join(home, 'sessions', '2026', '08', '16')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'rollout-2026-08-16T01-00-00-lonely.jsonl'), [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'lonely', timestamp: '2026-08-16T01:00:00.000Z', cwd: '/private/tmp/cell', cli_version: '0.144.0' },
        }),
        turnContextLine('2026-08-16T01:00:01.000Z', 'model-lonely', '/private/tmp/cell'),
      ].join('\n'))
      const facts = await codexRolloutRoundFacts(home, {
        windowStart: Date.parse('2026-08-16T01:00:00.000Z'),
        cwd: '/tmp/cell',
      })
      expect(facts.model).toBe('model-lonely')
    })
  })

  it('reads the codex build from the session_meta head, and nothing from a head without one', () => {
    expect(rolloutCliVersion(JSON.stringify({
      type: 'session_meta',
      payload: { id: 's1', cwd: '/work', cli_version: '0.144.0' },
    }))).toBe('0.144.0')
    expect(rolloutCliVersion(JSON.stringify({ type: 'session_meta', payload: { id: 's1', cwd: '/work' } })))
      .toBeUndefined()
    expect(rolloutCliVersion('not-json')).toBeUndefined()
  })

  it('returns nothing when no file locates or the home has no sessions', async () => {
    expect(await codexRolloutRoundFacts(tempHome('codex-facts-empty-'), { threadId: 'x', windowStart: Date.now() }))
      .toEqual({})
    const home = homeWithSession('s1', '/work', '2026-08-16T01:02:03.000Z')
    expect(await codexRolloutRoundFacts(home, { threadId: 'other', windowStart: Date.parse('2026-09-01T00:00:00.000Z') }))
      .toEqual({})
  })
})
