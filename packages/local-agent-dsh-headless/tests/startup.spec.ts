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

  it('rejects both session flags together', async () => {
    const { task, observed } = await bootStartup(['--session-id', 'a', '--resume', 'b', 'task'])
    expect(observed.out).toContain('mutually exclusive')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { task, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile headless-local-agent-dsh')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
