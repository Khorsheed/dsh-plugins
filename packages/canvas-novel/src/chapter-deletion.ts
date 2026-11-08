import type { ChapterFeedbackDoc } from './chapter-feedback.ts'
import type { IdeasDoc } from './ideas.ts'
import { normalizeEvent, type StoryEvent, type TimelineDoc } from './timeline.ts'
import { chapterIdentity, cleanNumber, cleanText, normalizeChapter, normalizeWorkId, type ChapterDeletionCounts, type ChapterDeletionStatus, type ChapterRecord, type PendingTable } from './types.ts'

export type {
  ChapterDeletionApplyRequest, ChapterDeletionListResult, ChapterDeletionMutationResult, ChapterDeletionPreviewRequest, ChapterDeletionPreviewResult,
  ChapterDeletionPurgeRequest, ChapterDeletionRestoreRequest, ChapterDeletionView,
} from './types.ts'

export interface ChapterDeletionSnapshot {
  readonly record: ChapterRecord
  readonly body: string
  readonly bodyVersion?: string
  /** Raw source rows that belonged to this chapter; restore never replays them. */
  readonly derived: Readonly<Record<string, unknown>>
}

export interface ChapterDeletionOperation {
  readonly version: 1
  readonly id: string
  readonly workId: string
  readonly status: ChapterDeletionStatus
  readonly chapters: readonly ChapterDeletionSnapshot[]
  readonly cascadeCards: readonly { readonly id: string; readonly status: 'kept' | 'archived' }[]
  readonly reviewCards: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly sessionId?: string
  readonly askUserSeq?: number
  readonly size: number
  readonly cleanupError?: string
  readonly finished: Readonly<Record<number, 'restored' | 'purged'>>
}

/** The non-content tombstone that keeps a deleted generation distinct from a later chapter with the same number. */
export function chapterTombstone(chapter: ChapterRecord, deletionId: string, now: string): ChapterRecord {
  return {
    id: chapterIdentity(chapter), n: chapter.n, seq: chapter.seq, title: '已删除章节', file: chapter.file,
    phase: 'planning', sessionIds: [], createdAt: chapter.createdAt, updatedAt: now, deletedAt: now, deletionId,
  }
}

/** Filter a timeline after chapters are tombstoned. Shared events survive without the deleted contribution. */
export function timelineWithoutChapters(doc: TimelineDoc, deleted: ReadonlySet<number>): TimelineDoc {
  if (deleted.size === 0) return doc
  const events = doc.events.flatMap((event): StoryEvent[] => {
    const chapters = event.chapters?.filter(n => !deleted.has(n))
    const touched = event.touched?.filter(n => !deleted.has(n))
    const pre = event.pre?.map(row => row.met !== undefined && deleted.has(row.met) ? { text: row.text } : row)
    const stable = { ...event, ...(chapters === undefined ? {} : { chapters }), ...(touched === undefined ? {} : { touched }), ...(pre === undefined ? {} : { pre }) }
    if ((event.status === 'happened' || event.status === 'failed') && event.chapters !== undefined && (chapters?.length ?? 0) === 0) {
      if (event.source === undefined) return []
      const { evidence: _evidence, ...rest } = stable
      return [{ ...rest, status: 'preset' }]
    }
    if (event.chapters?.some(n => deleted.has(n)) === true) {
      const { evidence: _evidence, ...rest } = stable
      return [rest]
    }
    return [stable]
  }).map(event => normalizeEvent(event)!).filter(Boolean)
  if (doc.pins !== undefined && deleted.has(doc.pins.chapter)) {
    const { pins: _pins, ...rest } = { ...doc, events }
    return rest
  }
  return { ...doc, events }
}

/** Ideas belong to the person; only their written-in marker is chapter-owned. */
export function ideasWithoutChapters(doc: IdeasDoc, deleted: ReadonlySet<number>): IdeasDoc {
  return {
    ...doc,
    ideas: doc.ideas.map(idea => {
      if (idea.writtenIn === undefined || !deleted.has(idea.writtenIn)) return idea
      const { writtenIn: _writtenIn, ...rest } = idea
      return rest
    }),
  }
}

