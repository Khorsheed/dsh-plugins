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

describe('provisionClaudeHome proxy env', () => {
  it('writes the env block into a fresh settings.json', async () => {
    const home = tempHome()
    await provisionClaudeHome(home, 'http://127.0.0.1:6152')
    const { readFile } = await import('node:fs/promises')
    const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(settings.env).toEqual({ https_proxy: 'http://127.0.0.1:6152', http_proxy: 'http://127.0.0.1:6152' })
  })

  it('merges into an existing settings.json without touching other keys', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'opus', env: { CUSTOM: '1' } }))
    await provisionClaudeHome(home, 'http://127.0.0.1:6152')
    const { readFile } = await import('node:fs/promises')
    const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(settings.model).toBe('opus')
    expect(settings.env.CUSTOM).toBe('1')
    expect(settings.env.https_proxy).toBe('http://127.0.0.1:6152')
  })

  it('writes nothing when no proxy is configured', async () => {
    const home = tempHome()
    await provisionClaudeHome(home)
    const { access } = await import('node:fs/promises')
    await expect(access(join(home, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
