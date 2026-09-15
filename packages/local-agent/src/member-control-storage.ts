import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemberControlRecord, MemberControlStorage } from './member-control.ts'

type JsonObject = Record<string, unknown>
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const revision = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'
const choice = (value: unknown): boolean => object(value) && (
  value['mode'] === 'inherit' || value['mode'] === 'default'
  || (value['mode'] === 'value' && typeof value['value'] === 'string' && value['value'].trim() !== '')
)
const selection = (value: unknown): boolean => object(value) && choice(value['model']) && choice(value['effort'])
const resolved = (value: unknown): boolean => object(value) && optionalString(value['model']) && optionalString(value['effort'])
const applied = (value: unknown): boolean => object(value) && revision(value['revision']) && selection(value['selection']) && resolved(value['resolved'])
const pending = (value: unknown): boolean => object(value) && revision(value['revision']) && typeof value['requestId'] === 'string'
  && (value['kind'] === 'selection' || value['kind'] === 'cancel') && selection(value['selection'])
const states = new Set(['idle', 'pending', 'applying', 'reconciling', 'failed'])
const receipts = new Set(['pending', 'applying', 'applied', 'cancelled', 'failed', 'conflict', 'locked', 'unsupported'])

/** Fail closed for malformed recovery state; never silently turn it into defaults. */
function parseRecord(value: unknown): MemberControlRecord {
  if (!object(value) || value['version'] !== 1 || !object(value['state']) || !object(value['requests'])) throw new Error('Invalid member control file')
  const state = value['state']
  const operation = state['operation']
  const round = state['round']
  if (typeof state['memberId'] !== 'string' || !revision(state['revision']) || !applied(state['current'])
    || (state['pending'] !== undefined && !pending(state['pending']))
    || (operation !== undefined && (!object(operation) || !pending(operation) || !applied(operation['previous'])))
    || (round !== undefined && (!object(round) || typeof round['id'] !== 'string' || !applied(round['configuration'])))
    || typeof state['status'] !== 'string' || !states.has(state['status'])
    || !optionalString(state['error']) || !optionalString(state['lockedReason'])) throw new Error('Invalid member control state')
  for (const [id, request] of Object.entries(value['requests'])) {
    if (!object(request) || typeof request['signature'] !== 'string' || !object(request['receipt'])) throw new Error('Invalid member control receipt')
    const receipt = request['receipt']
    if (receipt['requestId'] !== id || !revision(receipt['revision']) || typeof receipt['status'] !== 'string'
      || !receipts.has(receipt['status']) || !optionalString(receipt['error'])) throw new Error('Invalid member control receipt')
  }
  return { state, requests: value['requests'] } as unknown as MemberControlRecord
}

/** Per-member atomic files; acknowledgement requires a flushed file and rename. */
export class FileMemberControlStorage implements MemberControlStorage {
  constructor(private readonly directory: string) {}
  private path(memberId: string): string { return join(this.directory, createHash('sha256').update(memberId).digest('hex') + '.json') }

  read(memberId: string): MemberControlRecord | undefined {
    let text: string
    try { text = readFileSync(this.path(memberId), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('Persisted member controls could not be read', { cause: error })
    }
    const record = parseRecord(JSON.parse(text))
    const state = record.state
    if (state.memberId !== memberId || state.current.revision > state.revision
      || (state.pending !== undefined && (state.pending.revision > state.revision || !Object.hasOwn(record.requests, state.pending.requestId)))
      || (state.operation !== undefined && (state.operation.revision > state.revision || !Object.hasOwn(record.requests, state.operation.requestId)))
      || (state.round !== undefined && state.round.configuration.revision > state.revision)) {
      throw new Error('Persisted member controls are inconsistent; admission is blocked')
    }
    return { state, requests: record.requests }
  }

  write(memberId: string, record: MemberControlRecord): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = this.path(memberId)
    const temporary = `${path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify({ version: 1, ...record }) + '\n', 'utf8')
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, path)
      // Windows does not expose directory fsync through this API. The file
      // itself is flushed on every platform before the atomic replacement.
      if (process.platform !== 'win32') {
        fd = openSync(this.directory, 'r')
        fsyncSync(fd)
      }
    } finally {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
