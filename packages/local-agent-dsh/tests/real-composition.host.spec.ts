/**
 * REAL-composition toggle test: a live cordis tree with the real local-agent
 * registry, subagent runtime, and tool runtime, mounting the REAL family tool
 * module through cordis's own `ctx.plugin`. Toggling the namespace OFF must
 * REMOVE the harness, the provider, and the tool from the live registries —
 * not merely call their disposers. The stub-fiber apply spec proves the
 * controller calls dispose; this spec proves dispose detaches.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgentCore from '@khorsheed/dsh-local-agent'
import * as toolModule from '@khorsheed/dsh-local-agent-tool-subagent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as localAgentDsh from '../src/index.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
})

/** Boot the real composition with the DeepSeek toggle at a given state. */
async function boot(initialEnabled: boolean): Promise<{
  ctx: Context
  setEnabled: (enabled: boolean) => void
}> {
  const ctx = new Context()
  // Real registries the controller registers into and the real tool module
  // mounts against.
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(localAgentCore, { homesRoot: mkdtempSync(join(tmpdir(), 'dsh-realcomp-')) })
  // External faces the controller reads; subprocess spawn is never exercised
  // (no delegation is started in this spec).
  let current = { enabled: initialEnabled }
  const watchers: Array<(next: { enabled: boolean }) => void> = []
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
  ctx.provide('credentials', { resolve: async () => undefined })
  ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in real-composition test') } })
  ctx.provide('logger', { warn: () => {}, info: () => {}, error: () => {} })
  // The controller module carries `inject`; a bare function would mount
  // without the injected service scope and fail on ctx.localAgent.
  await ctx.plugin(localAgentDsh, {})
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    ctx,
    setEnabled: (enabled) => {
      current = { enabled }
      for (const watcher of [...watchers]) watcher(current)
    },
  }
}

/** A request with no parent cwd: a REGISTERED dsh-cli provider rejects it with its own
 * start-time error, while an unregistered provider is rejected by the manager by name. */
function startDshCli(ctx: Context): Promise<unknown> {
  return ctx.subagents.start('dsh-cli', {
    prompt: [],
    parent: { session: { header: {} } },
  } as unknown as SubagentStartRequest)
}

describe('local-agent-dsh toggle (real composition)', () => {
  it('registers the harness, provider, and tool while ON, and REALLY removes them on OFF', async () => {
    const { ctx, setEnabled } = await boot(true)

    // ON: harness registered in the real registry, tool visible in the real
    // tool runtime, provider dispatchable.
    expect(ctx.localAgent.get('dsh')).toBeDefined()
    expect(ctx.localAgent.roster().map(row => row.name)).toContain('dsh')
    await vi.waitFor(() => {
      expect(ctx.tools.get('subagent_dsh')).toBeDefined()
    }, { timeout: 5000 })
    expect(ctx.subagents.list()).toContain('dsh-cli')
    // The registered provider dispatches and answers with its own start-time error.
    expect(ctx.subagents.getProvider('dsh-cli')).toBeDefined()
    await expect(startDshCli(ctx)).rejects.toThrow('no working directory')

    // OFF: everything the toggle owns is detached from the live registries —
    // the harness is gone from the roster, the provider is no longer
    // dispatchable, and the tool is no longer visible to any agent.
    setEnabled(false)
    await vi.waitFor(() => {
      expect(ctx.localAgent.get('dsh')).toBeUndefined()
      expect(ctx.localAgent.roster()).toEqual([])
      expect(ctx.tools.get('subagent_dsh')).toBeUndefined()
      expect(ctx.subagents.list()).not.toContain('dsh-cli')
    })
    // The provider is really gone: the manager rejects it by name, and the
    // start-time dispatch never reaches the provider.
    expect(ctx.subagents.getProvider('dsh-cli')).toBeUndefined()
    await expect(startDshCli(ctx)).rejects.toThrow('no subagent provider registered')

    // ON again: the composition restores.
    setEnabled(true)
    await vi.waitFor(() => {
      expect(ctx.localAgent.get('dsh')).toBeDefined()
      expect(ctx.tools.get('subagent_dsh')).toBeDefined()
    })
  })
})
