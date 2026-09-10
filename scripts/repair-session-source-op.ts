#!/usr/bin/env tsx
/**
 * repair-session-source-op — one-shot repair for historical v0 session logs
 * that message-tools (≤ the 0.1.2-era line) stamped with an out-of-spec
 * `source.op` discriminator. The host's v0→v1 migrator validates released v0
 * keys strictly and refuses the whole session ("source has unexpected member
 * \"op\""), leaving the v0 artifact untouched.
 *
 * Container layout (session-persistence-jsonl): a concatenated-Zstandard
 * sequence whose FIRST frame must be exactly the header line; later frames
 * are append batches with no read-side semantics. The repair therefore
 *   1. decompresses the whole log in one shot (multi-frame aware),
 *   2. deletes `data.source.op` from message-tools plugin rows only,
 *   3. re-emits TWO frames: the original header frame copied byte-for-byte,
 *      and one frame holding the repaired body, compressed with the host
 *      writer's exact recipe (zstdCompress with ZSTD_c_checksumFlag=1).
 * (An earlier single-frame draft of this script was rejected by the host
 * reader — "first frame is not exactly one header line"; do not regress to
 * whole-file single-frame writes.)
 *
 * Originals are preserved under `<sessions-root>/../sessions-backup-source-op/`
 * before any rewrite; rewrites are write-temp-then-rename.
 *
 * Consequence to know before running: stripped edit replacements project as
 * plain message-tools replacements (the withdrawal bucket) in historical
 * sessions — a cosmetic mislabel in history, accepted by the user.
 *
 * Usage:
 *   pnpm exec tsx scripts/repair-session-source-op.ts <sessions-root>            # dry run
 *   pnpm exec tsx scripts/repair-session-source-op.ts <sessions-root> --apply    # repair
 * @module scripts/repair-session-source-op
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'

const require = createRequire(import.meta.url)
// CJS interop: fzstd ships no named ESM exports; it is decompress-only, which
// is all the read side needs.
const { decompress } = require('fzstd') as typeof import('fzstd')

const ZSTD_MAGIC = 0xFD2FB528
const FRAME_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

interface Row {
  readonly type?: string
  readonly data?: { readonly source?: Record<string, unknown> }
}

interface Candidate {
  readonly file: string
  readonly rel: string
  readonly rows: number
}

const root = process.argv[2]
const apply = process.argv.includes('--apply')
if (root === undefined) {
  process.stderr.write('usage: repair-session-source-op.ts <sessions-root> [--apply]\n')
  process.exit(2)
}

/**
 * The host's frame scanner (session-persistence-jsonl/src/zstd.ts), ported,
 * stopping after the first complete frame — the repair only needs the header
 * frame's exact byte range.
 */
function firstFrameEnd(buffer: Buffer): number {
  let offset = 0
  const start = offset
  if (buffer.length - offset < 4) throw new Error('torn frame prefix at byte 0')
  if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
    throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
  }
  offset += 4
  const descriptor = buffer.readUInt8(offset)
  offset += 1
  if ((descriptor & 0x18) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 0x03
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  for (;;) {
    const blockHeader = buffer.readUIntLE(offset, 3)
    offset += 3
    const lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 0x03
    const blockSize = blockHeader >>> 3
    if (blockType === 0x03) throw new Error(`reserved block type at byte ${offset - 3}`)
    offset += blockType === 0x01 ? 1 : blockSize
    if (lastBlock) break
  }
  if (checksum) offset += 4
  if (offset <= start) throw new Error('empty first frame')
  return offset
}

/** Strip source.op from message-tools rows in one plaintext line. */
function repairLine(line: string): { line: string; hit: boolean } {
  if (line === '' || !line.includes('"message-tools"') || !line.includes('"op"')) return { line, hit: false }
  const row = JSON.parse(line) as Row
  const source = row.data?.source
  if (source?.['kind'] === 'plugin' && source['plugin'] === 'message-tools' && source['op'] !== undefined) {
    delete source['op']
    return { line: JSON.stringify(row), hit: true }
  }
  return { line, hit: false }
}

