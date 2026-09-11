/**
 * T32 — the sub-dsh joins the preset its sub-profile rosters.
 *
 * The join is what makes a scope's capability face a per-condition factor:
 * without a roster the agent reads the model-facing rows off the global
 * layer (every sub-dsh before this), with one the preset decides them.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { joinSubDshPreset } from '../src/agent-loader.ts'

/** A plugin context whose `get` answers only for the names given. */
function ctxWith(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const agentCtx = { id: 'agent-scope' } as unknown as Context

describe('joinSubDshPreset', () => {
  it('joins the roster and reports the preset id', async () => {
    const mount = vi.fn(async () => ({ id: 'eval-lean' }))
    expect(await joinSubDshPreset(ctxWith({ agentPresets: { mount, defaultId: 'eval-lean' } }), agentCtx)).toBe('eval-lean')
    // No id is passed: the sub-profile's roster declares its own `default`,
    // which is the one place the scope's preset is written down.
    expect(mount).toHaveBeenCalledWith(agentCtx)
  })

  it('is a no-op without a roster — a rosterless sub-dsh reads the global layer', async () => {
    expect(await joinSubDshPreset(ctxWith({}), agentCtx)).toBeUndefined()
  })

  it('is a no-op against a roster service that cannot mount', async () => {
    expect(await joinSubDshPreset(ctxWith({ agentPresets: { defaultId: 'eval-lean' } }), agentCtx)).toBeUndefined()
  })

  it('propagates a refusal — a sub-dsh told to run a preset never silently runs the global layer', async () => {
    const roster = { mount: async (): Promise<{ id: string }> => { throw new Error('agent-presets: preset "ghost" not found') } }
    await expect(joinSubDshPreset(ctxWith({ agentPresets: roster }), agentCtx)).rejects.toThrow(/not found/)
  })
})
