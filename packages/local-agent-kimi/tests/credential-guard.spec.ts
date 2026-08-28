/**
 * The kimi credential sentinel: backup-on-valid, restore-on-empty-shell, and
 * the transition log lines that make the next wipe attributable.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { guardKimiCredential } from '../src/credential-guard.ts'
import { kimiAuthenticated } from '../src/records.ts'

const VALID = JSON.stringify({ access_token: 'a-token', refresh_token: 'r-token', expires_at: 1 })
const EMPTY_SHELL = JSON.stringify({ access_token: '', refresh_token: '', expires_at: 1 })

function homeWith(content: string | undefined, backup?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'kimi-credguard-'))
  const dir = join(home, 'credentials')
  mkdirSync(dir, { recursive: true })
  if (content !== undefined) writeFileSync(join(dir, 'kimi-code.json'), content)
  if (backup !== undefined) writeFileSync(join(dir, 'kimi-code.json.bak'), backup)
  return home
}

describe('guardKimiCredential', () => {
  it('backs up a valid credential and reports authenticated', async () => {
    const home = homeWith(VALID)
    expect(await guardKimiCredential(home)).toBe(true)
    expect(readFileSync(join(home, 'credentials', 'kimi-code.json.bak'), 'utf8')).toBe(VALID)
  })

  it('restores the backup over an empty shell and reports authenticated', async () => {
    const home = homeWith(EMPTY_SHELL, VALID)
    const warnings: string[] = []
    expect(await guardKimiCredential(home, message => { warnings.push(message) })).toBe(true)
    expect(readFileSync(join(home, 'credentials', 'kimi-code.json'), 'utf8')).toBe(VALID)
    expect(warnings.some(message => message.includes('EMPTY SHELL'))).toBe(true)
    expect(warnings.some(message => message.includes('restored'))).toBe(true)
  })

  it('reports unauthenticated on an empty shell with no backup (and never invents one)', async () => {
    const home = homeWith(EMPTY_SHELL)
    const warnings: string[] = []
    expect(await guardKimiCredential(home, message => { warnings.push(message) })).toBe(false)
    expect(readFileSync(join(home, 'credentials', 'kimi-code.json'), 'utf8')).toBe(EMPTY_SHELL)
    expect(warnings.some(message => message.includes('fresh login'))).toBe(true)
  })

  it('reports unauthenticated when no credential file exists', async () => {
    const home = homeWith(undefined)
    expect(await guardKimiCredential(home)).toBe(false)
  })

  it('never restores over an unparseable file (unknown corruption is left for a human)', async () => {
    const home = homeWith('not json at all', VALID)
    expect(await guardKimiCredential(home)).toBe(false)
    expect(readFileSync(join(home, 'credentials', 'kimi-code.json'), 'utf8')).toBe('not json at all')
  })

  it('kimiAuthenticated routes through the sentinel (restore on empty shell)', async () => {
    const home = homeWith(EMPTY_SHELL, VALID)
    expect(await kimiAuthenticated(home)).toBe(true)
    expect(readFileSync(join(home, 'credentials', 'kimi-code.json'), 'utf8')).toBe(VALID)
  })
})
