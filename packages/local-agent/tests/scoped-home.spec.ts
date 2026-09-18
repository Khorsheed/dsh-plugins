import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import {
  DELEGATIONS_FILENAME,
  LOCAL_AGENT_SERVICE,
  assertResumeScopeUnchanged,
  assertScopeExecOnly,
  parseScopeFlag,
  scopedHomeName,
} from '@khorsheed/dsh-local-agent'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

/**
 * T29 — named scoped homes: one harness, several sibling directories under the
 * homes root, each holding its own login. The default scope's behavior is the
 * subject of the other specs in this package; what is pinned here is that a
 * NAMED scope is a different directory in every place a directory is used, and
 * that the default scope keeps resolving to exactly the path it always did.
 */

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function harness(over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name: 'fake',
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    records: { listSessions: async () => [] },
    ...over,
  }
}

interface Mounted {
  ctx: Context
  agent: Agent
  session: Session
  registry: localAgent.LocalAgentRegistry
}

/** The registry stack plus one idle parent agent, over a given homes root. */
async function mount(homesRoot: string): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(localAgent, { homesRoot })
  const session = ctx.sessions.create(SessionId('scoped-home'))
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: undefined as never,
    ctx: new Context(),
    get status() { return 'idle' as const },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent, session, registry: ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry }
}

function successText(execution: CommandExecution | undefined): string {
  const result = execution?.result
  expect(result).toMatchObject({ kind: 'success' })
  return result?.kind === 'success' ? result.text ?? '' : ''
}

function errorText(execution: CommandExecution | undefined): string {
  const result = execution?.result
  expect(result).toMatchObject({ kind: 'error' })
  return result?.kind === 'error' ? result.text ?? '' : ''
}

describe('scoped homes: the directory', () => {
  it('resolves the default scope to the unchanged path and a named scope to its sibling', async () => {
    const homesRoot = tempDir('scope-dir-')
    const { registry } = await mount(homesRoot)
    registry.register(harness())

    expect(registry.homeDir('fake')).toBe(join(homesRoot, 'fake'))
    expect(registry.homeDir('fake', 'eval-b')).toBe(join(homesRoot, 'fake@eval-b'))
    // A named scope is a SIBLING, never a child: nesting it would put a second
    // state tree inside a directory the harness's own CLI owns.
    expect(registry.homeDir('fake', 'eval-b').startsWith(`${join(homesRoot, 'fake')}/`)).toBe(false)
  })

  it('refuses anything that is not a [a-z0-9-] name — a scope can never be a path', async () => {
    const { registry } = await mount(tempDir('scope-bad-'))
    registry.register(harness())
    for (const bad of ['../escape', 'a/b', 'Eval', 'eval_b', '', ' ', 'evál']) {
      expect(() => registry.homeDir('fake', bad)).toThrow(/not a usable scope name/)
    }
    expect(scopedHomeName('fake', 'eval-b')).toBe('fake@eval-b')
    expect(scopedHomeName('fake')).toBe('fake')
  })

  it('materializes a named scope on first use: 0700 plus the harness provisioning, once', async () => {
    const homesRoot = tempDir('scope-lazy-')
    const { registry } = await mount(homesRoot)
    const provisioned: string[] = []
    registry.register(harness({
      provision: (dir) => { provisioned.push(dir); writeFileSync(join(dir, 'config.toml'), 'provisioned\n', 'utf8') },
    }))

    // Nothing exists until something names the scope.
    expect(existsSync(join(homesRoot, 'fake@eval-b'))).toBe(false)
    const dir = registry.homeDir('fake', 'eval-b')
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    // Provisioning is async and best-effort; it lands right after.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(provisioned).toEqual([dir])
    expect(readFileSync(join(dir, 'config.toml'), 'utf8')).toBe('provisioned\n')

    // Naming it again is free: no second mkdir-and-provision.
    registry.homeDir('fake', 'eval-b')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(provisioned).toEqual([dir])
  })

  it('provisionScope composes one scope deliberately: it waits, it takes options, and it answers', async () => {
    // The difference from materialization is the whole reason it exists. A
    // caller that asks for a preset needs the answer and needs the failure;
    // materialization is a side effect of naming a directory and swallows
    // both.
    const homesRoot = tempDir('scope-provision-')
    const { registry } = await mount(homesRoot)
    const seen: Array<{ dir: string; preset?: string }> = []
    registry.register(harness({
      provision: async (dir, options) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        seen.push({ dir, ...(options?.preset === undefined ? {} : { preset: options.preset }) })
        return { preset: options?.preset ?? 'deployment-wide', presetSnapshot: { matchesSource: true } }
      },
    }))
    const result = await registry.provisionScope('fake', 'eval-b', { preset: 'eval-lean' })
    expect(result.homeDir).toBe(join(homesRoot, 'fake@eval-b'))
    expect(result.preset).toBe('eval-lean')
    expect(result.presetSnapshot).toEqual({ matchesSource: true })
    // The materialization this call triggered ran first, with no options, and
    // did not interleave with the deliberate one — both writers regenerate
    // the same files.
    expect(seen).toEqual([{ dir: result.homeDir }, { dir: result.homeDir, preset: 'eval-lean' }])
  })

  it('provisionScope propagates the harness failure rather than logging it away', async () => {
    const { registry } = await mount(tempDir('scope-provision-fail-'))
    registry.register(harness({
      provision: (_dir, options) => {
        if (options?.preset !== undefined) throw new Error(`no preset ${JSON.stringify(options.preset)} in this deployment`)
      },
    }))
    await expect(registry.provisionScope('fake', 'eval-b', { preset: 'eval-lean' }))
      .rejects.toThrow(/no preset "eval-lean"/)
  })

  it('provisionScope on a harness with no hook is a no-op that still resolves the directory', async () => {
    const homesRoot = tempDir('scope-provision-none-')
    const { registry } = await mount(homesRoot)
    registry.register(harness())
    expect(await registry.provisionScope('fake', 'eval-b')).toEqual({ homeDir: join(homesRoot, 'fake@eval-b') })
  })

  it('leaves the default scope untouched: no provisioning hook, no new directory work', async () => {
    const homesRoot = tempDir('scope-default-')
    const { registry } = await mount(homesRoot)
    const provisioned: string[] = []
    registry.register(harness({ provision: (dir) => { provisioned.push(dir) } }))
    registry.homeDir('fake')
    await new Promise(resolve => setTimeout(resolve, 10))
    // The default scope is provisioned by the harness bundle's own apply, as
    // it always was — the registry hook is for named scopes only.
    expect(provisioned).toEqual([])
    expect(existsSync(join(homesRoot, 'fake'))).toBe(true)
  })
})

