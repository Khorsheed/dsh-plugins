/**
 * Contract tests for the agent-free workspace-admission seam: the `*At`
 * query verbs return exactly what the agent-bound twins return over the same
 * repository fixture; the controlled switch's receipt taxonomy (switched /
 * conflict / not-a-repo / no-worktree / invalid-request / persistence-failed)
 * with its single-process CAS; binding persistence (round-trip through a
 * simulated remount, receipt-after-persistence ordering, never-clobber
 * degrade); the `worktrees/switched` event; and the binding getter.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  isWorktreeBinding, resolveWorktreesStateRoot, WORKTREES_BINDINGS_FILE_NAME, WORKTREES_SWITCHED_EVENT,
  type WorktreeSwitchedEvent,
} from '../src/bindings.ts'
import { git, repoToplevel } from '../src/git.ts'
import { apply } from '../src/index.ts'
import { WorktreesRemoteService } from '../src/remote.ts'
import { WorktreesService } from '../src/service.ts'

/** One scratch repository + one linked worktree per test. */
let repo: string
let linked: string
let canonicalRepo: string
let canonicalLinked: string
let stateRoot: string

const sessionId = 'session-contract'

async function run(args: string[]): Promise<void> {
  await git(repo, args)
}

async function writeCommit(relPath: string, content: string, message: string): Promise<void> {
  writeFileSync(join(repo, relPath), content, 'utf8')
  await git(repo, ['add', '--', relPath])
  await git(repo, ['commit', '-m', message])
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'dsh-worktrees-seam-'))
  await run(['init', '-b', 'main'])
  await run(['config', 'user.email', 'test@example.com'])
  await run(['config', 'user.name', 'Test'])
  await writeCommit('a.txt', 'one\n', 'feat: base a')
  await writeCommit('b.txt', 'two\n', 'feat: base b')
  await run(['checkout', '-b', 'room'])
  await writeCommit('room.ts', 'hello\n', 'feat: room file')
  // The primary checkout holds `room`, so `main` is free for a linked worktree.
  linked = join(tmpdir(), `dsh-worktrees-seam-linked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await run(['worktree', 'add', linked, 'main'])
  canonicalRepo = (await repoToplevel(repo)) ?? ''
  canonicalLinked = await realpath(linked)
  stateRoot = mkdtempSync(join(tmpdir(), 'dsh-worktrees-state-'))
})

afterEach(async () => {
  try { await run(['worktree', 'remove', '--force', linked]) } catch { /* already removed */ }
  rmSync(repo, { recursive: true, force: true })
  rmSync(linked, { recursive: true, force: true })
  rmSync(stateRoot, { recursive: true, force: true })
})

/** A Remote over one service on a real (but bare) cordis Context. */
function makeRemote(service: WorktreesService): WorktreesRemoteService {
  const ctx = new Context()
  Object.assign(ctx, { worktreesCore: service })
  // The session-bound reads name their session by id (src/panel-session.ts).
  ctx.provide('sessions' as never, { get: (id: string) => attached.get(id) } as never)
  return new WorktreesRemoteService(ctx, {})
}

/** Sessions the Remote's session-bound reads resolve by id. */
const attached = new Map<string, unknown>()

/** The minimal Agent slice the agent-bound verbs read (`id` + `session.header.cwd`); its session is attached for the reads. */
function agentAt(cwd: string, id = sessionId): Agent {
  const session = { id, header: { cwd } }
  attached.set(id, session)
  return { id, session } as unknown as Agent
}

describe('agent-free query verbs', () => {
  it('return exactly the agent-bound results over the same repository', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nchanged\n', 'utf8')
    const service = new WorktreesService('main')
    const remote = makeRemote(service)
    const agent = agentAt(repo)

    expect(await remote.summaryAt({ at: repo })).toEqual(await remote.summary(agent.session.id))
    expect(await remote.changesAt({ at: repo })).toEqual(await remote.changes(agent.session.id))
    expect(await remote.repoFilesAt({ at: repo })).toEqual(await remote.repoFiles(agent.session.id))
    expect(await remote.listWorktreesAt({ at: repo })).toEqual(await remote.listWorktrees(agent.session.id))
    expect(await remote.commitLogAt({ at: repo })).toEqual(await remote.commitLog(agent.session.id))

    const sha = (await git(repo, ['rev-parse', 'HEAD'])).trim()
    expect(await remote.commitFilesAt({ at: repo, sha })).toEqual(await remote.commitFiles(agent.session.id, { sha }))
    const diffRequest = { path: 'a.txt', segment: 'uncommitted' as const }
    expect(await remote.fileDiffAt({ at: repo, ...diffRequest })).toEqual(await remote.fileDiff(agent.session.id, diffRequest))
    expect(await remote.readFileAt({ at: repo, path: 'a.txt' })).toEqual(await remote.readFile(agent.session.id, { path: 'a.txt' }))
    expect(await remote.readFileAt({ at: repo, path: 'a.txt', commit: 'HEAD' }))
      .toEqual(await remote.readFileAtCommit(agent.session.id, { path: 'a.txt', commit: 'HEAD' }))

    writeFileSync(join(repo, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await remote.readRepoImageAt({ at: repo, path: 'pic.png' }))
      .toEqual(await remote.readRepoImage(agent.session.id, { path: 'pic.png' }))
  })

  it('sees the same repository from a linked-worktree anchor, and rejects non-absolute anchors', async () => {
    const service = new WorktreesService('main')
    const remote = makeRemote(service)
    const fromLinked = await remote.summaryAt({ at: linked })
    expect(fromLinked.isRepo).toBe(true)
    expect(fromLinked.branch).toBe('main')
    // The agent-bound twin over a session rooted at the linked worktree agrees.
    expect(await remote.summary(agentAt(linked, 'other-session').session.id)).toEqual(fromLinked)
    await expect(remote.summaryAt({ at: 'relative/path' })).rejects.toThrow(/invalid local path/)
    await expect(remote.summaryAt({ at: '/up/../escape' })).rejects.toThrow(/invalid local path/)
  })
})

describe('controlled switch receipts', () => {
  it('switches with no expected (last-write-wins) and the getter reports the override', async () => {
    const service = new WorktreesService('main')
    const remote = makeRemote(service)
    const receipt = await remote.switchWorktreeControlled(sessionId, { path: linked })
    expect(receipt.kind).toBe('switched')
    if (receipt.kind !== 'switched') return
    expect(receipt.sessionId).toBe(sessionId)
    expect(receipt.worktree.path).toBe(canonicalLinked)
    expect(receipt.worktree.branch).toBe('main')
    expect(receipt.binding).toEqual({ kind: 'override', path: canonicalLinked })
    // Memory-only construction: the receipt says persistence is off, honestly.
    expect(receipt.persisted).toBe(false)
    expect(await remote.worktreeBinding(sessionId)).toEqual({ kind: 'override', path: canonicalLinked })
    expect(await remote.worktreeBinding('never-switched')).toEqual({ kind: 'none' })
  })

  it('honors the CAS: none → switched, stale none → conflict carrying the actual binding, matching override → switched', async () => {
    const service = new WorktreesService('main')
    const remote = makeRemote(service)

    const first = await remote.switchWorktreeControlled(sessionId, { path: linked, expected: { kind: 'none' } })
    expect(first.kind).toBe('switched')

    // A caller holding the pre-switch belief is refused and learns the ACTUAL binding.
    const stale = await remote.switchWorktreeControlled(sessionId, { path: repo, expected: { kind: 'none' } })
    expect(stale.kind).toBe('conflict')
    if (stale.kind !== 'conflict') return
    expect(stale.expected).toEqual({ kind: 'none' })
    expect(stale.actual).toEqual({ kind: 'override', path: canonicalLinked })
    // The conflict switched nothing.
    expect(await remote.worktreeBinding(sessionId)).toEqual({ kind: 'override', path: canonicalLinked })

    // A caller holding the current binding (trailing slashes normalize away) wins the swap.
    const second = await remote.switchWorktreeControlled(sessionId, {
      path: repo,
      expected: { kind: 'override', path: `${canonicalLinked}/` },
    })
    expect(second.kind).toBe('switched')
    if (second.kind !== 'switched') return
    expect(second.binding).toEqual({ kind: 'override', path: canonicalRepo })
    expect(second.worktree.isMain).toBe(true)
  })

  it('shares one CAS state with the legacy agent-bound switch', async () => {
    const service = new WorktreesService('main')
    const remote = makeRemote(service)
    await remote.switchWorktree(agentAt(repo), { path: linked })
    const conflict = await remote.switchWorktreeControlled(sessionId, { path: repo, expected: { kind: 'none' } })
    expect(conflict).toMatchObject({ kind: 'conflict', actual: { kind: 'override', path: canonicalLinked } })
    const switched = await remote.switchWorktreeControlled(sessionId, {
      path: repo,
      expected: { kind: 'override', path: canonicalLinked },
    })
    expect(switched.kind).toBe('switched')
  })

  it('classifies not-a-repo, no-worktree, and invalid requests without touching git', async () => {
    const service = new WorktreesService('main')
    const remote = makeRemote(service)

    const outside = mkdtempSync(join(tmpdir(), 'dsh-worktrees-plain-'))
    try {
      expect(await remote.switchWorktreeControlled(sessionId, { path: outside }))
        .toEqual({ kind: 'not-a-repo', path: outside })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }

    // A subdirectory of a worktree is inside a repository but is no worktree root.
    const subdir = join(repo, 'packages')
    mkdirSync(subdir, { recursive: true })
    expect(await remote.switchWorktreeControlled(sessionId, { path: subdir }))
      .toEqual({ kind: 'no-worktree', path: subdir, repo: canonicalRepo })

    expect((await remote.switchWorktreeControlled('', { path: linked })).kind).toBe('invalid-request')
    expect((await remote.switchWorktreeControlled(sessionId, { path: 'relative/x' })).kind).toBe('invalid-request')
    expect((await remote.switchWorktreeControlled(sessionId, { path: '' })).kind).toBe('invalid-request')
    const malformed = await remote.switchWorktreeControlled(sessionId, {
      path: linked,
      expected: { kind: 'main' } as never,
    })
    expect(malformed.kind).toBe('invalid-request')
    expect(isWorktreeBinding({ kind: 'none' })).toBe(true)
    expect(isWorktreeBinding({ kind: 'override', path: '/x' })).toBe(true)
    expect(isWorktreeBinding({ kind: 'override', path: '' })).toBe(false)
    expect(isWorktreeBinding({ kind: 'main' })).toBe(false)
    expect(isWorktreeBinding(null)).toBe(false)
  })
})

describe('binding persistence', () => {
  it('writes through and survives a simulated remount (load on mount)', async () => {
    const before = new WorktreesService('main', { stateRoot })
    const receipt = await before.controlledSwitch(sessionId, { path: linked })
    expect(receipt).toMatchObject({ kind: 'switched', persisted: true })

    // The receipt was returned only AFTER the write: the file already holds it.
    const doc = JSON.parse(readFileSync(join(stateRoot, WORKTREES_BINDINGS_FILE_NAME), 'utf8')) as {
      version: number
      bindings: Record<string, string>
    }
    expect(doc).toEqual({ version: 1, bindings: { [sessionId]: canonicalLinked } })

    // A fresh service over the same state root (a host restart) loads the binding.
    const after = new WorktreesService('main', { stateRoot })
    expect(after.activeWorktreeOf(sessionId)).toBeUndefined()
    expect(await after.bindingOf(sessionId)).toEqual({ kind: 'override', path: canonicalLinked })
    expect(after.activeWorktreeOf(sessionId)).toBe(canonicalLinked)
  })

  it('persists the legacy agent-bound switch and the removal clear too', async () => {
    const service = new WorktreesService('main', { stateRoot })
    const remote = makeRemote(service)
    await remote.switchWorktree(agentAt(repo), { path: linked })
    const doc = JSON.parse(readFileSync(join(stateRoot, WORKTREES_BINDINGS_FILE_NAME), 'utf8')) as {
      bindings: Record<string, string>
    }
    expect(doc.bindings[sessionId]).toBe(canonicalLinked)

    // Removing the bound worktree clears the override on disk as well.
    await service.removeWorktree(sessionId, repo, linked, true)
    const cleared = JSON.parse(readFileSync(join(stateRoot, WORKTREES_BINDINGS_FILE_NAME), 'utf8')) as {
      bindings: Record<string, string>
    }
    expect(cleared.bindings[sessionId]).toBeUndefined()
    expect(await service.bindingOf(sessionId)).toEqual({ kind: 'none' })
  })

  it('degrades to memory-only on a corrupt state file and never clobbers it', async () => {
    writeFileSync(join(stateRoot, WORKTREES_BINDINGS_FILE_NAME), '{ not json', 'utf8')
    const service = new WorktreesService('main', { stateRoot })
    expect(service.persistenceAvailable).toBe(false)
    const receipt = await service.controlledSwitch(sessionId, { path: linked })
    expect(receipt).toMatchObject({ kind: 'switched', persisted: false })
    expect(await service.bindingOf(sessionId)).toEqual({ kind: 'override', path: canonicalLinked })
    // The corrupt file is left exactly as found (an operator fixes it by hand).
    expect(readFileSync(join(stateRoot, WORKTREES_BINDINGS_FILE_NAME), 'utf8')).toBe('{ not json')
  })

  it('returns persistence-failed (never a fake success) when the write-through fails, leaving memory untouched', async () => {
    const service = new WorktreesService('main', { stateRoot })
    await service.bindingsReady()
    expect(service.persistenceAvailable).toBe(true)
    // Load succeeded (no file yet); make the state root unwritable so the
    // tmp-file write fails beneath the atomic rename.
    chmodSync(stateRoot, 0o555)
    try {
      const receipt = await service.controlledSwitch(sessionId, { path: linked })
      expect(receipt.kind).toBe('persistence-failed')
      if (receipt.kind !== 'persistence-failed') return
      expect(receipt.sessionId).toBe(sessionId)
      expect(receipt.path).toBe(canonicalLinked)
      expect(receipt.message).toBeTruthy()
      // Memory and file still agree on the PREVIOUS binding (none).
      expect(await service.bindingOf(sessionId)).toEqual({ kind: 'none' })
      // The legacy verb refuses loudly rather than faking the switch.
      await expect(service.switchWorktree(sessionId, repo, linked)).rejects.toThrow(/worktrees/)
      expect(await service.bindingOf(sessionId)).toEqual({ kind: 'none' })
    } finally {
      chmodSync(stateRoot, 0o755)
    }
  })
})

describe('the worktrees/switched event', () => {
  it('fires on the legacy switch, create, and the controlled switch — with the binding payload; not on conflicts or clears', async () => {
    const events: WorktreeSwitchedEvent[] = []
    const service = new WorktreesService('main', { onSwitched: event => events.push(event) })

    await service.switchWorktree(sessionId, repo, linked)
    expect(events).toEqual([{ sessionId, path: canonicalLinked }])

    const conflict = await service.controlledSwitch(sessionId, { path: repo, expected: { kind: 'none' } })
    expect(conflict.kind).toBe('conflict')
    expect(events).toHaveLength(1)

    await service.controlledSwitch(sessionId, { path: repo, expected: { kind: 'override', path: canonicalLinked } })
    expect(events).toEqual([
      { sessionId, path: canonicalLinked },
      { sessionId, path: canonicalRepo },
    ])

    const created = join(tmpdir(), `dsh-worktrees-seam-created-${Date.now()}`)
    try {
      await service.createWorktree(sessionId, repo, created, 'feat/created')
      expect(events).toHaveLength(3)
      expect(events[2]).toEqual({ sessionId, path: await realpath(created) })
      // Clearing (removing the bound worktree) is NOT a switch — no event in v1.
      await service.removeWorktree(sessionId, repo, created, true)
      expect(events).toHaveLength(3)
    } finally {
      try { await run(['worktree', 'remove', '--force', created]) } catch { /* already removed */ }
      rmSync(created, { recursive: true, force: true })
    }
  })

  it('re-emits through ctx.emit when the plugin apply wires the hook', async () => {
    const ctx = new Context()
    const seen: WorktreeSwitchedEvent[] = []
    ctx.on(WORKTREES_SWITCHED_EVENT, event => { seen.push(event) })
    apply(ctx, { stateRoot })
    const receipt = await ctx.worktreesCore.controlledSwitch(sessionId, { path: linked })
    expect(receipt.kind).toBe('switched')
    expect(seen).toEqual([{ sessionId, path: canonicalLinked }])
    await ctx.fiber.dispose().catch(() => undefined)
  })
})

describe('resolveWorktreesStateRoot', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers the explicit value, then $DSH_HOME/state/worktrees, then the cwd fallback', () => {
    expect(resolveWorktreesStateRoot('/explicit/root')).toBe('/explicit/root')
    vi.stubEnv('DSH_HOME', '/home/user/deployment')
    expect(resolveWorktreesStateRoot(undefined)).toBe('/home/user/deployment/state/worktrees')
    expect(resolveWorktreesStateRoot('')).toBe('/home/user/deployment/state/worktrees')
    vi.stubEnv('DSH_HOME', '')
    expect(resolveWorktreesStateRoot(undefined)).toBe(join(process.cwd(), '.dsh-worktrees'))
  })
})
