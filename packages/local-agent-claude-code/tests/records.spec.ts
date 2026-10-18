import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listClaudeSessions, projectRecord, readClaudeTranscriptModel } from '../src/records.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A scoped home with one project session file under a cwd-slug directory. */
function homeWithSession(sessionId: string, cwd: string, timestamp: string): string {
  const home = tempHome('claude-records-')
  const dir = join(home, 'projects', cwd.replaceAll('/', '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), JSON.stringify({
    type: 'user',
    sessionId,
    cwd,
    timestamp,
    message: { role: 'user', content: 'hi' },
  }) + '\n')
  return home
}

describe('claude records', () => {
  it('parses the first user event head into a listing record', () => {
    const record = projectRecord(JSON.stringify({
      type: 'user',
      sessionId: 's1',
      cwd: '/work',
      timestamp: '2026-08-16T01:02:03.000Z',
    }))
    expect(record).toEqual({ id: 's1', workDir: '/work', startedAt: Date.parse('2026-08-16T01:02:03.000Z') })
  })

  it('refuses a non-user head, a missing cwd, or non-JSON', () => {
    expect(projectRecord(JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/work' }))).toBeUndefined()
    expect(projectRecord(JSON.stringify({ type: 'user', sessionId: 's1' }))).toBeUndefined()
    expect(projectRecord('not-json')).toBeUndefined()
  })

  it('lists sessions across slug directories, skipping malformed files', async () => {
    const home = homeWithSession('s1', '/work/a', '2026-08-16T01:02:03.000Z')
    const dir = join(home, 'projects', 'work-b')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'torn.jsonl'), '{"type":"user","sessionId":')
    const records = await listClaudeSessions(home)
    expect(records).toHaveLength(1)
    // The listed cwd comes from the CONTENT, never the lossy slug directory.
    expect(records[0]).toEqual({ id: 's1', workDir: '/work/a', startedAt: Date.parse('2026-08-16T01:02:03.000Z') })
  })

  it('returns [] when no sessions exist yet', async () => {
    expect(await listClaudeSessions(tempHome('claude-empty-'))).toEqual([])
  })
})

describe('readClaudeTranscriptModel (the lastObserved history backstop)', () => {
  /** One assistant transcript line as claude writes it (the model nests in `message`). */
  function assistantLine(model: string, sessionId = 's1'): string {
    return JSON.stringify({
      type: 'assistant',
      sessionId,
      message: { model, role: 'assistant', content: [{ type: 'text', text: '答' }] },
    })
  }

  /** Write one transcript file under a project-slug directory. */
  function writeTranscript(home: string, slug: string, name: string, lines: readonly string[], mtime?: number): string {
    const dir = join(home, 'projects', slug)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, lines.join('\n') + '\n')
    if (mtime !== undefined) utimesSync(path, mtime / 1000, mtime / 1000)
    return path
  }

  it('member level: the session’s own transcript answers, the NEWEST model line winning', async () => {
    const home = tempHome('claude-tm-member-')
    writeTranscript(home, '-work-a', 's1.jsonl', [
      assistantLine('claude-opus-4'),
      assistantLine('claude-sonnet-4-5-20250929'),
    ])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBe('claude-sonnet-4-5-20250929')
  })

  it('the top-level `model` of the stream-json init shape answers too', async () => {
    const home = tempHome('claude-tm-init-')
    writeTranscript(home, '-work-a', 's1.jsonl', [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5[1m]' }),
      JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'hi' } }),
    ])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBe('claude-opus-5[1m]')
  })

  it('the file is located by NAME across project dirs — the lossy slug is never computed', async () => {
    const home = tempHome('claude-tm-slug-')
    // A slug that no slugging rule would produce from the session's real cwd.
    writeTranscript(home, 'whatever-slug', 's1.jsonl', [assistantLine('claude-opus-5')])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBe('claude-opus-5')
  })

  it('sidechain fallback: an agent-*.jsonl sharing the session id answers when no main file exists', async () => {
    const home = tempHome('claude-tm-sidechain-')
    writeTranscript(home, '-work-a', 'agent-672d3a40.jsonl', [
      JSON.stringify({ isSidechain: true, sessionId: 's1', type: 'user', message: { role: 'user', content: 'Warmup' } }),
      assistantLine('claude-sonnet-4-5-20250929'),
    ])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBe('claude-sonnet-4-5-20250929')
  })

  it('a sidechain belonging to a DIFFERENT session is ignored', async () => {
    const home = tempHome('claude-tm-foreign-')
    writeTranscript(home, '-work-a', 'agent-672d3a40.jsonl', [
      JSON.stringify({ isSidechain: true, sessionId: 'someone-else', type: 'user' }),
      assistantLine('claude-sonnet-4-5-20250929', 'someone-else'),
    ])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBeUndefined()
  })

  it('harness level: the NEWEST transcript across the projects tree answers', async () => {
    const home = tempHome('claude-tm-harness-')
    writeTranscript(home, '-work-a', 's1.jsonl', [assistantLine('claude-opus-4')], Date.parse('2026-08-01T00:00:00Z'))
    writeTranscript(home, '-work-b', 's2.jsonl', [assistantLine('claude-sonnet-4-5-20250929')], Date.parse('2026-09-01T00:00:00Z'))
    await expect(readClaudeTranscriptModel(home)).resolves.toBe('claude-sonnet-4-5-20250929')
  })

  it('harness level: a newest file naming no model yields to the next newest', async () => {
    const home = tempHome('claude-tm-yield-')
    writeTranscript(home, '-work-a', 's1.jsonl', [assistantLine('claude-opus-4')], Date.parse('2026-08-01T00:00:00Z'))
    writeTranscript(home, '-work-b', 's2.jsonl', [
      JSON.stringify({ type: 'user', sessionId: 's2', message: { role: 'user', content: 'hi' } }),
    ], Date.parse('2026-09-01T00:00:00Z'))
    await expect(readClaudeTranscriptModel(home)).resolves.toBe('claude-opus-4')
  })

  it('missing tree, unknown session, and garbage files all read as undefined, never a throw', async () => {
    const home = tempHome('claude-tm-empty-')
    await expect(readClaudeTranscriptModel(home)).resolves.toBeUndefined()
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBeUndefined()
    writeTranscript(home, '-work-a', 's1.jsonl', ['not json at all', '{"type":"user"}'])
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBeUndefined()
    await expect(readClaudeTranscriptModel(home, 'never-existed')).resolves.toBeUndefined()
  })

  it('the read is bounded to the tail window: a model only in the far head of a huge file stays unread', async () => {
    const home = tempHome('claude-tm-big-')
    const filler = JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'x'.repeat(4096) } })
    writeTranscript(home, '-work-a', 's1.jsonl', [
      assistantLine('claude-ancient'),
      ...Array.from({ length: 100 }, () => filler),
      assistantLine('claude-sonnet-4-5-20250929'),
    ])
    // The tail window sees the recent model; the ancient head line never decides.
    await expect(readClaudeTranscriptModel(home, 's1')).resolves.toBe('claude-sonnet-4-5-20250929')
    const headOnly = tempHome('claude-tm-headonly-')
    writeTranscript(headOnly, '-work-a', 's1.jsonl', [
      assistantLine('claude-ancient'),
      ...Array.from({ length: 100 }, () => filler),
    ])
    await expect(readClaudeTranscriptModel(headOnly, 's1')).resolves.toBeUndefined()
  })
})