describe('scoped homes: status, sessions and logout', () => {
  it('reports each scope on its own credentials and directory', async () => {
    const homesRoot = tempDir('scope-status-')
    const { registry } = await mount(homesRoot)
    registry.register(harness({
      // "Logged in" means a marker file in THAT directory: nothing is copied
      // between scopes, so a fresh scope reads absent.
      isAuthenticated: async dir => existsSync(join(dir, 'auth.json')),
    }))
    writeFileSync(join(homesRoot, 'fake', 'auth.json'), '{}', 'utf8')

    const base = await registry.statusOf('fake')
    expect(base).toMatchObject({ credentialState: 'present-unverified', homeDir: join(homesRoot, 'fake') })
    expect('scope' in base).toBe(false)

    const scoped = await registry.statusOf('fake', 'eval-b')
    expect(scoped).toMatchObject({
      credentialState: 'absent',
      authenticated: false,
      scope: 'eval-b',
      homeDir: join(homesRoot, 'fake@eval-b'),
    })
  })

  it('grades delegation-reported auth per scope', async () => {
    const homesRoot = tempDir('scope-grade-')
    const { registry } = await mount(homesRoot)
    registry.register(harness({ isAuthenticated: async () => true }))
    registry.reportAuthSuccess('fake', 'eval-b')
    await expect(registry.statusOf('fake', 'eval-b')).resolves.toMatchObject({ credentialState: 'verified' })
    // The default scope heard nothing about it.
    await expect(registry.statusOf('fake')).resolves.toMatchObject({ credentialState: 'present-unverified' })
  })

  it('reads the effective-settings snapshot out of the scope it is asked about', async () => {
    const homesRoot = tempDir('scope-settings-')
    const { registry } = await mount(homesRoot)
    registry.register(harness({
      effectiveSettings: dir => ({ drive: 'exec', baseUrlSet: false, model: `model-of:${dir}` }),
    }))
    await expect(registry.effectiveSettings('fake')).resolves.toMatchObject({ model: `model-of:${join(homesRoot, 'fake')}` })
    await expect(registry.effectiveSettings('fake', 'eval-b')).resolves.toMatchObject({ model: `model-of:${join(homesRoot, 'fake@eval-b')}` })
  })

  it('lists a scope\'s own session records', async () => {
    const homesRoot = tempDir('scope-sessions-')
    const { registry } = await mount(homesRoot)
    registry.register(harness({ records: { listSessions: async dir => [{ id: 'only', workDir: dir }] } }))
    await expect(registry.sessionsOf('fake', 'eval-b')).resolves.toEqual([
      { id: 'only', workDir: join(homesRoot, 'fake@eval-b') },
    ])
  })

  it('takes --scope on the command family and signs the named scope out', async () => {
    const homesRoot = tempDir('scope-command-')
    const { ctx, agent, registry } = await mount(homesRoot)
    const loggedOut: string[] = []
    registry.register(harness({
      isAuthenticated: async dir => existsSync(join(dir, 'auth.json')),
      logout: async (dir) => { loggedOut.push(dir) },
    }))

    const status = await ctx.commands.execute(agent, '/fake status --scope eval-b', [], new AbortController().signal)
    const text = successText(status)
    expect(text).toContain('scope: eval-b')
    expect(text).toContain(`homeDir: ${join(homesRoot, 'fake@eval-b')}`)
    expect(text).toContain('credentialState: absent')

    const plain = successText(await ctx.commands.execute(agent, '/fake status', [], new AbortController().signal))
    expect(plain).not.toContain('scope:')
    expect(plain).toContain(`homeDir: ${join(homesRoot, 'fake')}`)

    await ctx.commands.execute(agent, '/fake logout --scope eval-b', [], new AbortController().signal)
    expect(loggedOut).toEqual([join(homesRoot, 'fake@eval-b')])
  })

  it('refuses an unusable scope name on the command channel instead of guessing', async () => {
    const { ctx, agent, registry } = await mount(tempDir('scope-command-bad-'))
    registry.register(harness())
    expect(errorText(await ctx.commands.execute(agent, '/fake status --scope ../escape', [], new AbortController().signal)))
      .toContain('never a path')
    expect(errorText(await ctx.commands.execute(agent, '/fake status --scope', [], new AbortController().signal)))
      .toContain('usage: --scope <name>')
  })

  it('parses both spellings of the flag and leaves a flagless input untouched', () => {
    expect(parseScopeFlag('status')).toEqual({ input: 'status' })
    expect(parseScopeFlag('status --scope eval-b')).toEqual({ input: 'status', scope: 'eval-b' })
    expect(parseScopeFlag('--scope=eval-b login')).toEqual({ input: 'login', scope: 'eval-b' })
    expect(parseScopeFlag('code ABC --scope eval-b')).toEqual({ input: 'code ABC', scope: 'eval-b' })
  })

  it('hands a harness subcommand the raw input, flag included', async () => {
    const { ctx, agent, registry } = await mount(tempDir('scope-subcommand-'))
    const seen: string[] = []
    registry.register(harness({
      subcommand: (input) => {
        seen.push(input)
        return { kind: 'success', text: 'extra' }
      },
    }))
    await ctx.commands.execute(agent, '/fake preset x --scope eval-b', [], new AbortController().signal)
    expect(seen).toEqual(['preset x --scope eval-b'])
  })
})

