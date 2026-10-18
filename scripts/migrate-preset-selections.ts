#!/usr/bin/env tsx
/**
 * migrate-preset-selections — one-shot migration for the 2026-10-18 preset-id
 * rename (`dev` → `dsh-dev`, `learning` → `dsh-learning`; see
 * .agents/notes/implemented/feature/2026-10-18-preset-id-dsh-prefix.md).
 *
 * A session's mode choice is an `agent-preset/selected` event in its event
 * log, and the preset registry answers an unknown id with a hard
 * `agent-preset/not-found` — after the rename, sessions still pinned to the
 * bare ids fail to open their agent until the user re-selects a mode. This
 * script rewrites the stored selections in place.
 *
 * Rewrite rule, deliberately string-level (no JSON round-trip): on lines that
 * carry `"type":"agent-preset/selected"`, and on the session header line
 * (`{"type":"session"…` — the projection initializes from the header's
 * creation-time preset, so header-only sessions need it too), replace the
 * exact substrings `"agentPreset":"dev"` → `"agentPreset":"dsh-dev"` and
 * `"agentPreset":"learning"` → `"agentPreset":"dsh-learning"`. Every other
 * byte of the log is preserved, and the rewritten plaintext must equal the
 * original except for those substitutions (checked line by line before
 * anything lands).
 *
 * Container handling follows repair-session-source-op.ts: concatenated-
 * Zstandard frames whose FIRST frame is exactly the header line — frame 0 is
 * copied byte-for-byte and the body re-emitted as ONE frame with the host
 * writer's recipe (zstdCompress with ZSTD_c_checksumFlag=1). Originals are
 * preserved under `<sessions-root>/../sessions-backup-preset-rename/` before
 * any rewrite; rewrites are write-temp-then-rename.
 *
 * Run while no session is mid-turn (an actively-appended log could interleave
 * with the replace). Already-migrated or untouched logs are skipped, so the
 * script is idempotent and safe to re-run.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-preset-selections.ts <sessions-root>            # dry run
 *   pnpm exec tsx scripts/migrate-preset-selections.ts <sessions-root> --apply    # migrate
 * @module scripts/migrate-preset-selections
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'

const require = createRequire(import.meta.url)
// CJS interop: fzstd ships no named ESM exports; it is decompress-only, which
// is all the read side needs.
const { decompress } = require('fzstd') as typeof import('fzstd')

const FRAME_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/** The rename map: bare preset id → its dsh- prefixed successor. */
const RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['"agentPreset":"dev"', '"agentPreset":"dsh-dev"'],
  ['"agentPreset":"learning"', '"agentPreset":"dsh-learning"'],
]

const SELECTED_MARKER = '"type":"agent-preset/selected"'
/** The session header also records the creation-time preset (the projection initializes from it). */
const HEADER_MARKER = '{"type":"session"'

interface Candidate {
  readonly file: string
  readonly rel: string
  readonly rows: number
}

/** Byte offset just past the first zstd frame (the header frame). */
function firstFrameEnd(buffer: Buffer, start = 0): number {
  let offset = start + 4 // magic, already validated by the caller
  const descriptor = buffer[offset++]
  if (descriptor === undefined) throw new Error('truncated frame header')
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictIdFlag = descriptor & 0x03
  if (!singleSegment) offset += 1 // window descriptor
  offset += [0, 1, 2, 4][dictIdFlag] ?? 0
  const fcsFlag = descriptor >> 6
  // FCS field size: flag 0 → 0 bytes (1 when single-segment), 1 → 2, 2 → 4,
  // 3 → 8. (The flag-1 size is two bytes — FCS stores size−256 there; a
  // recompressed frame0 from node:zlib uses flag 1, which is why this parser
  // must get it right and not just mirror the host writer's habits.)
  const fcsBytes = singleSegment && fcsFlag === 0 ? 1 : [0, 2, 4, 8][fcsFlag]
  if (fcsBytes === undefined) throw new Error('invalid frame-content-size flag')
  offset += fcsBytes
  while (true) {
    const blockHeader = buffer.readUIntLE(offset, 3)
    offset += 3
    const lastBlock = (blockHeader & 1) === 1
    const blockType = (blockHeader >> 1) & 0x03
    const blockSize = blockHeader >> 3
    if (blockType === 0x03) throw new Error('reserved zstd block type')
    offset += blockType === 0x01 ? 1 : blockSize
    if (lastBlock) break
  }
  if (checksum) offset += 4
  if (offset <= start) throw new Error('empty first frame')
  return offset
}

/** Rewrite one plaintext line; `agent-preset/selected` events and the header qualify. */
function migrateLine(line: string): { line: string; hit: boolean } {
  if (line === '' || (!line.includes(SELECTED_MARKER) && !line.startsWith(HEADER_MARKER))) return { line, hit: false }
  let next = line
  let hit = false
  for (const [from, to] of RENAMES) {
    if (next.includes(from)) {
      next = next.split(from).join(to)
      hit = true
    }
  }
  return { line: next, hit }
}

