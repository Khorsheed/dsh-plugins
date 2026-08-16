import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKimiBaseUrl } from '../src/provision.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'kimi-provision-'))
}

describe('readKimiBaseUrl', () => {
  it('returns undefined when the config is absent', async () => {
    await expect(readKimiBaseUrl(tempHome())).resolves.toBeUndefined()
  })

  it('reads the managed provider base_url wherever it sits in the section', async () => {
    const home = tempHome()
    // Key order inside the table is the writer's choice: base_url after
    // type/api_key must still be found.
    writeFileSync(join(home, 'config.toml'), [
      'default_model = "kimi-code/k3"',
      '',
      '[providers."managed:kimi-code"]',
      'type = "kimi"',
      'api_key = ""',
      'base_url = "https://proxy.example.com/anthropic"',
      '',
      '[providers."managed:kimi-code".oauth]',
      'storage = "file"',
      '',
    ].join('\n'))
    await expect(readKimiBaseUrl(home)).resolves.toBe('https://proxy.example.com/anthropic')
  })

  it('does not mistake another provider section for the managed one', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[providers.anthropic]',
      'base_url = "https://other.example.com"',
      '',
    ].join('\n'))
    await expect(readKimiBaseUrl(home)).resolves.toBeUndefined()
  })
})
