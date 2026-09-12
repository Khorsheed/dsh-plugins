import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAuthenticated, internals, listClaudeSessions, projectRecord, readClaudeTranscriptModel, syncClaudeCredentialFile } from '../src/records.ts'

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

  it('treats a scoped .claude.json with oauthAccount as authenticated', async () => {
    const authed = tempHome('claude-auth-ok-')
    writeFileSync(join(authed, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x' } }))
    expect(await claudeAuthenticated(authed)).toBe(true)
    const notAuthed = tempHome('claude-auth-none-')
    writeFileSync(join(notAuthed, '.claude.json'), JSON.stringify({ firstStartTime: 1 }))
    expect(await claudeAuthenticated(notAuthed)).toBe(false)
    const noConfig = tempHome('claude-auth-absent-')
    expect(await claudeAuthenticated(noConfig)).toBe(false)
  })
})

describe('claudeAuthenticated credential file', () => {
  /** A scoped home with only a .credentials.json carrying the given expiry. */
  function homeWithCredentialFile(expiresAt: number): string {
    const home = tempHome('claude-credfile-')
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt } }))
    return home
  }

  it('accepts a credentials file with a future expiry (the runtime-readable path)', async () => {
    const home = homeWithCredentialFile(Date.now() + 3_600_000)
    await expect(claudeAuthenticated(home)).resolves.toBe(true)
  })

  it('rejects a credentials file past its expiry', async () => {
    const home = homeWithCredentialFile(Date.now() - 1_000)
    await expect(claudeAuthenticated(home)).resolves.toBe(false)
  })

  it('accepts an expired access token while its refresh token is still valid (the CLI refreshes on use)', async () => {
    const home = tempHome('claude-credfile-refresh-')
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() - 1_000, refreshTokenExpiresAt: Date.now() + 3_600_000 },
    }))
    await expect(claudeAuthenticated(home)).resolves.toBe(true)
  })

  it('mirrors a fresher keychain credential over the file before judging (refresh-on-run case)', async () => {
    const home = tempHome('claude-credfile-stale-')
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'stale-tok', expiresAt: Date.now() - 1_000 },
    }))
    const fresh = JSON.stringify({ claudeAiOauth: { accessToken: 'fresh-tok', expiresAt: Date.now() + 3_600_000 } })
    const savedExec = internals.exec
    internals.exec = (async (file: string, args: string[]) => {
      expect(file).toBe('security')
      if (args[0] === 'dump-keychain') return { stdout: '', stderr: '' }
      expect(args[0]).toBe('find-generic-password')
      return { stdout: fresh + '\n', stderr: '' }
    }) as never
    try {
      await expect(claudeAuthenticated(home)).resolves.toBe(true)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).resolves.toBe(fresh)
    } finally {
      internals.exec = savedExec
    }
  })
})
describe('keychain credential sync', () => {
  const realExec = internals.exec

  function stubKeychain(blob: string | undefined): void {
    internals.exec = (async (file: string, args: string[]) => {
      // The regression guard: the executable must be `security`, with the
      // subcommand as an argument — calling execFile('find-generic-password')
      // was the shipped bug this suite exists to catch.
      expect(file).toBe('security')
      if (args[0] === 'dump-keychain') return { stdout: '', stderr: '' }
      expect(args[0]).toBe('find-generic-password')
      if (blob === undefined) throw new Error('item not found')
      return { stdout: blob + '\n', stderr: '' }
    }) as never
  }

  function restoreExec(): void {
    internals.exec = realExec
  }

  it('writes the keychain blob into .credentials.json (0600)', async () => {
    const home = tempHome('claude-sync-')
    const blob = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 } })
    stubKeychain(blob)
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(true)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).resolves.toBe(blob)
      await expect(claudeAuthenticated(home)).resolves.toBe(true)
    } finally {
      restoreExec()
    }
  })

  it('returns false and writes nothing when the keychain entry is missing', async () => {
    const home = tempHome('claude-sync-missing-')
    stubKeychain(undefined)
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(false)
      await expect(claudeAuthenticated(home)).resolves.toBe(false)
    } finally {
      restoreExec()
    }
  })

  /** The service name the scoped home hashes to (mirrors src). */
  function serviceFor(home: string): string {
    return `Claude Code-credentials-${createHash('sha256').update(home).digest('hex').slice(0, 8)}`
  }

  /** A `security dump-keychain` rendering of the given items (metadata only). */
  function dumpKeychainOutput(items: ReadonlyArray<{ acct: string; svce: string; mdat: string }>): string {
    return items.map((item) => [
      'keychain: "/home/user/Library/Keychains/login.keychain-db"',
      'version: 512',
      'class: "genp"',
      'attributes:',
      `    "acct"<blob>="${item.acct}"`,
      `    "mdat"<timedate>=0x3245584546494b45  "${item.mdat}"`,
      `    "svce"<blob>="${item.svce}"`,
    ].join('\n')).join('\n')
  }

  /** Stub the keychain as a service with several items, one blob per account. */
  function stubKeychainMulti(
    dump: string,
    blobs: Readonly<Record<string, string>>,
  ): void {
    internals.exec = (async (file: string, args: string[]) => {
      expect(file).toBe('security')
      if (args[0] === 'dump-keychain') return { stdout: dump, stderr: '' }
      expect(args[0]).toBe('find-generic-password')
      const account = args[args.indexOf('-a') + 1]
      const blob = account === undefined ? undefined : blobs[account]
      if (blob === undefined) throw new Error(`unexpected read: ${args.join(' ')}`)
      return { stdout: blob + '\n', stderr: '' }
    }) as never
  }

  it('enumerates the service and mirrors the non-empty entry, never the empty shell', async () => {
    const home = tempHome('claude-sync-multi-')
    const service = serviceFor(home)
    const shell = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
    const real = JSON.stringify({ claudeAiOauth: { accessToken: 'real-tok', expiresAt: Date.now() + 3_600_000 } })
    stubKeychainMulti(dumpKeychainOutput([
      // The shell is the NEWER write — an unscoped `-w` read returns it first,
      // which was the shipped bug. Usability, not recency, must win.
      { acct: 'unknown', svce: service, mdat: '2026-09-01 00:00:00 +0000' },
      { acct: 'tester', svce: service, mdat: '2026-08-01 00:00:00 +0000' },
      // An unrelated service's item is ignored by the enumeration.
      { acct: 'other', svce: 'unrelated-service', mdat: '2026-09-02 00:00:00 +0000' },
    ]), { unknown: shell, tester: real })
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(true)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).resolves.toBe(real)
      await expect(claudeAuthenticated(home)).resolves.toBe(true)
    } finally {
      restoreExec()
    }
  })

  it('prefers the newest write among several usable entries', async () => {
    const home = tempHome('claude-sync-rotation-')
    const service = serviceFor(home)
    const older = JSON.stringify({ claudeAiOauth: { accessToken: 'old-tok', expiresAt: Date.now() + 1_000_000 } })
    const newer = JSON.stringify({ claudeAiOauth: { accessToken: 'new-tok', expiresAt: Date.now() + 3_600_000 } })
    stubKeychainMulti(dumpKeychainOutput([
      { acct: 'old', svce: service, mdat: '2026-08-01 00:00:00 +0000' },
      { acct: 'new', svce: service, mdat: '2026-09-01 00:00:00 +0000' },
    ]), { old: older, new: newer })
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(true)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).resolves.toBe(newer)
    } finally {
      restoreExec()
    }
  })

  it('returns false with all entries empty and removes a previously mirrored empty shell', async () => {
    const home = tempHome('claude-sync-shell-')
    const service = serviceFor(home)
    const shell = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
    writeFileSync(join(home, '.credentials.json'), shell)
    stubKeychainMulti(dumpKeychainOutput([
      { acct: 'unknown', svce: service, mdat: '2026-09-01 00:00:00 +0000' },
    ]), { unknown: shell })
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(false)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(claudeAuthenticated(home)).resolves.toBe(false)
    } finally {
      restoreExec()
    }
  })

  it('keeps a usable credentials file when the keychain has nothing usable', async () => {
    const home = tempHome('claude-sync-keep-')
    const service = serviceFor(home)
    const shell = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
    const real = JSON.stringify({ claudeAiOauth: { accessToken: 'real-tok', expiresAt: Date.now() + 3_600_000 } })
    writeFileSync(join(home, '.credentials.json'), real)
    stubKeychainMulti(dumpKeychainOutput([
      { acct: 'unknown', svce: service, mdat: '2026-09-01 00:00:00 +0000' },
    ]), { unknown: shell })
    try {
      await expect(syncClaudeCredentialFile(home)).resolves.toBe(false)
      const { readFile } = await import('node:fs/promises')
      await expect(readFile(join(home, '.credentials.json'), 'utf8')).resolves.toBe(real)
    } finally {
      restoreExec()
    }
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