/** Pending review snapshots are rebuilt by reconciliation and never outlive their chapter. */
export function pendingWithoutChapters(doc: PendingTable, deleted: ReadonlySet<number>): PendingTable {
  return { ...doc, items: doc.items.filter(item => item.chapter === undefined || !deleted.has(item.chapter)) }
}

/** Feedback and its batches are chapter-scoped; global ideas are handled separately. */
export function feedbackWithoutChapters(doc: ChapterFeedbackDoc, deleted: ReadonlySet<number>): ChapterFeedbackDoc {
  return {
    ...doc,
    ideas: doc.ideas.filter(idea => !deleted.has(idea.chapter)),
    batches: doc.batches.filter(batch => !deleted.has(batch.chapter)),
  }
}

/** Whether one JSONL record is chapter-owned rather than a manual correction made while that chapter was current. */
export function journalRecordIsChapterOwned(file: string, record: object, deleted: ReadonlySet<number>): boolean {
  const row = record as Record<string, unknown>
  const chapter = row['chapter']
  if (typeof chapter !== 'number' || !deleted.has(chapter)) return false
  if (file === 'minds.jsonl' && row['origin'] === 'manual') return false
  if (file === 'history.jsonl' && row['source'] === 'user') return false
  if (file === 'relations.jsonl' && row['event'] === 'set') return false
  return true
}

/** A compact operation read: only current snapshots and audit fields survive restoration and purging. */
export function normalizeDeletionOperation(raw: unknown): ChapterDeletionOperation | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const id = cleanText(row['id'], 100)
  const workId = normalizeWorkId(row['workId'])
  const status = cleanText(row['status'], 30) as ChapterDeletionOperation['status'] | undefined
  if (id === undefined || workId === undefined || !['preview', 'active', 'cleanup-pending', 'closed'].includes(status ?? '')) return undefined
  const chapters = (Array.isArray(row['chapters']) ? row['chapters'] : []).flatMap((value): ChapterDeletionSnapshot[] => {
    if (typeof value !== 'object' || value === null) return []
    const item = value as Record<string, unknown>
    const record = normalizeChapter(item['record'])
    if (record === undefined || typeof item['body'] !== 'string' || typeof item['derived'] !== 'object' || item['derived'] === null) return []
    return [{
      record, body: item['body'], derived: item['derived'] as Record<string, unknown>,
      ...(typeof item['bodyVersion'] === 'string' ? { bodyVersion: item['bodyVersion'] } : {}),
    }]
  })
  const cascadeCards = (Array.isArray(row['cascadeCards']) ? row['cascadeCards'] : []).flatMap((value): { id: string; status: 'kept' | 'archived' }[] => {
    if (typeof value !== 'object' || value === null) return []
    const item = value as Record<string, unknown>
    const cardId = cleanText(item['id'], 80)
    return cardId === undefined ? [] : [{ id: cardId, status: item['status'] === 'archived' ? 'archived' : 'kept' }]
  })
  const finished: Record<number, 'restored' | 'purged'> = {}
  if (typeof row['finished'] === 'object' && row['finished'] !== null) {
    for (const [n, outcome] of Object.entries(row['finished'] as Record<string, unknown>)) {
      if ((outcome === 'restored' || outcome === 'purged') && /^\d+$/.test(n)) finished[Number(n)] = outcome
    }
  }
  const askUserSeq = cleanNumber(row['askUserSeq'])
  const cleanupError = cleanText(row['cleanupError'], 500)
  return {
    version: 1, id, workId, status: status!, chapters, cascadeCards,
    reviewCards: (Array.isArray(row['reviewCards']) ? row['reviewCards'] : []).map(value => cleanText(value, 80)).filter((value): value is string => value !== undefined),
    createdAt: cleanText(row['createdAt'], 40) ?? '', updatedAt: cleanText(row['updatedAt'], 40) ?? '',
    ...(typeof row['sessionId'] === 'string' ? { sessionId: row['sessionId'] } : {}),
    ...(askUserSeq === undefined ? {} : { askUserSeq }),
    size: cleanNumber(row['size']) ?? 0,
    ...(cleanupError === undefined ? {} : { cleanupError }),
    finished,
  }
}

