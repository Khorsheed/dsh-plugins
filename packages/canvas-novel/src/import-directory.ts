import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  compareNovelFileNames, novelImportExtension, NOVEL_DOCUMENT_EXTENSIONS, type NovelImportIssue,
} from './import-core.ts'
import type { NovelDirectoryFile, NovelDirectoryImportResult } from './types.ts'

const MAX_DEPTH = 32
const MAX_FILES = 500
const MAX_VISITED = 5000
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const SKIP_DIRECTORIES = new Set(['node_modules', '__MACOSX'])

interface Candidate {
  readonly absolute: string
  readonly relative: string
}

/** Use the host's native chooser, or a directory confirmed through its browse picker. */
export async function pickNovelImportDirectory(ctx: Context, selection?: string): Promise<NovelDirectoryImportResult> {
  const picker = ctx.get('directoryPicker') as {
    capability?: () => {
      readonly kind: string
      readonly pick?: (signal: AbortSignal) => Promise<string | null>
      readonly list?: (path: string, signal?: AbortSignal) => Promise<{ readonly path: string }>
    }
  } | undefined
  const capability = picker?.capability?.()
  if (capability?.kind === 'browse') {
    if (capability.list === undefined) return directoryFailure('unsupported')
    if (selection === undefined) return directoryFailure('browse')
    try {
      const listing = await capability.list(selection, new AbortController().signal)
      return await readNovelImportDirectory(listing.path)
    } catch {
      return directoryFailure('unreadable')
    }
  }
  if (capability?.kind !== 'native' || capability.pick === undefined || selection !== undefined) return directoryFailure('unsupported')
  try {
    const selected = await capability.pick(new AbortController().signal)
    return selected === null ? directoryFailure('cancelled') : await readNovelImportDirectory(selected)
  } catch {
    return directoryFailure('unreadable')
  }
}

/** Read one picker-confirmed directory. */
export async function readNovelImportDirectory(root: string): Promise<NovelDirectoryImportResult> {
  let canonical: string
  try {
    canonical = await realpath(root)
    if (!(await stat(canonical)).isDirectory()) return directoryFailure('unreadable')
  } catch {
    return directoryFailure('unreadable')
  }
  const candidates: Candidate[] = []
  const issues: NovelImportIssue[] = []
  let skipped = 0
  let truncated = false
  let visited = 0
  let totalBytes = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= MAX_VISITED) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      issues.push({ file: displayPath(canonical, directory), reason: 'read-failed' })
      return
    }
    entries.sort((a, b) => compareNovelFileNames(a.name, b.name))
    for (const entry of entries) {
      if (visited >= MAX_VISITED) {
        truncated = true
        return
      }
      visited += 1
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
        skipped += 1
        continue
      }
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          skipped += 1
          continue
        }
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const extension = novelImportExtension(entry.name)
      if (extension === '.doc' || extension === '.docx') {
        issues.push({ file: displayPath(canonical, absolute), reason: 'legacy-doc' })
        continue
      }
      if (!NOVEL_DOCUMENT_EXTENSIONS.includes(extension ?? '')) {
        skipped += 1
        continue
      }
      if (candidates.length >= MAX_FILES) {
        truncated = true
        continue
      }
      try {
        const info = await stat(absolute)
        if (totalBytes + info.size > MAX_TOTAL_BYTES) {
          truncated = true
          continue
        }
        totalBytes += info.size
        candidates.push({ absolute, relative: displayPath(canonical, absolute) })
      } catch {
        issues.push({ file: displayPath(canonical, absolute), reason: 'read-failed' })
      }
    }
  }
  await walk(canonical, 0)
  candidates.sort((a, b) => compareNovelFileNames(a.relative, b.relative))

  const files: NovelDirectoryFile[] = []
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate.absolute)
      if (!inside(canonical, resolved)) {
        skipped += 1
        continue
      }
      files.push({ file: candidate.relative, titleBase: basename(candidate.relative), data: await readFile(resolved) })
    } catch {
      issues.push({ file: candidate.relative, reason: 'read-failed' })
    }
  }
  return {
    ok: true,
    rootName: basename(canonical) || canonical,
    files,
    issues,
    skipped,
    truncated,
  }
}

function directoryFailure(error: 'browse' | 'cancelled' | 'unsupported' | 'unreadable'): NovelDirectoryImportResult {
  return { ok: false, error, files: [], issues: [], skipped: 0, truncated: false }
}

function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/') || basename(root)
}

function inside(root: string, path: string): boolean {
  return path.startsWith(`${root}${sep}`)
}
