import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureKimiModelTables, listKimiConfigModels, readKimiAutoApprove, readKimiBaseUrl, readKimiReasoningEffort } from '../src/provision.ts'

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

describe('listKimiConfigModels', () => {
  it('is empty when the config is absent', async () => {
    await expect(listKimiConfigModels(tempHome())).resolves.toEqual([])
  })

  it('lists every [models."…"] table key in file order, deduplicated', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), [
      'default_model = "kimi-code/k3"',
      '',
      '[models."kimi-code/k3"]',
      'provider = "managed:kimi-code"',
      '',
      '[models."custom/x1"]',
      'provider = "managed:kimi-code"',
      '',
      // A bare (unquoted) table key is the same model table.
      '[models.plain]',
      'provider = "managed:kimi-code"',
      '',
      // Provider tables are NOT models; a repeated table lists once.
      '[providers."managed:kimi-code"]',
      'type = "kimi"',
      '',
      '[models."kimi-code/k3"]',
      'provider = "managed:kimi-code"',
      '',
    ].join('\n'))
    await expect(listKimiConfigModels(home)).resolves.toEqual(['kimi-code/k3', 'custom/x1', 'plain'])
  })
})

describe('ensureKimiModelTables', () => {
  const MINIMAL = [
    'default_model = "kimi-code/k3"',
    '',
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    '',
    '[models."kimi-code/k3"]',
    'provider = "managed:kimi-code"',
    'model = "k3"',
    '',
  ].join('\n')

  it('returns [] and writes nothing when the config is absent (provisioning owns creation)', async () => {
    const home = tempHome()
    await expect(ensureKimiModelTables(home, ['k3'])).resolves.toEqual([])
    await expect(listKimiConfigModels(home)).resolves.toEqual([])
  })

  it('appends a managed table per missing value, carrying the endpoint metadata', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), MINIMAL)
    const created = await ensureKimiModelTables(home, ['k3-256k', 'kimi-for-coding'], value =>
      value === 'k3-256k'
        ? { label: 'K3 256K', contextSize: 262144, efforts: ['low', 'high', 'max'], defaultEffort: 'max' }
        : undefined,
    )
    expect(created).toEqual(['k3-256k', 'kimi-for-coding'])
    const text = readFileSync(join(home, 'config.toml'), 'utf8')
    // The metadata-carrying table mirrors the minimal config's managed shape.
    expect(text).toContain([
      '[models."k3-256k"]',
      'provider = "managed:kimi-code"',
      'model = "k3-256k"',
      'max_context_size = 262144',
      'capabilities = [ "thinking", "always_thinking", "image_in", "video_in", "tool_use" ]',
      'display_name = "K3 256K"',
      'support_efforts = [ "low", "high", "max" ]',
      'default_effort = "max"',
      '',
    ].join('\n'))
    // Without metadata the table is minimal but runnable: the default context
    // size, the value as its own label, no effort lines.
    const minimal = text.slice(text.indexOf('[models."kimi-for-coding"]'))
    expect(minimal).toContain([
      '[models."kimi-for-coding"]',
      'provider = "managed:kimi-code"',
      'model = "kimi-for-coding"',
      'max_context_size = 1048576',
      'capabilities = [ "thinking", "always_thinking", "image_in", "video_in", "tool_use" ]',
      'display_name = "kimi-for-coding"',
      '',
    ].join('\n'))
    expect(minimal).not.toContain('support_efforts')
    expect(minimal).not.toContain('default_effort')
    // The pre-existing config (provider section included) is byte-preserved above the appended tables.
    expect(text.startsWith(MINIMAL.trimEnd())).toBe(true)
  })

  it('skips values the config already keys (quoted or bare) and stays idempotent', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), MINIMAL + '[models.plain]\nprovider = "managed:kimi-code"\n')
    // kimi-code/k3 and plain exist; only k3-256k is appended.
    await expect(ensureKimiModelTables(home, ['kimi-code/k3', 'plain', 'k3-256k'])).resolves.toEqual(['k3-256k'])
    const once = readFileSync(join(home, 'config.toml'), 'utf8')
    await expect(ensureKimiModelTables(home, ['kimi-code/k3', 'plain', 'k3-256k'])).resolves.toEqual([])
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(once)
  })

  it('TOML-escapes keys and values so a quote cannot break the config', async () => {
    const home = tempHome()
    writeFileSync(join(home, 'config.toml'), MINIMAL)
    await expect(ensureKimiModelTables(home, ['wei"rd'], () => ({ label: 'a "quoted" label' }))).resolves.toEqual(['wei"rd'])
    const text = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(text).toContain('[models."wei\\"rd"]')
    expect(text).toContain('model = "wei\\"rd"')
    expect(text).toContain('display_name = "a \\"quoted\\" label"')
    // …and the escaped table reads back as the same key (idempotent re-run).
    await expect(ensureKimiModelTables(home, ['wei"rd'])).resolves.toEqual([])
  })
})
