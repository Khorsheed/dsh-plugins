export const MAX_FEEDBACK_TEXT = 4000
export const MAX_FEEDBACK_QUOTE = 20_000

export type ChapterFeedbackStatus = 'drafted' | 'sent' | 'written' | 'archived'
export type ChapterFeedbackNotice = 'no-write' | 'interrupted' | 'stale'

export interface ChapterFeedbackIdea {
  readonly id: string
  readonly chapter: number
  readonly quote?: string
  readonly start?: number
  readonly end?: number
  readonly before?: string
  readonly after?: string
  readonly baseBodyHash: string
  readonly text: string
  readonly createdAt: string
}

export interface ChapterFeedbackWrite {
  readonly turn: number
  readonly at: string
  readonly bodyHash: string
  readonly words: number
}

export interface ChapterFeedbackBatch {
  readonly id: string
  readonly sessionId: string
  readonly canvasId: string
  readonly chapter: number
  readonly chapterTitle: string
  readonly ideas: readonly ChapterFeedbackIdea[]
  readonly baseBodyHash: string
  readonly status: ChapterFeedbackStatus
  readonly createdAt: string
  readonly turn?: number
  readonly submittedText?: string
  readonly submittedAt?: string
  readonly write?: ChapterFeedbackWrite
  readonly completedAt?: string
  readonly notice?: ChapterFeedbackNotice
}

export interface ChapterFeedbackDoc {
  readonly version: 1
  readonly ideas: readonly ChapterFeedbackIdea[]
  readonly batches: readonly ChapterFeedbackBatch[]
  readonly nextIdea: number
  readonly nextBatch: number
}

export interface ChapterFeedbackResult {
  readonly ok: boolean
  readonly error?: string
  readonly ideas: readonly ChapterFeedbackIdea[]
  readonly batches: readonly ChapterFeedbackBatch[]
}

export interface ChapterFeedbackPrepareResult {
  readonly ok: boolean
  readonly error?: string
  readonly batchId?: string
  readonly text?: string
}

export interface ChapterFeedbackAddRequest {
  readonly canvasId: string
  readonly n: number
  readonly text: string
  readonly quote?: string
  readonly start?: number
  readonly end?: number
  readonly before?: string
  readonly after?: string
  readonly baseBodyHash: string
}

export interface ChapterFeedbackDeleteRequest {
  readonly canvasId: string
  readonly n: number
  readonly id: string
}

export interface ChapterFeedbackRestoreRequest {
  readonly canvasId: string
  readonly idea: ChapterFeedbackIdea
}

export interface ChapterFeedbackBatchRequest {
  readonly canvasId: string
  readonly n: number
  readonly batchId: string
}

export interface ChapterFeedbackCandidateRequest {
  readonly canvasId: string
  readonly batchId: string
  readonly text: string
}

export interface ChapterFeedbackMutationResult {
  readonly ok: boolean
  readonly error?: string
  readonly idea?: ChapterFeedbackIdea
}

export function emptyChapterFeedback(): ChapterFeedbackDoc {
  return { version: 1, ideas: [], batches: [], nextIdea: 1, nextBatch: 1 }
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, limit) : undefined
}

function id(value: unknown): string | undefined {
  return text(value, 100)
}

function chapter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function offset(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeIdea(raw: unknown): ChapterFeedbackIdea | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const ideaId = id(row['id'])
  const n = chapter(row['chapter'])
  const body = text(row['text'], MAX_FEEDBACK_TEXT)
  if (ideaId === undefined || n === undefined || body === undefined) return undefined
  const quote = text(row['quote'], MAX_FEEDBACK_QUOTE)
  const start = offset(row['start'])
  const end = offset(row['end'])
  const before = text(row['before'], 120)
  const after = text(row['after'], 120)
  return {
    id: ideaId,
    chapter: n,
    ...(quote === undefined ? {} : { quote }),
    ...(start !== undefined && end !== undefined && end > start ? { start, end } : {}),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    baseBodyHash: typeof row['baseBodyHash'] === 'string' ? row['baseBodyHash'].slice(0, 80) : '',
    text: body,
    createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
  }
}