/** List every session.jsonl.zstd two levels down (workspace dir / session dir). */
function* sessionFiles(dir: string): Generator<string> {
  for (const workspace of readdirSync(dir)) {
    const wdir = join(dir, workspace)
    if (!statSync(wdir).isDirectory()) continue
    for (const session of readdirSync(wdir)) {
      const file = join(wdir, session, 'session.jsonl.zstd')
      try {
        if (statSync(file).isFile()) yield file
      } catch { /* no log at this level */ }
    }
  }
}

// The host's own v0 validator, reused from the harness checkout so the
// post-repair acceptance check is the migrator's exact rule.
const HARNESS = process.env.DSH_HARNESS ?? join(process.env.HOME ?? '', 'code/deepseek-harness')
const { assertReleasedEventPayload } = require(join(
  HARNESS, 'packages/session/session-format-v0-to-v1/lib/index.js',
)) as { assertReleasedEventPayload: (event: unknown, version: 0 | 1) => void }

const decoder = new TextDecoder()
const candidates: Candidate[] = []
let scanned = 0
for (const file of sessionFiles(root)) {
  scanned++
  const text = decoder.decode(decompress(readFileSync(file)))
  const lines = text.split('\n')
  const header = JSON.parse(lines[0]) as { version?: number }
  if (header.version !== 0) continue
  let rows = 0
  for (const line of lines) rows += repairLine(line).hit ? 1 : 0
  if (rows > 0) candidates.push({ file, rel: relative(root, file), rows })
}

process.stdout.write(`scanned ${scanned} logs under ${root}\n`)
if (candidates.length === 0) {
  process.stdout.write('nothing to repair\n')
  process.exit(0)
}
for (const c of candidates) process.stdout.write(`${c.rel}: ${c.rows} row(s) carry source.op\n`)
if (!apply) {
  process.stdout.write('\ndry run — pass --apply to repair\n')
  process.exit(0)
}

const backupRoot = join(root, '..', 'sessions-backup-source-op')
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

  const bodyLines = fullText.slice(frame0Text.length).split('\n')
  let repaired = 0
  const outBody = bodyLines.map((line) => {
    const next = repairLine(line)
    if (next.hit) repaired++
    return next.line
  }).join('\n')
  const output = Buffer.concat([frame0, zstdCompressSync(outBody, FRAME_OPTIONS)])

  // Post-repair acceptance on the REWRITTEN bytes: frame 0 must decode to
  // exactly one header line (the host reader's structural rule), the full
  // plaintext must equal the intended repair (no collateral damage), and
  // every message-tools plugin row must pass the host's v0 payload
  // assertions — the same rule that refused the session before.
  const rewrittenText = decoder.decode(decompress(output))
  if (rewrittenText !== `${frame0Text}${outBody}`) throw new Error(`${c.rel}: plaintext drift beyond source.op`)
  const rewrittenFrame0End = firstFrameEnd(output)
  const rewrittenFrame0 = decoder.decode(decompress(output.subarray(0, rewrittenFrame0End)))
  if (rewrittenFrame0.trimEnd() !== frame0Text.trimEnd() || rewrittenFrame0.trimEnd().includes('\n')) {
    throw new Error(`${c.rel}: frame 0 is not exactly the header line`)
  }
  for (const line of rewrittenText.split('\n')) {
    if (line === '' || !line.includes('"message-tools"')) continue
    const row = JSON.parse(line) as Row
    if (row.data?.source?.['kind'] === 'plugin') assertReleasedEventPayload(row, 0)
  }

  const tmp = `${c.file}.repair-tmp`
  writeFileSync(tmp, output)
  renameSync(tmp, c.file)
  process.stdout.write(`repaired ${c.rel} (${repaired} rows, backup at ${relative(root, backup)})\n`)
}
process.stdout.write('done\n')
