/**
 * The sub-dsh one-shot app's ordinary command-line provider over a real Loader
 * tree: the task and the caller-supplied session flags become injected runner
 * config, while help and usage errors leave the consumer pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE, type LocalAgentDshHeadlessStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider over a runner stand-in.
 * @param args - the invocation's inner arguments.
 * @returns the resolved service value and observed runner/process effects.
 */
async function bootStartup(args: string[]): Promise<{ task: LocalAgentDshHeadlessStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-headless-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__headlessStartupObserved.runnerConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'local-agent-dsh-headless-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__headlessStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: local-agent-dsh-headless-runner',
    `  name: ${rowUrl}`,
    `  inject: [${LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE}]`,
    '  config:',
    '    task: !!js ctx.localAgentDshHeadlessStartup.task',
    '    sessionId: !!js ctx.localAgentDshHeadlessStartup.sessionId',
    '    resumeSessionId: !!js ctx.localAgentDshHeadlessStartup.resumeSessionId',
    // Mirrors the shipped patch row, so the fixture proves the same wiring.
    '    model: !!js ctx.localAgentDshHeadlessStartup.model',
    '    effort: !!js ctx.localAgentDshHeadlessStartup.effort',
    '- id: local-agent-dsh-headless-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __headlessStartupApply: typeof apply
    __headlessStartupObserved: Observed
  }
  globals.__headlessStartupApply = apply
  globals.__headlessStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    task: ctx.get(LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE) as LocalAgentDshHeadlessStartupValues | undefined,
    observed,
  }
}

describe('sub-dsh headless command-line provider', () => {
  it('joins the task positional and the session flag into the runner config', async () => {
    const { task, observed } = await bootStartup(['--session-id', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'run', 'the', 'tests'])
    expect(task).toEqual({ task: 'run the tests', sessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' })
    expect(observed.runnerConfig).toEqual({ task: 'run the tests', sessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' })
    expect(observed.exits).toEqual([])
  })

  it('maps the resume flag into the runner config', async () => {
    const { task, observed } = await bootStartup(['--resume', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'continue'])
    expect(task).toEqual({ task: 'continue', resumeSessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' })
    expect(observed.runnerConfig).toEqual({ task: 'continue', resumeSessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' })
    expect(observed.exits).toEqual([])
  })

  it.each([{ args: [] }, { args: ['   '] }])('rejects an invocation with no non-whitespace task ($args)', async ({ args }) => {
    const { task, observed } = await bootStartup(args)
    expect(observed.out).toContain('a task is required')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('carries --model into the runner config beside the session flag', async () => {
    const { task, observed } = await bootStartup(
      ['--model', 'deepseek-official/deepseek-v4-pro', '--session-id', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'run'],
    )
    expect(task).toEqual({ task: 'run', sessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', model: 'deepseek-official/deepseek-v4-pro' })
    expect(observed.runnerConfig).toMatchObject({ model: 'deepseek-official/deepseek-v4-pro' })
    expect(observed.exits).toEqual([])
  })

  it('carries --model in serve mode too — a resident process binds one model', async () => {
    const { task } = await bootStartup(['--serve', '--model', 'deepseek-official/deepseek-v4-pro'])
    expect(task).toEqual({ task: '', serve: true, model: 'deepseek-official/deepseek-v4-pro' })
  })

  it('carries native effort through both resumed exec and resident startup configuration', async () => {
    const resumed = await bootStartup(['--resume', 'prior', '--effort', 'high', 'continue'])
    expect(resumed.task).toMatchObject({ resumeSessionId: 'prior', effort: 'high' })
    expect(resumed.observed.runnerConfig).toMatchObject({ effort: 'high' })
    const live = await bootStartup(['--serve', '--effort', 'low'])
    expect(live.task).toMatchObject({ serve: true, effort: 'low' })
    expect(live.observed.runnerConfig).toMatchObject({ effort: 'low' })
  })

  it('leaves the runner config without a model when the flag is absent', async () => {
    const { task } = await bootStartup(['--resume', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'continue'])
    expect('model' in (task as object)).toBe(false)
  })

  it('rejects both session flags together', async () => {
    const { task, observed } = await bootStartup(['--session-id', 'a', '--resume', 'b', 'task'])
    expect(observed.out).toContain('mutually exclusive')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('publishes serve mode with no task', async () => {
    const { task, observed } = await bootStartup(['--serve'])
    expect(task).toEqual({ task: '', serve: true })
    expect(observed.exits).toEqual([])
  })

  it('rejects --serve combined with a task or session flags', async () => {
    const withTask = await bootStartup(['--serve', 'some', 'task'])
    expect(withTask.observed.out).toContain('--serve takes no task')
    expect(withTask.task).toBeUndefined()
    expect(withTask.observed.exits).toEqual([1])
    const withFlag = await bootStartup(['--serve', '--session-id', 'a'])
    expect(withFlag.observed.out).toContain('do not apply')
    expect(withFlag.task).toBeUndefined()
    expect(withFlag.observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { task, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile headless-local-agent-dsh')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
