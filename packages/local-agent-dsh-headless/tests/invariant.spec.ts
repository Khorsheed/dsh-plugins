/**
 * The headless bundle's composition guard: the invariant fails clear when the
 * bundle is mounted into a web composition (the 2026-08-23 P0 class), and
 * stays silent in its own headless composition.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as HeadlessInvariant from '../src/invariant.ts'

async function mount(withWebMarker: boolean): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  if (withWebMarker) {
    // The web layer's startup service, provided as the in-box web-app bundle
    // would before any dependency-managed bundle applies.
    ctx.provide('webStartup', { port: 3080 })
  }
  await ctx.plugin(HeadlessInvariant)
  return ctx
}

describe('local-agent-dsh-headless invariant', () => {
  it('accepts its own headless composition (no web marker)', async () => {
    await expect(mount(false)).resolves.toBeDefined()
  })

  it('fails clear when mounted into a web composition', async () => {
    await expect(mount(true)).rejects.toThrow(/sub-profile-only/)
  })
})
