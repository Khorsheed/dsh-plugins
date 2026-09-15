/**
 * T30b — `--model` on the sub-dsh launch: how a `provider/model` request lands
 * on the instance's default selection, and what a launch without one keeps.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { applyModelRequest, loadSubDshAgent } from '../src/agent-loader.ts'

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } as never

describe('applyModelRequest', () => {
  it('checks effort against the actual sub-instance before creating or resuming an Agent', async () => {
    const ctx = new Context()
    const create = vi.fn(async () => ({}))
    const resume = vi.fn(async () => ({}))
    const resolveModelInfo = vi.fn(async () => ({ reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }))
    ctx.provide('agentDefaultModel', { currentSelection: () => DEFAULT } as never)
    ctx.provide('agents', { create, resume } as never)
    ctx.provide('llm', { resolveModelInfo } as never)
    await expect(loadSubDshAgent(ctx, { sessionId: 'fresh', model: 'other/selected', effort: 'high' })).rejects.toThrow('does not advertise')
    await expect(loadSubDshAgent(ctx, { resumeSessionId: 'prior', effort: 'high' })).rejects.toThrow('does not advertise')
    expect(create).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    await loadSubDshAgent(ctx, { sessionId: 'fresh', model: 'other/selected', effort: 'low' })
    expect(resolveModelInfo).toHaveBeenCalledWith('other', 'selected', expect.any(AbortSignal))
    expect(create).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('splits provider/model and replaces both halves', () => {
    expect(applyModelRequest(DEFAULT, 'deepseek-official/deepseek-v4-pro')).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high',
    })
    expect(applyModelRequest(DEFAULT, 'other-route/some-model')).toMatchObject({
      provider: 'other-route', model: 'some-model',
    })
  })

  it('a bare id names the MODEL and keeps the instance provider', () => {
    expect(applyModelRequest(DEFAULT, 'deepseek-v4-pro')).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high',
    })
  })

  it('carries the rest of the selection through — a model swap is not a config reset', () => {
    // The reasoning effort in particular belongs to the instance, not to the
    // flag; `--model` changes the model.
    expect(applyModelRequest(DEFAULT, 'deepseek-official/deepseek-v4-pro')).toMatchObject({ reasoningEffort: 'high' })
  })

  it('an absent or blank request returns the default selection unchanged', () => {
    expect(applyModelRequest(DEFAULT, undefined)).toBe(DEFAULT)
    expect(applyModelRequest(DEFAULT, '   ')).toBe(DEFAULT)
  })

  it('a leading or trailing slash is not a provider — the whole value is the model', () => {
    // `/foo` names no provider and `foo/` names no model; treating either as a
    // split would produce an empty half the agent cannot route.
    expect(applyModelRequest(DEFAULT, '/deepseek-v4-pro')).toMatchObject({ provider: 'deepseek-official', model: '/deepseek-v4-pro' })
    expect(applyModelRequest(DEFAULT, 'deepseek-official/')).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-official/' })
  })

  it('splits at the FIRST slash, so a model id containing one survives', () => {
    expect(applyModelRequest(DEFAULT, 'route/vendor/model-7')).toMatchObject({ provider: 'route', model: 'vendor/model-7' })
  })
})