/** List every session*.jsonl.zstd two levels down (workspace dir / session dir). */
function* sessionFiles(dir: string): Generator<string> {
  for (const workspace of readdirSync(dir)) {
    const wdir = join(dir, workspace)
    if (!statSync(wdir).isDirectory()) continue
    for (const session of readdirSync(wdir)) {
      const sdir = join(wdir, session)
      if (!statSync(sdir).isDirectory()) continue
      for (const name of readdirSync(sdir)) {
        if (!name.startsWith('session') || !name.endsWith('.jsonl.zstd')) continue
        const file = join(sdir, name)
        if (statSync(file).isFile()) yield file
      }
    }
  }
}

const root = process.argv[2]
const apply = process.argv.includes('--apply')
if (root === undefined) {
  process.stderr.write('usage: tsx scripts/migrate-preset-selections.ts <sessions-root> [--apply]\n')
  process.exit(2)
}

const decoder = new TextDecoder()
const candidates: Candidate[] = []
let scanned = 0
for (const file of sessionFiles(root)) {
  scanned++
  let text: string
  try {
    text = decoder.decode(decompress(readFileSync(file)))
  } catch {
    continue // not a (readable) zstd log — leave it alone
  }
  let rows = 0
  for (const line of text.split('\n')) rows += migrateLine(line).hit ? 1 : 0
  if (rows > 0) candidates.push({ file, rel: relative(root, file), rows })
}

process.stdout.write(`scanned ${scanned} logs under ${root}\n`)
if (candidates.length === 0) {
  process.stdout.write('nothing to migrate\n')
  process.exit(0)
}
  for (const c of candidates) process.stdout.write(`${c.rel}: ${c.rows} preset reference(s) name a bare id\n`)
if (!apply) {
  process.stdout.write('\ndry run — pass --apply to migrate\n')
  process.exit(0)
}

const backupRoot = join(root, '..', 'sessions-backup-preset-rename')
for (const c of candidates) {
  const backup = join(backupRoot, c.rel)
  mkdirSync(dirname(backup), { recursive: true })
  copyFileSync(c.file, backup)

  const buffer = readFileSync(c.file)
  const frame0End = firstFrameEnd(buffer)
  const frame0 = buffer.subarray(0, frame0End)
  const fullText = decoder.decode(decompress(buffer))
  const frame0Text = decoder.decode(decompress(frame0))
  if (!fullText.startsWith(frame0Text)) throw new Error(`${c.rel}: header frame is not the plaintext prefix`)

  // The header records the creation-time preset (the projection initializes
  // from it) — frame 0 is re-emitted rather than copied when it names a bare id.
  const frame0Migrated = migrateLine(frame0Text)
  const outFrame0Text = frame0Migrated.line
  const frame0Out = frame0Migrated.hit ? zstdCompressSync(outFrame0Text, FRAME_OPTIONS) : frame0

  const bodyLines = fullText.slice(frame0Text.length).split('\n')
  let migrated = 0
  const outBody = bodyLines.map((line) => {
    const next = migrateLine(line)
    if (next.hit) migrated++
    return next.line
  }).join('\n')
  const output = Buffer.concat([frame0Out, zstdCompressSync(outBody, FRAME_OPTIONS)])

  // Acceptance on the REWRITTEN bytes: frame 0 still decodes to exactly the
  // header line, and line-by-line the plaintext differs from the original only
  // where migrateLine claims a hit (no collateral damage, idempotency-safe —
  // a reverse substitution would misfire on already-migrated events).
  const rewrittenText = decoder.decode(decompress(output))
  if (rewrittenText !== `${outFrame0Text}${outBody}`) throw new Error(`${c.rel}: plaintext drift beyond the rename`)
  const origLines = fullText.split('\n')
  const newLines = rewrittenText.split('\n')
  if (origLines.length !== newLines.length) throw new Error(`${c.rel}: line count changed`)
  for (let i = 0; i < origLines.length; i++) {
    const before = origLines[i]!
    if (before === newLines[i]) continue
    const expected = migrateLine(before)
    if (!expected.hit || expected.line !== newLines[i]) {
      throw new Error(`${c.rel}: line ${i + 1} changed beyond the rename`)
    }
  }
  const rewrittenFrame0 = decoder.decode(decompress(output.subarray(0, firstFrameEnd(output))))
  if (rewrittenFrame0.trimEnd() !== outFrame0Text.trimEnd() || rewrittenFrame0.trimEnd().includes('\n')) {
    throw new Error(`${c.rel}: frame 0 is not exactly the header line`)
  }

  const tmp = `${c.file}.migrate-tmp`
  writeFileSync(tmp, output)
  renameSync(tmp, c.file)
  process.stdout.write(`migrated ${c.rel} (${migrated} rows, backup at ${relative(root, backup)})\n`)
}
process.stdout.write('done\n')
