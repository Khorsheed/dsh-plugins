/**
 * File helpers the game service builds on: atomic writes, tolerant reads, the
 * bounded project walk, and the sandbox bundle form of walked files.
 * @module @khorsheed/dsh-game
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isTextFile, mimeOf } from './project.ts'
import type { BundleFile } from './types.ts'

/** Walk limits for one project read: enough for a small game, bounded for a stray huge folder. */
const MAX_FILES = 600
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 48 * 1024 * 1024

/** Whether `child` is `parent` or inside it. */
export function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Write a file atomically (tmp + rename), creating its directory. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Read a text file, undefined when absent or unreadable. */
export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Read JSON, undefined when absent or broken. */
export async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** One walked file: project-relative POSIX path plus its bytes. */
export interface WalkedFile {
  readonly path: string
  readonly data: Buffer
}

/**
 * Walk a directory (dot-entries skipped), bounded by the walk limits.
 * @param root - directory to walk.
 * @param keep - project-relative path filter.
 * @returns the files, sorted by path.
 */
export async function walk(root: string, keep: (path: string) => boolean): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  let total = 0
  const visit = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      const rel = relative(root, full).split(sep).join('/')
      if (entry.isDirectory()) {
        await visit(full)
        continue
      }
      if (!entry.isFile() || !keep(rel)) continue
      const info = await stat(full).catch(() => undefined)
      if (info === undefined || info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) continue
      total += info.size
      out.push({ path: rel, data: await readFile(full) })
    }
  }
  await visit(root)
  return out
}

/** The sandbox bundle form of walked files. */
export function bundleOf(files: readonly WalkedFile[]): Record<string, BundleFile> {
  const out: Record<string, BundleFile> = {}
  for (const f of files) {
    out[f.path] = isTextFile(f.path)
      ? { type: mimeOf(f.path), text: f.data.toString('utf8') }
      : { type: mimeOf(f.path), b64: f.data.toString('base64') }
  }
  return out
}

/** A content fingerprint over (path, bytes) pairs. */
export function fingerprintOf(files: readonly WalkedFile[]): string {
  const hash = createHash('sha1')
  for (const f of files) {
    hash.update(f.path)
    hash.update('\0')
    hash.update(createHash('sha1').update(f.data).digest())
  }
  return hash.digest('hex').slice(0, 16)
}
