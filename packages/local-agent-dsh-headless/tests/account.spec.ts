import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as AccountRoute from '@deepseek-ai/dsh-llm-deepseek-account'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DelegatedDeepSeekAccount from '../src/account.ts'
import { ACCOUNT_ORIGIN_ENV, ACCOUNT_TOKEN_ENV } from '../src/account-env.ts'

const contexts: Context[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

function accountContext(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', { readRecord: async () => undefined } as never)
  ctx.provide('authorization', { registerFlow: () => () => {} } as never)
  return ctx
}

describe('delegated DeepSeek account', () => {
  it('provides the official account service without persisting the parent grant', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const resolve = vi.fn()
    const writeRecord = vi.fn()
    ctx.provide('credentials', { readRecord: async () => undefined, resolve, writeRecord } as never)
    ctx.provide('authorization', { registerFlow: () => () => {} } as never)
    await ctx.plugin(DelegatedDeepSeekAccount)
    vi.stubEnv(ACCOUNT_TOKEN_ENV, 'parent-account-token')
    vi.stubEnv(ACCOUNT_ORIGIN_ENV, 'https://api.deepseek.com')
    const account = ctx.get('deepseekAccount')
    expect(account).toBeInstanceOf(DeepSeekAccount)
    await expect(account.resolveToken('https://api.deepseek.com/anthropic/v1/messages')).resolves.toBe('parent-account-token')
    await expect(account.resolveToken('https://example.com/anthropic/v1/messages')).resolves.toBeUndefined()
    await expect(account.resolveToken('https://user@api.deepseek.com/anthropic/v1/messages')).resolves.toBeUndefined()
    await account.rejectToken('parent-account-token')
    await expect(account.resolveToken('https://api.deepseek.com')).resolves.toBe('parent-account-token')
    expect(resolve).not.toHaveBeenCalled()
    expect(writeRecord).not.toHaveBeenCalled()
  })

  it('fails closed without a launch origin or token', async () => {
    const ctx = accountContext()
    await ctx.plugin(DelegatedDeepSeekAccount)
    vi.stubEnv(ACCOUNT_TOKEN_ENV, 'parent-account-token')
    await expect(ctx.get('deepseekAccount').resolveToken('https://api.deepseek.com')).resolves.toBeUndefined()
    vi.stubEnv(ACCOUNT_ORIGIN_ENV, 'https://api.deepseek.com')
    vi.stubEnv(ACCOUNT_TOKEN_ENV, '')
    await expect(ctx.get('deepseekAccount').resolveToken('https://api.deepseek.com')).resolves.toBeUndefined()
  })

  it('authenticates the official account provider with the launch grant', async () => {
    const headers: Array<string | undefined> = []
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/models') {
        response.writeHead(404).end()
        return
      }
      headers.push(request.headers['x-dsh-auth-token'] as string | undefined)
      expect(request.headers['x-api-key']).toBeUndefined()
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{
        id: 'deepseek-flash', name: 'Account Flash', context_window: 1_048_576, max_output_tokens: 393_216,
        input_modalities: ['text'], output_modalities: ['text'], api_capabilities: { anthropic_messages: {} },
      }] }))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${address.port}`
    vi.stubEnv(ACCOUNT_TOKEN_ENV, 'parent-account-token')
    vi.stubEnv(ACCOUNT_ORIGIN_ENV, origin)
    const ctx = accountContext()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(DelegatedDeepSeekAccount, { inferenceOrigin: origin })
    await ctx.plugin(AccountRoute, { baseURL: `${origin}/anthropic` })
    expect((await ctx.llm.listModels('deepseek-account')).map(row => [row.id, row.name])).toEqual([['deepseek-flash', 'Account Flash']])
    expect(headers).toEqual(['parent-account-token'])
  })
})
