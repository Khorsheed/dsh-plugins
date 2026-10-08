import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { canInheritModelProvider, localModelLaunch, MODEL_CONFIG_ENV } from '../src/model-launch.ts'

function fixture() {
  const ctx = new Context()
  const route = { apiKeyEnv: 'KIMI_KEY', baseURL: 'https://example.com/v1', models: ['k3'], reasoning: { enabled: true } }
  let key = 'test-credential'
  const resolve = vi.fn(async (ref: string) => ref === 'KIMI_KEY' ? { value: key } : undefined)
  ctx.provide('settings', { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {
    'kimi-coding': route, other: { apiKeyEnv: 'OTHER_KEY' }, oauth: {},
  } } }] })
  ctx.provide('credentials', { resolve })
  return { ctx, route, resolve, setKey: (next: string) => { key = next } }
}

describe('local DSH selected model inheritance', () => {
  it('carries the selected route and credential, without requiring DeepSeek or reading other credentials', async () => {
    const { ctx, resolve } = fixture()
    const launch = await localModelLaunch(ctx, {}, 'kimi-coding/k3')
    expect(resolve.mock.calls).toEqual([['KIMI_KEY']])
    expect(JSON.parse(launch.env[MODEL_CONFIG_ENV]!)).toEqual({ piAi: { providers: { 'kimi-coding': {
      apiKeyEnv: 'DSH_LOCAL_AGENT_MODEL_API_KEY', baseURL: 'https://example.com/v1', models: ['k3'], reasoning: { enabled: true },
    } } } })
    expect(launch.env.DSH_LOCAL_AGENT_MODEL_API_KEY).toBe('test-credential')
    expect(launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(launch.env[MODEL_CONFIG_ENV]).not.toContain('test-credential')
    expect(launch.env[MODEL_CONFIG_ENV]).not.toContain('OTHER_KEY')
  })

  it('detects credential and endpoint changes without exposing either in the fingerprint', async () => {
    const f = fixture()
    const first = await localModelLaunch(f.ctx, {}, 'kimi-coding/k3')
    expect((await localModelLaunch(f.ctx, {}, 'kimi-coding/k3')).fingerprint).toBe(first.fingerprint)
    f.setKey('rotated-credential')
    const rotated = await localModelLaunch(f.ctx, {}, 'kimi-coding/k3')
    expect(rotated.fingerprint).not.toBe(first.fingerprint)
    f.route.baseURL = 'https://example.org/v1'
    expect((await localModelLaunch(f.ctx, {}, 'kimi-coding/k3')).fingerprint).not.toBe(rotated.fingerprint)
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not advertise or launch unknown adapters and OAuth-only routes as transferable', async () => {
    const { ctx, resolve } = fixture()
    expect(canInheritModelProvider(ctx, 'kimi-coding')).toBe(true)
    for (const provider of ['oauth', 'unknown']) {
      expect(canInheritModelProvider(ctx, provider)).toBe(false)
      await expect(localModelLaunch(ctx, {}, `${provider}/model`)).rejects.toThrow('no inheritable API-key route')
    }
    expect(resolve).not.toHaveBeenCalled()
    await expect(localModelLaunch(ctx, {}, 'other/model')).rejects.toThrow('OTHER_KEY is unavailable')
  })

  it('preserves native DeepSeek settings and the configured credential override', async () => {
    const ctx = new Context()
    ctx.provide('settings', { describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'HOST_KEY', baseURL: 'https://example.com' } }] })
    const resolve = vi.fn(async (_ref: string) => ({ value: 'test-deepseek' }))
    ctx.provide('credentials', { resolve })
    expect(JSON.parse((await localModelLaunch(ctx, { apiKeyRef: 'OVERRIDE' }, 'deepseek-official/chat')).env[MODEL_CONFIG_ENV]!))
      .toEqual({ deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://example.com' } })
    await localModelLaunch(ctx, {}, 'deepseek-official/chat')
    expect(resolve.mock.calls).toEqual([['OVERRIDE'], ['HOST_KEY']])
  })
})
