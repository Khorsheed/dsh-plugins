/**
 * G5 of the I5 walkthrough: a session bound to `~/…` made the 实验室 › 条件
 * page report «not a dataset repository» about a repository that exists.
 * `readdir` does not expand `~`, and no shell is in the loop when the web tab
 * writes a binding, so the repository root every read verb resolves has to be
 * canonical before it leaves `resolveRepoScope`.
 */
import { mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EvalService } from '../src/service.ts'
import { normalizeRepoPath } from '../src/validate.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

const realHome = process.env['HOME']

afterEach(() => {
  // `os.homedir()` reads $HOME on POSIX, which is how the ~ cases below get a
  // home they may write into.
  if (realHome === undefined) delete process.env['HOME']
  else process.env['HOME'] = realHome
  cleanupTmp()
})

const CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: '0.1.0', drive: 'exec' },
  model: { declared: 'deepseek-official/deepseek-v4-flash', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: [] },
}

describe('normalizeRepoPath', () => {
  it('expands a leading ~, makes the path absolute, and resolves symlinks', () => {
    const home = realpathSync(homedir())
    expect(normalizeRepoPath('~')).toBe(home)
    expect(normalizeRepoPath('~/repo/')).toBe(join(home, 'repo'))
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-norm-'))
    expect(normalizeRepoPath(`  ${dir}/  `)).toBe(realpathSync(dir))
  })

  it('leaves a directory whose NAME starts with ~ alone', () => {
    expect(normalizeRepoPath('/tmp/~notme')).toBe('/tmp/~notme')
  })

  it('keeps a path that is not there rather than failing', () => {
    expect(normalizeRepoPath('/nonexistent-eval-repo-for-this-test/')).toBe('/nonexistent-eval-repo-for-this-test')
  })
})

describe('a session bound with a literal ~ still reads (G5)', () => {
  it('lists the conditions of ~/<repo> instead of refusing it as not a dataset repository', async () => {
    const home = tmpTree()
    process.env['HOME'] = home
    writeJson(join(home, 'repo', 'datasets', 'ds'), 'conditions/c1.json', CONDITION)

    // The binding as the pre-G5 store recorded it: the path the human typed.
    const datasets = { binding: () => ({ repoPath: '~/repo' }) }
    const service = new EvalService({ get: name => (name === 'datasets' ? datasets : undefined) })

    const report = await service.conditions({ session: { id: 's1' } })
    expect(report.repo).toBe(join(realpathSync(home), 'repo'))
    expect(report.conditions.map(entry => entry.id)).toEqual(['c1'])
  })
})
