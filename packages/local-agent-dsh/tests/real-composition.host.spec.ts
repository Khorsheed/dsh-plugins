/**
 * REAL-composition toggle test: a live cordis tree with the real local-agent
 * registry, subagent runtime, and tool runtime, mounting the REAL family tool
 * module through cordis's own `ctx.plugin`. Toggling the namespace OFF must
 * REMOVE the harness, the provider, and the tool from the live registries —
 * not merely call their disposers. The stub-fiber apply spec proves the
 * controller calls dispose; this spec proves dispose detaches.
 */

import * as toolEntry from '../src/tool.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as localAgentCore from '@khorsheed/dsh-local-agent'
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
  parent: Agent
}> {
  const ctx = new Context()
  // Real registries the controller registers into and the real tool module
  // mounts against.
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // Host 0.2.1: the runtime's static inject requires workingDirectory (the
  // manager resolves the child directory through it; the probe below relies
  // on its failure), and startActivation's manager exists only with the
  // agents service mounted.
  ctx.provide('workingDirectory', {
    ensure: async () => { throw new Error('no working directory') },
  } as never)
  await ctx.plugin(AgentRegistry)
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
  // The activation probe's exact live parent (host 0.2.1 startActivation
  // compares identity against the registry); its session carries no cwd, so
  // the workingDirectory stub's rejection stands in for the provider's own
  // 0.2.0-era 'no working directory' start error.
  const id = SessionId('parent-1')
  const parent = { id, session: { id, header: {} } } as unknown as Agent
  ctx.agents.enter(parent, undefined)
  return {
    ctx,
    parent,
    setEnabled: (enabled) => {
      current = { enabled }
      for (const watcher of [...watchers]) watcher(current)
    },
  }
}

/** A caller-delivered activation probe: a REGISTERED dsh-cli provider reaches the
 * manager's directory resolution, whose stub rejects with 'no working directory',
 * while an unregistered provider is rejected by name before any of that. */
function startDshCli(ctx: Context, parent: Agent): Promise<unknown> {
  return ctx.subagents.startActivation({
    provider: 'dsh-cli',
    label: 'probe',
    request: { prompt: [], parent },
    signal: new AbortController().signal,
    delivery: 'caller',
  })
}

describe('local-agent-dsh (real composition)', () => {
  it('registers the harness and provider even when the profile still says enabled: false; ./tool grants the tool; the card store drives live', async () => {
    const { ctx, setEnabled, parent } = await boot(false)

    // Always on: harness registered in the real registry, provider
    // dispatchable; the tool is NOT at the root (a preset grants ./tool).
    expect(ctx.localAgent.get('dsh')).toBeDefined()
    expect(ctx.localAgent.roster().map(row => row.name)).toContain('dsh')
    expect(ctx.subagents.list()).toContain('dsh-cli')
    expect(ctx.tools.get('subagent_dsh')).toBeUndefined()

    // The ./tool entry, mounted the way a preset row mounts it, registers the tool.
    await ctx.plugin(toolEntry)
    await vi.waitFor(() => { expect(ctx.tools.get('subagent_dsh')).toBeDefined() }, { timeout: 5000 })
    await expect(startDshCli(ctx, parent)).rejects.toThrow('no working directory')

    // A leftover enabled write changes nothing.
    setEnabled(false)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.localAgent.get('dsh')).toBeDefined()

    // The card's writes go to the harness's own store, not the profile patch,
    // and win over the row config on the next read; clearing falls back to it
    // (this fixture's row carries no live, so exec).
    const harness = ctx.localAgent.get('dsh')!
    const home = ctx.localAgent.homeDir('dsh')
    expect((await harness.effectiveSettings!(home)).drive).toBe('exec')
    ctx.localAgent.setCardSettings('dsh', { live: true })
    expect(ctx.localAgent.cardSettings('dsh')).toEqual({ live: true })
    expect((await harness.effectiveSettings!(home)).drive).toBe('live')
    ctx.localAgent.setCardSettings('dsh', { live: null })
    expect(ctx.localAgent.cardSettings('dsh')).toEqual({})
    expect((await harness.effectiveSettings!(home)).drive).toBe('exec')
  })
})
