import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalAgentMemberBinding } from './types.ts'

export interface PreparedMemberRecord {
  version: 1
  binding: LocalAgentMemberBinding
  phase: 'preparing' | 'ready' | 'starting' | 'used'
}

/** Preparation identity survives restart independently of a not-yet-created native transcript. */
export class PreparedMembers {
  constructor(private readonly directory: string) {}
  private path(id: string): string { return join(this.directory, createHash('sha256').update(id).digest('hex') + '.json') }
  read(id: string): PreparedMemberRecord | undefined {
    let text: string
    try { text = readFileSync(this.path(id), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    const raw = JSON.parse(text) as PreparedMemberRecord
    if (raw?.version !== 1 || !['preparing', 'ready', 'starting', 'used'].includes(raw.phase)
      || raw.binding?.childSessionId !== id || ['provider', 'parentSessionId', 'cwd'].some(key => typeof raw.binding[key as keyof LocalAgentMemberBinding] !== 'string')
      || ['scope', 'model', 'effort', 'configurationLock'].some(key => raw.binding[key as keyof LocalAgentMemberBinding] !== undefined && typeof raw.binding[key as keyof LocalAgentMemberBinding] !== 'string')) {
      throw new Error('Invalid prepared member identity; native admission is blocked')
    }
    return raw
  }
  write(record: PreparedMemberRecord): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = this.path(record.binding.childSessionId)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, path)
      const directory = openSync(this.directory, 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    } finally { try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  }
}