/** Approximate exact retained size: the serialized operation document, including the trailing newline. */
export function deletionOperationSize(operation: ChapterDeletionOperation): number {
  return new TextEncoder().encode(`${JSON.stringify(operation, null, 2)}\n`).byteLength
}

/** A restored chapter is a new generation with no reconciliation output from the deleted one. */
export function restoredChapterRecord(snapshot: ChapterDeletionSnapshot, n: number, sessionId: string | undefined, now: string): ChapterRecord {
  const source = snapshot.record
  return {
    id: `ch_${crypto.randomUUID()}`, n, seq: source.seq, title: source.title, file: `第${n}章.md`, phase: 'planning',
    ...(source.volume === undefined ? {} : { volume: source.volume }),
    ...(source.plan === undefined ? {} : { plan: source.plan }),
    ...(source.planConfirmedAt === undefined ? {} : { planConfirmedAt: source.planConfirmedAt }),
    ...(source.planAsk === undefined ? {} : { planAsk: source.planAsk }),
    ...(source.byUser === true ? { byUser: true as const } : {}),
    sessionIds: sessionId === undefined ? [] : [sessionId], createdAt: source.createdAt, updatedAt: now,
  }
}

/** The preview's chapter-scoped counts, grouped for the confirm surface and tool answer. */
export function deletionCounts(operation: ChapterDeletionOperation): ChapterDeletionCounts {
  const count = (file: string): number => operation.chapters.reduce((sum, row) => {
    const value = row.derived[file]
    return sum + (Array.isArray(value) ? value.length : 0)
  }, 0)
  return {
    bodies: operation.chapters.filter(row => row.body.trim() !== '').length,
    plans: operation.chapters.filter(row => row.record.plan !== undefined).length,
    words: operation.chapters.reduce((sum, row) => sum + (row.record.wordCount ?? row.body.replace(/\s+/g, '').length), 0),
    mentions: count('mentions.jsonl'), experiences: count('experiences.jsonl'), relations: count('relations.jsonl'),
    history: count('history.jsonl'), minds: count('minds.jsonl'), pending: count('pending.json'),
    feedback: count('chapter-feedback.json'),
  }
}

/** Chapter numbers represented by an operation; useful to check that a preview still targets the same generation. */
export function deletionChapterIds(operation: ChapterDeletionOperation): string[] {
  return operation.chapters.map(row => chapterIdentity(row.record))
}

/** A chapter's raw derived value for one file, or an empty list when that file has no rows. */
export function derivedRows(snapshot: ChapterDeletionSnapshot, file: string): readonly unknown[] {
  const value = snapshot.derived[file]
  return Array.isArray(value) ? value : []
}

/** Convenience for the read side after a partial restore or purge. */
export function deletedChapterNumbers(all: readonly ChapterRecord[]): Set<number> {
  const active = new Set(all.filter(row => row.deletedAt === undefined).map(row => row.n))
  return new Set(all.filter(row => row.deletedAt !== undefined && !active.has(row.n)).map(row => row.n))
}

/** A restore/purge result's updated operation, with per-chapter content removed before the audit is kept. */
export function finishDeletionChapters(operation: ChapterDeletionOperation, targets: ReadonlySet<number>, outcome: 'restored' | 'purged', now: string): ChapterDeletionOperation {
  const chapters = operation.chapters.filter(row => !targets.has(row.record.n))
  const finished = { ...operation.finished }
  for (const n of targets) finished[n] = outcome
  return {
    ...operation, chapters, finished, updatedAt: now,
    status: chapters.length === 0 ? 'closed' : operation.status === 'preview' ? 'active' : operation.status,
    cascadeCards: operation.cascadeCards,
    size: 0,
  }
}
