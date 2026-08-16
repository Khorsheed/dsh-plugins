import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexLogout, provisionCodexConfig } from '../src/provision.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'codex-provision-'))
}

describe('codex scoped-home provisioning', () => {
  it('writes a file-credential config into a fresh home', async () => {
    const home = tempHome()
    expect(await provisionCodexConfig(home)).toBe(true)
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toContain('cli_auth_credentials_store = "file"')
  })

  it('respects an existing config untouched', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), 'model_provider = "custom"\n')
    expect(await provisionCodexConfig(home)).toBe(false)
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toBe('model_provider = "custom"\n')
  })

  it('removes only the credential file on logout', async () => {
    const home = tempHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'auth.json'), '{"token":"secret"}')
    writeFileSync(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n')
    await codexLogout(home)
    const { readFile, access } = await import('node:fs/promises')
    await expect(access(join(home, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toContain('cli_auth_credentials_store')
  })
})
