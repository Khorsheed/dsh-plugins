/**
 * The kimi `model` key. On the exec argv: unset, both argv variants are
 * byte-identical to the shapes that shipped before the key rode every round;
 * set, `-m <model>` sits immediately before `-p` (after `-p` the CLI reads the
 * next token as its prompt, and a resume id must still lead). And the resident
 * path's lever, `writeKimiDefaultModel`, since `kimi acp` takes no model flag.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { startKimiCliRun } from '../src/kimi-cli-provider.ts'
import { readKimiDefaultModel, writeKimiDefaultModel } from '../src/provision.ts'

/** A child that prints one reply and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push('• done\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4242,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => {
      setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
    }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

const request = {
  prompt: [{ type: 'text', text: '建个文件' }],
  parent: { session: { header: { cwd: '/tmp' } } },
  signal: new AbortController().signal,
} as unknown as SubagentStartRequest

/** Run one round and return the argv it spawned. */
async function argvOf(over: Partial<Parameters<typeof startKimiCliRun>[1]>): Promise<readonly string[]> {
  const homeDir = mkdtempSync(join(tmpdir(), 'kimi-model-argv-'))
  const spawned: SubprocessSpawnSpec[] = []
  const run = await startKimiCliRun(request, {
    cwd: '/tmp',
    env: { KIMI_CODE_HOME: homeDir },
    disposeGraceMs: 3_000,
    homeDir,
    spawn: (spec) => {
      spawned.push(spec)
      return stubChild()
    },
    ...over,
  })
  await run.result
  return spawned[0]!.argv
}

describe('kimi model key on the exec argv', () => {
  it('unset: the fresh argv is exactly the pre-key shape', async () => {
    await expect(argvOf({})).resolves.toEqual(['kimi', '-p', '建个文件'])
  })

  it('unset: the resume argv is exactly the pre-key shape', async () => {
    await expect(argvOf({ resume: { cliSessionId: 'abc', turn: 2 } })).resolves.toEqual(
      ['kimi', '-S', 'session_abc', '-p', '建个文件'],
    )
  })

  it('set: the fresh argv carries -m immediately before -p', async () => {
    await expect(argvOf({ model: 'kimi-code/k3' })).resolves.toEqual(
      ['kimi', '-m', 'kimi-code/k3', '-p', '建个文件'],
    )
  })

  it('set: a resume round runs the same model, with -S still leading', async () => {
    const argv = await argvOf({ model: 'kimi-code/k3', resume: { cliSessionId: 'abc', turn: 2 } })
    expect(argv).toEqual(['kimi', '-S', 'session_abc', '-m', 'kimi-code/k3', '-p', '建个文件'])
    expect(argv.indexOf('-S')).toBeLessThan(argv.indexOf('-m'))
    expect(argv.indexOf('-m')).toBeLessThan(argv.indexOf('-p'))
  })
})

describe('writeKimiDefaultModel — the resident path lever', () => {
  /** A scoped home whose config names `model` as its default. */
  function homeWith(config: string): string {
    const home = mkdtempSync(join(tmpdir(), 'kimi-model-config-'))
    writeFileSync(join(home, 'config.toml'), config)
    return home
  }

  it('replaces the top-level default_model in place and leaves the rest byte-identical', async () => {
    const home = homeWith([
      '# a comment the write must not eat',
      'default_model = "old-model"',
      '',
      '[thinking]',
      'effort = "high"',
      '',
      '[models."new-model"]',
      'provider = "managed:kimi-code"',
      'default_model = "not-this-one"',
      '',
    ].join('\n'))
    await expect(writeKimiDefaultModel(home, 'new-model')).resolves.toBe(true)
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe([
      '# a comment the write must not eat',
      'default_model = "new-model"',
      '',
      '[thinking]',
      'effort = "high"',
      '',
      '[models."new-model"]',
      'provider = "managed:kimi-code"',
      // A same-named key INSIDE a table is a different key; only the
      // top-level one is the CLI's default selection.
      'default_model = "not-this-one"',
      '',
    ].join('\n'))
    await expect(readKimiDefaultModel(home)).resolves.toBe('new-model')
  })

  it('adds the key when the config has none at the top level', async () => {
    const home = homeWith('[thinking]\neffort = "high"\n')
    await expect(writeKimiDefaultModel(home, 'new-model')).resolves.toBe(true)
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(
      'default_model = "new-model"\n[thinking]\neffort = "high"\n',
    )
  })

  it('rewrites nothing when the config already names that model', async () => {
    const home = homeWith('default_model = "same"\n')
    await expect(writeKimiDefaultModel(home, 'same')).resolves.toBe(true)
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe('default_model = "same"\n')
  })

  it('leaves an absent config absent — provisioning owns creation', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kimi-model-noconfig-'))
    await expect(writeKimiDefaultModel(home, 'new-model')).resolves.toBe(false)
    expect(() => readFileSync(join(home, 'config.toml'), 'utf8')).toThrow()
  })

  it('escapes a value TOML would otherwise misparse', async () => {
    const home = homeWith('default_model = "old"\n')
    await writeKimiDefaultModel(home, 'we"ird\\one')
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe('default_model = "we\\"ird\\\\one"\n')
  })
})
