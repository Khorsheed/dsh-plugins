import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAuthenticated, internals, listClaudeSessions, projectRecord, syncClaudeCredentialFile } from '../src/records.ts'

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
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { expiresAt } }))
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
      claudeAiOauth: { expiresAt: Date.now() - 1_000, refreshTokenExpiresAt: Date.now() + 3_600_000 },
    }))
    await expect(claudeAuthenticated(home)).resolves.toBe(true)
  })

  it('mirrors a fresher keychain credential over the file before judging (refresh-on-run case)', async () => {
    const home = tempHome('claude-credfile-stale-')
    writeFileSync(join(home, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { expiresAt: Date.now() - 1_000 },
    }))
    const fresh = JSON.stringify({ claudeAiOauth: { expiresAt: Date.now() + 3_600_000 } })
    const savedExec = internals.exec
    internals.exec = (async (file: string, args: string[]) => {
      expect(file).toBe('security')
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
    const blob = JSON.stringify({ claudeAiOauth: { expiresAt: Date.now() + 3_600_000 } })
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
})
