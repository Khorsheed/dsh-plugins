import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexLogout, provisionCodexConfig, readCodexBaseUrl } from '../src/provision.ts'

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

describe('readCodexBaseUrl', () => {
  it('returns undefined when the config is absent', async () => {
    await expect(readCodexBaseUrl(tempHome())).resolves.toBeUndefined()
  })

  it('reads the selected provider base_url wherever it sits in the section', async () => {
    const home = tempHome()
    // Key order inside the table is the writer's choice: base_url after
    // wire_api must still be found.
    writeFileSync(join(home, 'config.toml'), [
      'model_provider = "relay"',
      '',
      '[model_providers.relay]',
      'wire_api = "responses"',
      'base_url = "https://proxy.example.com/anthropic"',
      '',
    ].join('\n'))
    await expect(readCodexBaseUrl(home)).resolves.toBe('https://proxy.example.com/anthropic')
  })

  it('falls back to a single custom provider when nothing is selected', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[model_providers."my-relay"]',
      'base_url = "https://relay.example.com/v1"',
      '',
    ].join('\n'))
    await expect(readCodexBaseUrl(home)).resolves.toBe('https://relay.example.com/v1')
  })

  it('returns undefined with multiple providers and no selection', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[model_providers.a]',
      'base_url = "https://a.example.com"',
      '[model_providers.b]',
      'base_url = "https://b.example.com"',
      '',
    ].join('\n'))
    await expect(readCodexBaseUrl(home)).resolves.toBeUndefined()
  })
})

