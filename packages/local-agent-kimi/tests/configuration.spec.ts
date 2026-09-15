import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readKimiModelConfiguration, kimiExecConfiguration } from '../src/model-configuration.ts'
import { configureKimiSession } from '../src/session-configuration.ts'
import { kimiNativeConfiguration } from '../src/model-catalog.ts'

function response(model: string, effort: string, efforts = ['low', 'high']) {
  return { configOptions: [
    { id: 'model-selector', category: 'model', type: 'select', currentValue: model, options: ['a', 'b'].map(value => ({ value, name: value })) },
    { id: 'thinking-selector', category: 'thought_level', type: 'select', currentValue: effort, options: efforts.map(value => ({ value, name: value })) },
  ] }
}

describe('Kimi native configuration binding', () => {
  it('uses the selected model table and parses quoted TOML keys and arrays without exposing credentials', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kimi-model-config-'))
    const config = `default_model = 'route/b.v1'
[providers.route]
type = 'kimi'
api_key = 'fixture'
[models.a]
provider = 'route'
default_effort = 'high'
support_efforts = ['high']
[models.'route/b.v1']
provider = 'route'
display_name = 'Native label'
default_effort = 'low'
support_efforts = [
  'low', # native levels
  'max',
]
`
    writeFileSync(join(home, 'config.toml'), config)
    const metadata = await readKimiModelConfiguration(home)
    expect(metadata).toMatchObject({ defaultModel: 'route/b.v1', effort: 'low', protocol: 'kimi' })
    expect(metadata.entries[1]).toMatchObject({ label: 'Native label', reasoning: { options: [{ value: 'low' }, { value: 'max' }] } })
    expect(JSON.stringify(metadata)).not.toContain('fixture')
    expect(await kimiExecConfiguration(home, 'route/b.v1', 'max')).toEqual({ KIMI_MODEL_THINKING_EFFORT: 'max' })
    await expect(kimiExecConfiguration(home, 'route/b.v1', 'high')).rejects.toThrow('does not advertise')
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(config)
  })

  it('does not claim the Kimi-only exec effort override works for another wire protocol', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kimi-other-protocol-'))
    writeFileSync(join(home, 'config.toml'), "default_model='a'\n[providers.p]\ntype='kimi'\n[models.a]\nprovider='p'\nprotocol='anthropic'\nsupport_efforts=['high']\n")
    await expect(kimiExecConfiguration(home, 'a', 'high')).rejects.toThrow('no per-invocation exec effort')
  })

  it('confirms a model switch before applying its newly returned dependent effort options', async () => {
    const request = vi.fn().mockResolvedValueOnce(response('b', 'low', ['low', 'max'])).mockResolvedValueOnce(response('b', 'max', ['low', 'max']))
    const result = await configureKimiSession('session', kimiNativeConfiguration(response('a', 'high')), { model: 'b', effort: 'max' }, request)
    expect(request.mock.calls).toEqual([
      ['session/set_config_option', { sessionId: 'session', configId: 'model-selector', value: 'b' }],
      ['session/set_config_option', { sessionId: 'session', configId: 'thinking-selector', value: 'max' }],
    ])
    expect(result).toMatchObject({ currentModel: 'b', currentEffort: 'max' })
  })

  it('rejects an unconfirmed model ack and never sends the dependent effort control', async () => {
    const request = vi.fn(async () => response('a', 'low'))
    await expect(configureKimiSession('session', kimiNativeConfiguration(response('a', 'low')), { model: 'b', effort: 'high' }, request)).rejects.toThrow('did not confirm')
    expect(request).toHaveBeenCalledOnce()
  })

  it('does not reuse the previous model effort vocabulary after a model switch', async () => {
    const request = vi.fn(async () => response('b', 'low', ['low']))
    await expect(configureKimiSession('session', kimiNativeConfiguration(response('a', 'high')), { model: 'b', effort: 'high' }, request)).rejects.toThrow('does not advertise')
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps an already confirmed native configuration and refuses an unverified control surface', async () => {
    const request = vi.fn()
    const current = kimiNativeConfiguration(response('a', 'low'))
    expect(await configureKimiSession('session', current, { model: 'a', effort: 'low' }, request)).toBe(current)
    expect(request).not.toHaveBeenCalled()
    await expect(configureKimiSession('session', undefined, { model: 'a' }, request)).rejects.toThrow('no verified model selection')
  })
})
