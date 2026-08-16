import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeLogout, provisionClaudeHome } from '../src/provision.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'claude-provision-'))
}

describe('claude scoped-home provisioning', () => {
  it('creates the scoped home directory', async () => {
    const home = tempHome()
    await provisionClaudeHome(home)
    const { access } = await import('node:fs/promises')
    await expect(access(home)).resolves.toBeUndefined()
  })

  it('removes only the scoped config on logout', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'projects'), { recursive: true })
    writeFileSync(join(home, '.claude.json'), '{"oauthAccount":{}}')
    writeFileSync(join(home, 'projects', 'x.jsonl'), '{}')
    await claudeLogout(home)
    const { readFile, access } = await import('node:fs/promises')
    await expect(access(join(home, '.claude.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(home, 'projects', 'x.jsonl'), 'utf8')).resolves.toBe('{}')
  })
})