describe('scoped homes: delegation records', () => {
  it('writes a scoped delegation into that scope\'s own log and restores it after a restart', async () => {
    const homesRoot = tempDir('scope-records-')
    const first = await mount(homesRoot)
    first.registry.register(harness({ delegationProvider: 'fake-cli' }))
    first.registry.recordDelegation({
      childSessionId: 'child-scoped',
      provider: 'fake-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'cli-1',
      cwd: '/w',
      scope: 'eval-b',
    })
    first.registry.recordDelegation({
      childSessionId: 'child-default',
      provider: 'fake-cli',
      parentSessionId: 'parent-1',
      cliSessionId: 'cli-2',
      cwd: '/w',
    })

    const scopedLog = readFileSync(join(homesRoot, 'fake@eval-b', DELEGATIONS_FILENAME), 'utf8')
    expect(scopedLog).toContain('child-scoped')
    expect(scopedLog).not.toContain('child-default')
    const defaultLog = readFileSync(join(homesRoot, 'fake', DELEGATIONS_FILENAME), 'utf8')
    expect(defaultLog).toContain('child-default')
    expect(defaultLog).not.toContain('child-scoped')

    // A restart restores the default scope at register time and the named one
    // when something names it.
    const second = await mount(homesRoot)
    second.registry.register(harness({ delegationProvider: 'fake-cli' }))
    expect(second.registry.delegationOf('child-default')).toMatchObject({ cwd: '/w' })
    expect(second.registry.delegationOf('child-scoped')).toBeUndefined()
    second.registry.homeDir('fake', 'eval-b')
    expect(second.registry.delegationOf('child-scoped')).toMatchObject({ scope: 'eval-b', cwd: '/w' })
  })

  it('refuses a resume that changes scope — in either direction', () => {
    const scoped = { childSessionId: 'c', provider: 'p', parentSessionId: 'parent', cliSessionId: 'cli', scope: 'eval-b' }
    const plain = { childSessionId: 'c', provider: 'p', parentSessionId: 'parent', cliSessionId: 'cli' }
    expect(() => assertResumeScopeUnchanged(scoped, 'eval-b', 'subagent-fake')).not.toThrow()
    expect(() => assertResumeScopeUnchanged(plain, undefined, 'subagent-fake')).not.toThrow()
    expect(() => assertResumeScopeUnchanged(scoped, undefined, 'subagent-fake')).toThrow(/resume scope \(default\) differs/)
    expect(() => assertResumeScopeUnchanged(scoped, 'other', 'subagent-fake')).toThrow(/resume scope other differs/)
    expect(() => assertResumeScopeUnchanged(plain, 'eval-b', 'subagent-fake')).toThrow(/differs from the first round's \(default\)/)
    // No record at all: the caller's own resolveDelegation refuses that first.
    expect(() => assertResumeScopeUnchanged(undefined, 'eval-b', 'subagent-fake')).not.toThrow()
  })

  it('refuses a scoped round that would be served by a live driver', () => {
    expect(() => assertScopeExecOnly(undefined, 'subagent-fake')).not.toThrow()
    expect(() => assertScopeExecOnly('eval-b', 'subagent-fake')).toThrow(/exec-only/)
  })
})
