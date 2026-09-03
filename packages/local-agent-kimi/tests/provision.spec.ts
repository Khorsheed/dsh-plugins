import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKimiAutoApprove, readKimiBaseUrl, readKimiReasoningEffort } from '../src/provision.ts'

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

describe('readKimiReasoningEffort', () => {
  it('returns undefined when the config is absent', async () => {
    await expect(readKimiReasoningEffort(tempHome())).resolves.toBeUndefined()
  })

  it('reads the thinking table effort wherever it sits in the section', async () => {
    const home = tempHome()
    // Key order inside the table is the writer's choice: enabled after
    // effort must still parse.
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'effort = "max"',
      'enabled = true',
      '',
    ].join('\n'))
    await expect(readKimiReasoningEffort(home)).resolves.toBe('max')
  })

  it('falls back to the model default_effort when thinking carries none', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'enabled = true',
      '',
      '[models."kimi-code/k3"]',
      'provider = "managed:kimi-code"',
      'default_effort = "high"',
      '',
    ].join('\n'))
    await expect(readKimiReasoningEffort(home)).resolves.toBe('high')
  })

  it('prefers the thinking effort over the model default', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'enabled = true',
      'effort = "low"',
      '',
      '[models."kimi-code/k3"]',
      'default_effort = "high"',
      '',
    ].join('\n'))
    await expect(readKimiReasoningEffort(home)).resolves.toBe('low')
  })

  it('yields undefined when no effort key exists anywhere', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), 'default_model = "kimi-code/k3"\n')
    await expect(readKimiReasoningEffort(home)).resolves.toBeUndefined()
  })
})

describe('readKimiAutoApprove', () => {
  it('is false when the config is absent', async () => {
    await expect(readKimiAutoApprove(tempHome())).resolves.toBe(false)
  })

  it('detects the provisioned Bash(*) allow rule', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'enabled = true',
      '',
      '[[permission.rules]]',
      'decision = "allow"',
      'pattern = "Bash(*)"',
      'reason = "let the kimi subagent run shell commands"',
      '',
    ].join('\n'))
    await expect(readKimiAutoApprove(home)).resolves.toBe(true)
  })

  it('is false for a config without the rule', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), 'default_model = "kimi-code/k3"\n')
    await expect(readKimiAutoApprove(home)).resolves.toBe(false)
  })
})
