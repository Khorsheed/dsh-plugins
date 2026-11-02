import { extractRawText } from 'mammoth'
import {
  compareNovelFileNames, decodeNovelText, novelImportExtension, NovelTextDecodeError, NOVEL_DOCUMENT_EXTENSIONS,
  parseNovelDocuments, type NovelImportDocument, type NovelImportIssue, type NovelImportParseResult,
} from '../import-core.ts'

export { MAX_IMPORT_CHAPTER_CHARS, splitNovelDocument } from '../import-core.ts'
export type { NovelImportDraft, NovelImportIssue, NovelImportIssueReason, NovelImportParseResult } from '../import-core.ts'

export interface NovelBinaryDocument {
  readonly file: string
  readonly titleBase?: string
  readonly data: ArrayBuffer | Uint8Array | (() => Promise<ArrayBuffer | Uint8Array>)
}

/** Parse browser File objects. */
export async function parseNovelFiles(files: readonly File[]): Promise<NovelImportParseResult> {
  return parseNovelBinaryDocuments(files.map(file => ({ file: file.name, data: () => file.arrayBuffer() })))
}

/** Parse bytes read by either the browser or the chooser-authorized host directory call. */
export async function parseNovelBinaryDocuments(input: readonly NovelBinaryDocument[]): Promise<NovelImportParseResult> {
  const sorted = [...input].sort((a, b) => compareNovelFileNames(a.file, b.file))
  const documents: NovelImportDocument[] = []
  const issues: NovelImportIssue[] = []
  for (const document of sorted) {
    const extension = novelImportExtension(document.file)
    if (extension === '.doc') {
      issues.push({ file: document.file, reason: 'legacy-doc' })
      continue
    }
    if (!NOVEL_DOCUMENT_EXTENSIONS.includes(extension ?? '')) {
      issues.push({ file: document.file, reason: 'unsupported' })
      continue
    }
    try {
      const bytes = typeof document.data === 'function' ? await document.data() : document.data
      const text = extension === '.docx' ? await readDocx(bytes) : decodeNovelText(bytes)
      documents.push({ file: document.file, ...(document.titleBase === undefined ? {} : { titleBase: document.titleBase }), text })
    } catch (error) {
      issues.push({ file: document.file, reason: extension === '.docx' ? 'docx-invalid' : error instanceof NovelTextDecodeError ? 'encoding' : 'read-failed' })
    }
  }
  const parsed = parseNovelDocuments(documents)
  return { drafts: parsed.drafts, issues: [...issues, ...parsed.issues] }
}

async function readDocx(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const arrayBuffer = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : bytes
  // Mammoth's browser and Node entry points read different keys of the same ZIP bytes.
  const result = await extractRawText({ arrayBuffer, buffer: arrayBuffer as never })
  return result.value
}
