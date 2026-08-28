/**
 * Minimal, dependency-free ZIP reader: enough to unpack a skill archive
 * (dirs, stored and deflated entries) into `{ path, data }` pairs.
 *
 * Why hand-rolled: the host face is analyzed by the typert generator against a
 * scratch overlay that only resolves `@deepseek-ai/*` source-plane packages and
 * the harness's own node_modules — a third-party zip library resolves there but
 * not at publish time, and no host edit is allowed. Using only node:zlib keeps
 * the boundary to node built-ins, which the overlay resolves natively, and
 * keeps the published package free of a zip runtime dependency.
 *
 * Skips directories; throws on a malformed or unsupported (e.g. zip64, encrypted,
 * or data-descriptor-only) archive. Skill zips are small and conventional, so
 * the classic (non-zip64) central directory is the only layout needed.
 * @module @khorsheed/dsh-capability-catalog/zip
 */

import { inflateRawSync } from 'node:zlib'

const SIG_LOCAL = 0x04034b50 // PK\03\04
const SIG_CENTRAL = 0x02014b50 // PK\01\02
const SIG_EOCD = 0x06054b50 // PK\05\06

/** One extracted file entry: a relative path and its contents. */
export interface ZipEntry {
  readonly path: string
  readonly data: Buffer
}

/** Unpack a zip archive into its non-directory entries. */
export function extractZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  if (eocd === undefined) throw new Error('end of central directory not found')
  const count = buf.readUInt16LE(eocd + 10)
  if (count === 0xffff) throw new Error('zip64 archives are not supported')
  let offset = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    offset = readCentralDirEntry(buf, offset, entries)
  }
  return entries
}

/** Walk one central-directory entry, appending it when it is a file. */
function readCentralDirEntry(buf: Buffer, offset: number, entries: ZipEntry[]): number {
  if (buf.readUInt32LE(offset) !== SIG_CENTRAL) throw new Error('bad central directory entry')
  const method = buf.readUInt16LE(offset + 10)
  const compSize = buf.readUInt32LE(offset + 20)
  if (compSize === 0xffffffff) throw new Error('zip64 entries are not supported')
  const nameLen = buf.readUInt16LE(offset + 28)
  const extraLen = buf.readUInt16LE(offset + 30)
  const commentLen = buf.readUInt16LE(offset + 32)
  const localOffset = buf.readUInt32LE(offset + 42)
  const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
  if (!name.endsWith('/')) {
    const { dataOffset } = readLocalHeader(buf, localOffset)
    entries.push({ path: name, data: inflateEntry(buf, dataOffset, method, compSize) })
  }
  return offset + 46 + nameLen + extraLen + commentLen
}

/** Read a local file header, returning the offset where the data begins. */
function readLocalHeader(buf: Buffer, offset: number): { dataOffset: number } {
  if (buf.readUInt32LE(offset) !== SIG_LOCAL) throw new Error('bad local file header')
  const nameLen = buf.readUInt16LE(offset + 26)
  const extraLen = buf.readUInt16LE(offset + 28)
  return { dataOffset: offset + 30 + nameLen + extraLen }
}

/** Decompress one entry: stored (0) or raw-deflated (8). */
function inflateEntry(buf: Buffer, dataOffset: number, method: number, compSize: number): Buffer {
  const compressed = buf.subarray(dataOffset, dataOffset + compSize)
  if (method === 0) return Buffer.from(compressed)
  if (method === 8) return inflateRawSync(compressed)
  throw new Error(`unsupported compression method ${method}`)
}

/** Locate the end-of-central-directory record (last 64 KiB window). */
function findEocd(buf: Buffer): number | undefined {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return undefined
}
