// @vitest-environment jsdom
/**
 * The three-part error seat (ui-spec §九) and the tie between its classifier
 * and the sentences THIS host emits.
 *
 * A Remote failure crosses the wire under one of the gateway's transport
 * codes, so the domain cause survives only inside `message` and the seat has
 * to read it. That is safe exactly while the host's wording and the
 * classifier's markers agree — so the first block drives the real service into
 * each refusal and hands the real message to the real classifier. Reword one
 * and this fails here, rather than the 实验室 tab quietly degrading to its
 * unknown-cause copy in front of a user.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup as unmount, render, screen } from '@testing-library/react'
import { EvalService } from '../src/service.ts'
import { classifyError, ErrorState } from '../src/client/ErrorState.tsx'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(() => {
  unmount()
  cleanupTmp()
})

/** The message of a call that must fail. */
async function failureOf(run: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to fail')
}

describe('the classifier answers to the host, not to a fixture string', () => {
  it('recognizes a repository that holds no datasets/', async () => {
    // A directory that IS there and simply has no datasets/ — the other half
    // of this pair is a path that is not there at all, and the two get
    // different fixes.
    const repo = join(tmpTree(), 'not-a-dataset-repo')
    mkdirSync(repo, { recursive: true })
    const message = await failureOf(() => new EvalService().conditions({ repo }))
    expect(classifyError(message)).toBe('notDatasetRepo')
  })

  it('recognizes a repository path that is not on disk at all', async () => {
    const repo = join(tmpTree(), 'never-created')
    const message = await failureOf(() => new EvalService().conditions({ repo }))
    expect(classifyError(message)).toBe('pathMissing')
  })

  it('recognizes a session with nothing bound', async () => {
    const message = await failureOf(() => new EvalService().conditions({ session: { id: 's1' } }))
    expect(classifyError(message)).toBe('unbound')
  })

  it('recognizes a composition that mounts no mission service', async () => {
    const message = await failureOf(() => new EvalService().experiment('run-1'))
    expect(classifyError(message)).toBe('serviceMissing')
  })
})

describe('classifyError', () => {
  it('prefers the specific complaint over the general one', () => {
    // A dataset repository IS a git repository; the order must not invert.
    expect(classifyError('not a dataset repository (no datasets/ directory): /x')).toBe('notDatasetRepo')
    expect(classifyError('/x is not a git repository: GitError: git rev-parse --show-toplevel failed')).toBe('notGitRepo')
  })

  it('recognizes a path that is not on disk, and a cancelled call', () => {
    expect(classifyError("ENOENT: no such file or directory, open '/x/plan.json'")).toBe('pathMissing')
    expect(classifyError('The call was cancelled by the carrier signal')).toBe('cancelled')
  })

  it('says unknown rather than guessing', () => {
    expect(classifyError('client api: dshEval/runOutput expected 2 argument(s), got 1')).toBe('unknown')
  })
})

describe('the seat itself', () => {
  const t = ((key: string) => key) as never

  it('shows the cause and the fix, and folds the raw text and the path away', () => {
    render(
      <ErrorState
        what="conditions.error"
        message="not a dataset repository (no datasets/ directory): /repo"
        path="/repo"
        t={t}
      />,
    )
    expect(screen.getByText('error.notDatasetRepo')).toBeTruthy()
    expect(screen.getByText('error.notDatasetRepo.fix')).toBeTruthy()
    // Neither the exception nor the path is on the page: both are under the
    // fold, which is closed until the reader opens it.
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('no datasets/ directory')
    expect(details.textContent).toContain('/repo')
  })

  it('keeps the caller’s sentence as the headline when the cause is unrecognized', () => {
    render(<ErrorState what="report.error" message="client api: expected 2 argument(s), got 1" t={t} />)
    expect(screen.getByText('report.error')).toBeTruthy()
    expect(screen.getByText('error.unknownFix')).toBeTruthy()
  })
})
