/**
 * The dsh harness toggle controller: OFF (default) mounts nothing model-
 * visible; ON registers the harness, provider, and the delegation tool; the
 * settings watch flips the composition live.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('local-agent-dsh toggle controller', () => {
  it('registers nothing while the DeepSeek toggle is off (default)', () => {
    const ctx = new Context()
    const registered: LocalAgentHarness[] = []
    const providers: unknown[] = []
    const home = mkdtempSync(join(tmpdir(), 'dsh-apply-off-'))
    let mountedTools = 0
    ctx.provide('localAgent', {
      homeDir: () => home,
      register: (harness: LocalAgentHarness) => { registered.push(harness); return () => {} },
    })
    ctx.provide('subagents', { registerProvider: (provider: unknown) => { providers.push(provider); return () => {} } })
    ctx.provide('credentials', { resolve: async () => undefined })
    ctx.provide('logger', { warn: () => {}, info: () => {} })
    ctx.provide('settings', {
      register: () => ({ get: () => ({ enabled: false }), watch: () => () => {}, update: async () => {}, replace: async () => {} }),
    })
    // The tool mount path must not run while off.
    ctx.plugin = (() => { mountedTools += 1; return { then: () => Promise.resolve() } }) as never

    apply(ctx, {})

    expect(registered).toHaveLength(0)
    expect(providers).toHaveLength(0)
    expect(mountedTools).toBe(0)
  })

  it('registers the harness, provider, and tool while on, and the watch toggles them live', () => {
    const ctx = new Context()
    const registered: LocalAgentHarness[] = []
    const providers: unknown[] = []
    const home = mkdtempSync(join(tmpdir(), 'dsh-apply-on-'))
    const mountedTools: unknown[] = []
    let current = { enabled: true }
    const watchers: Array<(next: { enabled: boolean }) => void> = []
    ctx.provide('localAgent', {
      homeDir: () => home,
      register: (harness: LocalAgentHarness) => {
        registered.push(harness)
        return () => { registered.splice(registered.indexOf(harness), 1) }
      },
    })
    ctx.provide('subagents', {
      registerProvider: (provider: unknown) => {
        providers.push(provider)
        return () => { providers.splice(providers.indexOf(provider), 1) }
      },
    })
    ctx.provide('credentials', { resolve: async () => undefined })
    ctx.provide('logger', { warn: () => {}, info: () => {} })
    ctx.provide('settings', {
      register: () => ({
        get: () => current,
        watch: (callback: (next: { enabled: boolean }) => void) => {
          watchers.push(callback)
          return () => { watchers.splice(watchers.indexOf(callback), 1) }
        },
        update: async () => {},
        replace: async () => {},
      }),
    })
    ctx.plugin = ((plugin: unknown, config: unknown) => {
      mountedTools.push({ plugin, config })
      return { then: (onFulfilled: (fiber: { dispose: () => Promise<void> }) => void) => {
        onFulfilled({ dispose: () => Promise.resolve() })
      } }
    }) as never

    apply(ctx, {})

    // ON: harness + provider registered, tool mounted for dsh-cli.
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      delegationProvider: 'dsh-cli',
    })
    expect(providers).toHaveLength(1)
    expect(mountedTools).toHaveLength(1)
    const tool = mountedTools[0] as { config: { provider: string; toolName: string } }
    expect(tool.config).toEqual({ provider: 'dsh-cli', toolName: 'subagent_dsh' })

    // Flip OFF through the settings watch: everything model-visible disposes.
    current = { enabled: false }
    watchers[0]?.(current)
    expect(registered).toHaveLength(0)
    expect(providers).toHaveLength(0)
  })
})
