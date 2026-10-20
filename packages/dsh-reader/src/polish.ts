/**
 * The 润色 layer: an agent's paragraph-by-paragraph translation of an
 * article, written back through `reader_translate` and shown in place of the
 * browser's sentence-by-sentence machine translation.
 *
 * Keyed to the article's text as the model read it (the snapshot): a
 * re-transcription changes the text and so drops the layer; renaming a
 * speaker only changes the "[mm:ss] 名字：" prefixes and keeps it.
 *
 * One JSON file per article under `<state>/polish/`, memory-only when the
 * state root cannot be written.
 *
 * @module @khorsheed/dsh-reader/polish
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReaderPolishView } from './types.ts'

interface PolishFile {
  readonly entryId: string
  /** What text the translations belong to (see {@link sourceKey}). */
  readonly sourceKey: string
  readonly total: number
  /** ¶ number (1-based) → the agent's translation. */
  readonly paragraphs: Record<string, string>
  /** Paragraphs the reader turned back to the machine translation. */
  readonly off: number[]
  readonly updatedAt: string
}

/** The time / speaker prefix of a transcript paragraph in the snapshot. */
const PREFIX = /^\[\d+(?::\d+){1,2}\]\s*(?:[^：\n]{1,40}：)?/

/**
 * What a layer belongs to: the paragraphs' text without their time and
 * speaker prefixes, hashed.
 */
export function sourceKey(paragraphs: readonly string[]): string {
  const hash = createHash('sha1')
  hash.update(String(paragraphs.length))
  for (const paragraph of paragraphs) hash.update(`\n${paragraph.replace(PREFIX, '')}`)
  return hash.digest('hex').slice(0, 24)
}

/**
 * Parse the model's write-back: lines `¶12：译文…` (a line without a ¶
 * continues the paragraph before it).
 *
 * @param text - what the model sent.
 */
export function parsePolish(text: string): Map<number, string> {
  const out = new Map<number, string>()
  let current: number | undefined
  for (const line of text.split(/\r?\n/)) {
    const head = /^\s*¶\s*(\d+)\s*[：:]\s*(.*)$/.exec(line)
    if (head !== null) {
      current = Number(head[1])
      out.set(current, head[2]!.trim())
    } else if (current !== undefined && line.trim() !== '') {
      out.set(current, `${out.get(current) ?? ''}${line.trim()}`)
    }
  }
  for (const [key, value] of out) if (value === '') out.delete(key)
  return out
}

/** The per-article 润色 layers. */
export class ReaderPolishStore {
  private readonly dir: string
  private readonly memory = new Map<string, PolishFile>()

  constructor(stateRoot: string) {
    this.dir = join(stateRoot, 'polish')
  }

  private fileOf(entryId: string): string {
    return join(this.dir, `${createHash('sha1').update(entryId).digest('hex').slice(0, 32)}.json`)
  }

  private load(entryId: string): PolishFile | undefined {
    const cached = this.memory.get(entryId)
    if (cached !== undefined) return cached
    try {
      const parsed = JSON.parse(readFileSync(this.fileOf(entryId), 'utf8')) as PolishFile
      if (parsed.entryId !== entryId) return undefined
      this.memory.set(entryId, parsed)
      return parsed
    } catch {
      return undefined
    }
  }

  private save(file: PolishFile): void {
    this.memory.set(file.entryId, file)
    try {
      mkdirSync(this.dir, { recursive: true })
      const target = this.fileOf(file.entryId)
      writeFileSync(`${target}.tmp`, JSON.stringify(file))
      renameSync(`${target}.tmp`, target)
    } catch {
      // Memory-only: the layer lasts this process.
    }
  }

  /**
   * An article's layer, when it belongs to the text now captured.
   *
   * @param entryId - the article.
   * @param key - the current text's {@link sourceKey}.
   */
  view(entryId: string, key: string | undefined): ReaderPolishView | undefined {
    const file = this.load(entryId)
    if (file === undefined || key === undefined || file.sourceKey !== key) return undefined
    const done = Object.keys(file.paragraphs).length
    return { total: file.total, done, paragraphs: { ...file.paragraphs }, off: [...file.off], updatedAt: file.updatedAt, complete: done >= file.total }
  }

  /**
   * Merge the model's translations into the layer (a different text starts a
   * fresh one).
   *
   * @returns the layer after the write.
   */
  write(entryId: string, key: string, total: number, updates: ReadonlyMap<number, string>): ReaderPolishView {
    const before = this.load(entryId)
    const fresh = before === undefined || before.sourceKey !== key
    const paragraphs: Record<string, string> = fresh ? {} : { ...before.paragraphs }
    for (const [index, value] of updates) if (index >= 1 && index <= total) paragraphs[String(index)] = value
    const file: PolishFile = { entryId, sourceKey: key, total, paragraphs, off: fresh ? [] : before.off, updatedAt: new Date().toISOString() }
    this.save(file)
    return this.view(entryId, key)!
  }

  /** Turn one paragraph back to (or away from) the machine translation. */
  setOff(entryId: string, key: string | undefined, paragraph: number, off: boolean): ReaderPolishView | undefined {
    const file = this.load(entryId)
    if (file === undefined || key === undefined || file.sourceKey !== key) return undefined
    const rest = file.off.filter(item => item !== paragraph)
    this.save({ ...file, off: off ? [...rest, paragraph] : rest })
    return this.view(entryId, key)
  }

  /** Forget an article's layer. */
  drop(entryId: string): void {
    this.memory.delete(entryId)
    rmSync(this.fileOf(entryId), { force: true })
  }
}
