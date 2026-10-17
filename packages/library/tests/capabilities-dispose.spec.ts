/**
 * The capabilities handshake and the dispose guard.
 *
 * `capabilities` is the read-only display contract: storage availability with
 * its reason, the attachment probe's verdict at call time, and the
 * additive-evolution protocolVersion (only optional fields are ever added).
 * Enforcement stays at the write gates, untouched.
 *
 * Disposal is terminal: every public verb refuses with the coded,
 * package-named LibraryDisposedError, a write racing disposal refuses before
 * the lock is ever taken (the store's lock/temp-write/atomic-rename already
 * keeps the disk side safe), dispose is idempotent and follows the borrowed
 * Context's teardown, and a rebuild over the same state root is a NEW
 * instance's ordinary business.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryDisposedError, LibraryService } from '../src/service.ts'

let root: string
let service: LibraryService

/** A ctx with no attachments service (the probe path reads as absent). */
const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context

/** A ctx whose attachment store answers (the minimal structural mirror). */
const ctxWithAttachments = {
  get: (name: string) => name === 'attachments'
    ? { readImage: async () => ({ data: new Uint8Array(), ref: { mediaType: 'image/png' } }) }
    : undefined,
  effect: () => () => {},
} as unknown as Context

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-capabilities-'))
  service = new LibraryService(ctx, { stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A seeded project's id. */
async function seedProject(): Promise<string> {
  const created = await service.createProject({ name: '神经科学' })
  if (!created.ok) throw new Error(created.message)
  return created.project.id
}

/** A manually-released gate (the cross-instance lock-contention bench). */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  return { promise: new Promise<void>(resolve => { open = resolve }), open }
}

describe('the capabilities handshake', () => {
  it('reports writable storage and no attachment store, with the additive-shape protocolVersion', async () => {
    const capabilities = await service.capabilities()
    expect(capabilities).toEqual({
      protocolVersion: 1,
      hasStorage: true,
      hasAttachments: false,
    })
    // The additive-evolution rule: the reason key is ABSENT, never null — new
    // fields only ever join as optional keys.
    expect('storageUnavailableReason' in capabilities).toBe(false)
  })

  it('reports an unwritable root with its reason (the store probe, host-side knowable)', async () => {
    // A state root nested under a regular FILE can never be created.
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    const unwritable = new LibraryService(ctx, { stateRoot: join(blocker, 'nested') })
    const capabilities = await unwritable.capabilities()
    expect(capabilities.protocolVersion).toBe(1)
    expect(capabilities.hasStorage).toBe(false)
    expect(capabilities.storageUnavailableReason).toContain('blocker')
    // …and the write gates still enforce it, exactly as before (display ≠ enforcement).
    const created = await unwritable.createProject({ name: 'x' })
    expect(!created.ok && created.error).toBe('storage-unavailable')
  })

  it('reflects the per-call attachment probe at call time', async () => {
    expect((await service.capabilities()).hasAttachments).toBe(false)
    const withAttachments = new LibraryService(ctxWithAttachments, { stateRoot: root })
    expect((await withAttachments.capabilities()).hasAttachments).toBe(true)
  })
})

describe('the dispose guard', () => {
  it('refuses every public verb with the coded package error after dispose', async () => {
    const projectId = await seedProject()
    service.dispose()
    const photo = { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
    const card = { kind: 'concept' as const, term: 'x', gloss: 'y', source: { type: 'manual' as const } }
    // Reads refuse too: a mounting side never keeps consuming a stale instance.
    await expect(service.capabilities()).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listProjects()).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.getProject({ id: projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.getResource({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.getRoadmap({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listPages({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.readPagePhoto({ projectId, pageId: 'pg_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listResources({ projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listCards({ projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.dueCards({})).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listAssessments({ projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.getAssessment({ projectId, assessmentId: 'q_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listAttempts({ projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.listEvents({ projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.recentRecords({})).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.stats()).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.createProject({ name: 'x' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.updateProject({ id: projectId, patch: {} })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.deleteProject({ id: projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.putResource({ projectId, kind: 'book', title: 't', bookKind: 'knowledge', toc: [{ title: 'c' }], tocSource: { by: 'model' } })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.removeResource({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.removeResource({ projectId, resourceId: 'res_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.draftRoadmap({ projectId, resourceId: 'b_1', nodes: [] })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.adoptRoadmap({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.discardDraft({ projectId, resourceId: 'b_1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.markNodeRead({ projectId, resourceId: 'b_1', nodeId: 'n1' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.recordPage({ projectId, resourceId: 'b_1', attachment: photo, text: 't', marks: [] })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.savePhoto({ data: '', mediaType: 'image/png' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.writeCards({ projectId, cards: [card] })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.editCard({ projectId, cardId: 'c_1', patch: {} })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.undoCards({ projectId, ids: [], at: '' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.reviewCard({ projectId, cardId: 'c_1', rating: 'recalled' })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.putQuiz({ projectId, quiz: { scope: { resourceId: 'b_1' }, questions: [] } })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.putAttempt({ projectId, quizId: 'q_1', verdicts: [] })).rejects.toBeInstanceOf(LibraryDisposedError)
    await expect(service.setBinding('s1', { projectId })).rejects.toBeInstanceOf(LibraryDisposedError)
    // The synchronous verbs throw (never return a refusal-shaped value).
    expect(() => service.getBinding('s1')).toThrow(LibraryDisposedError)
    expect(() => service.bindingSummary('s1')).toThrow(LibraryDisposedError)
    expect(() => service.onChange(() => {})).toThrow(LibraryDisposedError)
    // Coded and package-named — never a bare throw of arbitrary shape.
    const error = await service.listProjects().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'LibraryDisposedError', code: 'disposed' })
    expect((error as Error).message).toContain('@khorsheed/dsh-library')
  })

  it('is idempotent', () => {
    service.dispose()
    service.dispose()
    expect(() => service.dispose()).not.toThrow()
  })

  it('follows the borrowed Context\'s own teardown', async () => {
    const realCtx = new Context()
    const mounted = new LibraryService(realCtx, { stateRoot: root })
    await realCtx.fiber.dispose()
    await expect(mounted.listProjects()).rejects.toBeInstanceOf(LibraryDisposedError)
  })

  it('a write racing disposal refuses coded BEFORE the lock is ever taken', async () => {
    const projectId = await seedProject()
    // Validation is synchronous from verb entry to the write boundary, so a
    // disposal resolves the race at the guards: the store's locks stay
    // untouched (a rebuilt instance on this root never queues behind a dead
    // one — the lock/temp-write/atomic-rename side was already disk-safe).
    const projectLock = vi.spyOn(service.store, 'withProjectLock')
    const indexLock = vi.spyOn(service.store, 'withIndexLock')
    const bindingsLock = vi.spyOn(service.store, 'withBindingsLock')
    service.dispose()
    await expect(service.writeCards({ projectId, cards: [{ kind: 'concept', term: 'x', gloss: 'y', source: { type: 'manual' } }] })).rejects.toMatchObject({ code: 'disposed' })
    await expect(service.createProject({ name: '晚到' })).rejects.toMatchObject({ code: 'disposed' })
    await expect(service.setBinding('s1', { projectId })).rejects.toMatchObject({ code: 'disposed' })
    expect(projectLock).not.toHaveBeenCalled()
    expect(indexLock).not.toHaveBeenCalled()
    expect(bindingsLock).not.toHaveBeenCalled()
  })

  it('a same-root rebuild after dispose works (the disposed instance alone stays dead)', async () => {
    const projectId = await seedProject()
    const written = await service.writeCards({
      projectId,
      cards: [{ kind: 'concept', term: '突触', gloss: '神经元连接处', source: { type: 'manual' } }],
    })
    if (!written.ok) throw new Error(written.message)
    service.dispose()
    await expect(service.listProjects()).rejects.toBeInstanceOf(LibraryDisposedError)
    // A NEW service instance over the same state root is ordinary business:
    // the released lock files gate it in, the data the first instance wrote
    // is all there.
    const rebuilt = new LibraryService(ctx, { stateRoot: root })
    const list = await rebuilt.listProjects()
    expect(list.projects.map(project => project.id)).toEqual([projectId])
    expect(list.projects[0]?.cardCount).toBe(1)
    const again = await rebuilt.writeCards({
      projectId,
      cards: [{ kind: 'concept', term: '树突', gloss: '接收信号', source: { type: 'manual' } }],
    })
    expect(again.ok).toBe(true)
  })

  it('two live instances on one root genuinely coordinate through the lock file', async () => {
    const projectId = await seedProject()
    const sibling = new LibraryService(ctx, { stateRoot: root })
    const held = gate()
    // The first instance holds the project lock (a slow mutation); the second
    // instance's write spins on the lock FILE, then lands after the release.
    const holding = service.store.withProjectLock(projectId, () => held.promise)
    const waiting = sibling.writeCards({
      projectId,
      cards: [{ kind: 'concept', term: '轴突', gloss: '传出信号', source: { type: 'manual' } }],
    })
    const early = await Promise.race([
      waiting.then(() => 'done' as const),
      new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 120)),
    ])
    expect(early).toBe('waiting')
    held.open()
    await holding
    expect((await waiting).ok).toBe(true)
  })
})