function normalizeBatch(raw: unknown): ChapterFeedbackBatch | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const batchId = id(row['id'])
  const sessionId = id(row['sessionId'])
  const canvasId = id(row['canvasId'])
  const n = chapter(row['chapter'])
  const ideas = (Array.isArray(row['ideas']) ? row['ideas'] : []).map(normalizeIdea).filter((idea): idea is ChapterFeedbackIdea => idea !== undefined)
  if (batchId === undefined || sessionId === undefined || canvasId === undefined || n === undefined || ideas.length === 0) return undefined
  const status = row['status'] === 'sent' || row['status'] === 'written' || row['status'] === 'archived' ? row['status'] : 'drafted'
  const turn = chapter(row['turn'])
  const writeRaw = row['write']
  let write: ChapterFeedbackWrite | undefined
  if (typeof writeRaw === 'object' && writeRaw !== null) {
    const value = writeRaw as Record<string, unknown>
    const writeTurn = chapter(value['turn'])
    if (writeTurn !== undefined && typeof value['bodyHash'] === 'string') {
      write = { turn: writeTurn, at: typeof value['at'] === 'string' ? value['at'] : '', bodyHash: value['bodyHash'].slice(0, 80), words: offset(value['words']) ?? 0 }
    }
  }
  const notice = row['notice'] === 'no-write' || row['notice'] === 'interrupted' || row['notice'] === 'stale' ? row['notice'] : undefined
  const submittedText = text(row['submittedText'], 100_000)
  return {
    id: batchId,
    sessionId,
    canvasId,
    chapter: n,
    chapterTitle: text(row['chapterTitle'], 200) ?? `第 ${n} 章`,
    ideas,
    baseBodyHash: typeof row['baseBodyHash'] === 'string' ? row['baseBodyHash'].slice(0, 80) : '',
    status,
    createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
    ...(turn === undefined ? {} : { turn }),
    ...(submittedText === undefined ? {} : { submittedText }),
    ...(typeof row['submittedAt'] === 'string' ? { submittedAt: row['submittedAt'] } : {}),
    ...(write === undefined ? {} : { write }),
    ...(typeof row['completedAt'] === 'string' ? { completedAt: row['completedAt'] } : {}),
    ...(notice === undefined ? {} : { notice }),
  }
}

export function normalizeChapterFeedback(raw: unknown): ChapterFeedbackDoc | undefined {
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>)['version'] !== 1) return undefined
  const row = raw as Record<string, unknown>
  const ideas = (Array.isArray(row['ideas']) ? row['ideas'] : []).map(normalizeIdea).filter((idea): idea is ChapterFeedbackIdea => idea !== undefined)
  const batches = (Array.isArray(row['batches']) ? row['batches'] : []).map(normalizeBatch).filter((batch): batch is ChapterFeedbackBatch => batch !== undefined)
  return {
    version: 1,
    ideas,
    batches,
    nextIdea: chapter(row['nextIdea']) ?? ideas.length + 1,
    nextBatch: chapter(row['nextBatch']) ?? batches.length + 1,
  }
}

export function activeChapterFeedback(doc: ChapterFeedbackDoc, n: number): ChapterFeedbackIdea[] {
  const batched = new Set(doc.batches.flatMap(batch => batch.ideas.map(idea => idea.id)))
  return doc.ideas.filter(idea => idea.chapter === n && !batched.has(idea.id))
}

export function chapterFeedbackBatches(doc: ChapterFeedbackDoc, n: number): ChapterFeedbackBatch[] {
  return doc.batches.filter(batch => batch.chapter === n)
}

export function formatChapterFeedbackRequest(workTitle: string, chapterTitle: string, n: number, ideas: readonly ChapterFeedbackIdea[]): string {
  const lines = ideas.map((idea, index) => `${index + 1}. ${idea.quote === undefined ? `第 ${n} 章 · 整章` : `第 ${n} 章 · 第 ${idea.start ?? 0}–${idea.end ?? 0} 字`}${idea.quote === undefined ? '' : `\n   原文：“${idea.quote}”`}\n   想法：${idea.text}`)
  return `请阅读《${workTitle}》第 ${n} 章《${chapterTitle}》，结合整章节奏，看看下面这些想法是否值得采纳并修改。引用只是帮助理解，不要求只修改对应选区：\n\n${lines.join('\n\n')}`
}

export function locateChapterFeedback(idea: ChapterFeedbackIdea, body: string): { readonly start: number; readonly end: number } | undefined {
  if (idea.quote === undefined || idea.quote === '') return undefined
  if (idea.start !== undefined && idea.end !== undefined && body.slice(idea.start, idea.end) === idea.quote) {
    const before = body.slice(Math.max(0, idea.start - 120), idea.start)
    const after = body.slice(idea.end, idea.end + 120)
    const beforeMatches = idea.before === undefined || before.endsWith(idea.before)
    const afterMatches = idea.after === undefined || after.startsWith(idea.after)
    if (beforeMatches && afterMatches) return { start: idea.start, end: idea.end }
  }
  const found: { start: number; end: number; score: number }[] = []
  let at = body.indexOf(idea.quote)
  while (at >= 0) {
    const before = body.slice(Math.max(0, at - 120), at)
    const after = body.slice(at + idea.quote.length, at + idea.quote.length + 120)
    const score = (idea.before !== undefined && before.endsWith(idea.before) ? 1 : 0) + (idea.after !== undefined && after.startsWith(idea.after) ? 1 : 0)
    found.push({ start: at, end: at + idea.quote.length, score })
    at = body.indexOf(idea.quote, at + 1)
  }
  if (found.length === 0) return undefined
  const best = Math.max(...found.map(row => row.score))
  const matches = found.filter(row => row.score === best)
  return matches.length === 1 ? { start: matches[0]!.start, end: matches[0]!.end } : undefined
}

export function chapterFeedbackBlocks(body: string): readonly { readonly start: number; readonly end: number; readonly text: string; readonly heading: boolean }[] {
  const blocks: { start: number; end: number; text: string; heading: boolean }[] = []
  let offset = 0
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    const start = offset + line.indexOf(trimmed)
    if (trimmed !== '') blocks.push({ start, end: start + trimmed.length, text: trimmed, heading: trimmed.startsWith('#') })
    offset += line.length + 1
  }
  return blocks
}
