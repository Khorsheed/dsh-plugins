/**
 * T30b — `--model` on the sub-dsh launch: how a `provider/model` request lands
 * on the instance's default selection, and what a launch without one keeps.
 */
import { describe, expect, it } from 'vitest'
import { applyModelRequest } from '../src/agent-loader.ts'

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } as never

describe('applyModelRequest', () => {
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
