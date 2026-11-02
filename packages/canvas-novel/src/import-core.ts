export const MAX_IMPORT_CHAPTER_CHARS = 2_000_000
export const NOVEL_DOCUMENT_EXTENSIONS: readonly string[] = ['.docx', '.txt', '.md', '.markdown']

export type NovelImportIssueReason = 'legacy-doc' | 'unsupported' | 'read-failed' | 'docx-invalid' | 'encoding' | 'empty' | 'empty-chapter' | 'too-long'

export interface NovelImportIssue {
  readonly file: string
  readonly reason: NovelImportIssueReason
  readonly title?: string
}

export interface NovelImportDraft {
  readonly id: string
  readonly file: string
  readonly title: string
  readonly text: string
  readonly chars: number
  readonly noHeadings?: true
}

export interface NovelImportParseResult {
  readonly drafts: readonly NovelImportDraft[]
  readonly issues: readonly NovelImportIssue[]
}

export interface NovelImportDocument {
  readonly file: string
  readonly titleBase?: string
  readonly text: string
}

interface Heading {
  readonly line: number
  readonly title: string
}

/** Compare paths with numeric runs and Chinese chapter numbers in story order. */
export function compareNovelFileNames(a: string, b: string): number {
  const chapterA = chapterNumber(a)
  const chapterB = chapterNumber(b)
  if (chapterA !== undefined && chapterB !== undefined && chapterA !== chapterB) return chapterA - chapterB
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function chapterNumber(path: string): number | undefined {
  const match = /第([0-9０-９一二三四五六七八九十百千万零〇两]+)[章节回]/.exec(path)
  if (match === null) return undefined
  const token = match[1]!
  if (/^[0-9０-９]+$/.test(token)) return Number(token.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10)))
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let section = 0
  let number = 0
  for (const char of token) {
    if (char === '万') {
      total += (section + number || 1) * 10000
      section = 0
      number = 0
    } else if (units[char] !== undefined) {
      section += (number || 1) * units[char]!
      number = 0
    } else {
      number = digits[char] ?? 0
    }
  }
  return total + section + number
}

/** The lowercase final extension of a document name. */
export function novelImportExtension(fileName: string): string | undefined {
  return fileName.toLowerCase().match(/\.[^.]+$/)?.[0]
}

/** Split and validate decoded documents in predictable path order. */
export function parseNovelDocuments(documents: readonly NovelImportDocument[]): NovelImportParseResult {
  const sorted = [...documents].sort((a, b) => compareNovelFileNames(a.file, b.file))
  const drafts: NovelImportDraft[] = []
  const issues: NovelImportIssue[] = []
  for (const [fileIndex, document] of sorted.entries()) {
    const split = splitNovelDocument(document.file, document.text, document.titleBase)
    issues.push(...split.issues)
    for (const [chapterIndex, chapter] of split.chapters.entries()) {
      if (chapter.text.length > MAX_IMPORT_CHAPTER_CHARS) {
        issues.push({ file: document.file, reason: 'too-long', title: chapter.title })
        continue
      }
      drafts.push({
        id: `${fileIndex}:${chapterIndex}:${document.file}`,
        file: document.file,
        title: chapter.title,
        text: chapter.text,
        chars: chapter.text.replace(/\s+/g, '').length,
        ...(split.noHeadings ? { noHeadings: true as const } : {}),
      })
    }
  }
  return { drafts, issues }
}

/** Split one already-decoded document without altering chapter prose. */
export function splitNovelDocument(fileName: string, source: string, titleBase?: string): {
  readonly chapters: readonly { readonly title: string; readonly text: string }[]
  readonly issues: readonly NovelImportIssue[]
  readonly noHeadings: boolean
} {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const numbered = headingsOf(lines, false)
  const headings = numbered.length > 0 ? numbered : headingsOf(lines, true)
  const fallbackSource = titleBase ?? fileName
  const fallback = fallbackSource.replace(/\.[^.]+$/, '').trim() || fallbackSource
  if (headings.length === 0) {
    const body = text.trim()
    return body === ''
      ? { chapters: [], issues: [{ file: fileName, reason: 'empty' }], noHeadings: true }
      : { chapters: [{ title: fallback.slice(0, 200), text: body }], issues: [], noHeadings: true }
  }
  const chapters: { title: string; text: string }[] = []
  const issues: NovelImportIssue[] = []
  const preamble = lines.slice(0, headings[0]!.line).join('\n').trim()
  for (const [index, heading] of headings.entries()) {
    const end = headings[index + 1]?.line ?? lines.length
    const own = lines.slice(heading.line + 1, end).join('\n').trim()
    const body = `${index === 0 && preamble !== '' ? `${preamble}\n` : ''}${own}`.trim()
    if (body === '') {
      issues.push({ file: fileName, reason: 'empty-chapter', title: heading.title })
      continue
    }
    chapters.push({ title: heading.title, text: body })
  }
  if (chapters.length === 0 && issues.length === 0) issues.push({ file: fileName, reason: 'empty' })
  return { chapters, issues, noHeadings: false }
}

/** A byte sequence neither UTF-8 nor GB18030 can decode. */
export class NovelTextDecodeError extends Error {}

/** Decode a plain-text document, accepting legacy Chinese text files. */
export function decodeNovelText(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes)
    } catch {
      throw new NovelTextDecodeError()
    }
  }
}

function headingsOf(lines: readonly string[], markdownOnly: boolean): Heading[] {
  const headings: Heading[] = []
  for (const [line, raw] of lines.entries()) {
    const markdown = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    const plain = markdown === null ? raw.trim() : markdown[2]!.trim()
    if (plain === '' || plain.length > 160) continue
    const numbered = chapterTitle(plain)
    if (numbered !== undefined && (!markdownOnly || markdown !== null)) {
      headings.push({ line, title: plain })
    } else if (markdownOnly && markdown?.[1] === '#') {
      headings.push({ line, title: plain })
    }
  }
  return headings
}

function chapterTitle(line: string): string | undefined {
  const number = '[0-9０-９一二三四五六七八九十百千万零〇两]+'
  const chinese = new RegExp(`^第\\s*${number}\\s*[章节回](?:\\s|$|[：:、.．·—–-])?.*$`)
  const english = /^(?:chapter)\s+(?:[0-9]+|[ivxlcdm]+)(?:\s|$|[:：.．—–-]).*$/i
  const special = /^(?:(?:序章|序言|楔子|尾声|后记)(?:\s|$|[：:、.．·—–-])|番外[0-9０-９一二三四五六七八九十百千万零〇两]*(?:\s|$|[：:、.．·—–-])).*$/
  return chinese.test(line) || english.test(line) || special.test(line) ? line : undefined
}
