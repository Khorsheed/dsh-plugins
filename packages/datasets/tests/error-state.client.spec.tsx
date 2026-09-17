// @vitest-environment jsdom
/**
 * The three-part error seat (ui-spec §九) and, more importantly, the tie
 * between its classifier and the sentences the HOST actually emits.
 *
 * The domain cause does not survive the Remote wire — a failure arrives under
 * one of the gateway's transport codes — so `classifyError` reads the message
 * text. That is only safe while the host's wording and the classifier's
 * markers agree, which is what the first block here checks: it drives the real
 * service into each failure and hands the real message to the real classifier.
 * Reword one of those messages and this fails, rather than the tab silently
 * degrading to its unknown-cause copy in front of a user.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup as unmount, render, screen } from '@testing-library/react'
import { createDatasetsService, resolveScope } from '../src/service.ts'
import { DatasetsError } from '../src/dataset.ts'
import { classifyError, ErrorState } from '../src/client/ErrorState.tsx'
import { cleanup } from './helpers.ts'

const roots: string[] = []

afterEach(() => {
  unmount()
  for (const root of roots.splice(0)) cleanup(root)
})

/** A service core over throwaway roots. */
function service() {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-'))
  const bindingsRoot = mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-'))
  roots.push(worktreeRoot, bindingsRoot)
  return createDatasetsService({ worktreeRoot, bindingsRoot })
}

/** The message of a call that must fail. */
async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to fail')
}

describe('the classifier answers to the host, not to a fixture string', () => {
  it('recognizes a path that is not a git repository', async () => {
    const message = await failureOf(async () => await service().assertRepository(mkdtempSync(join(tmpdir(), 'dsh-datasets-bare-'))))
    expect(classifyError(message)).toBe('notGitRepo')
  })

  it('recognizes a path that is not on disk', async () => {
    const message = await failureOf(async () => await service().assertRepository('/nonexistent-dataset-repo-for-this-test'))
    // Answered before git runs: git's own complaint about a cwd it cannot
    // enter is "not a git repository" with an empty stderr, which would send
    // the reader to fix the wrong thing.
    expect(classifyError(message)).toBe('pathMissing')
  })

  it('recognizes a session with nothing bound', () => {
    let message = ''
    try {
      resolveScope({}, undefined, undefined)
    } catch (error) {
      message = error instanceof DatasetsError ? error.message : String(error)
    }
    expect(classifyError(message)).toBe('unbound')
  })
})

describe('classifyError', () => {
  it('prefers the specific complaint over the general one', () => {
    // A dataset repository IS a git repository; the order must not invert.
    expect(classifyError('not a dataset repository (no datasets/ directory): /x')).toBe('notDatasetRepo')
  })

  it('separates "no repository bound" from "not a repository"', () => {
    expect(classifyError('no dataset repository: pass `repo` explicitly, or bind one first')).toBe('unbound')
    expect(classifyError('/x is not a git repository: GitError: …')).toBe('notGitRepo')
  })

  it('recognizes a missing service and a cancelled call', () => {
    expect(classifyError('no mission service: run records live in the mission ledger')).toBe('serviceMissing')
    expect(classifyError('The call was cancelled by the carrier signal')).toBe('cancelled')
  })

  it('says unknown rather than guessing', () => {
    expect(classifyError('client api: datasets/list expected 2 argument(s), got 1')).toBe('unknown')
  })
})

describe('the seat itself', () => {
  const t = ((key: string) => key) as never

  it('shows the cause and the fix, and folds the raw text and the path away', () => {
    render(
      <ErrorState
        what="list.error"
        message={'/repo is not a git repository: GitError: git rev-parse --show-toplevel failed'}
        path="/repo"
        t={t}
      />,
    )
    expect(screen.getByText('error.notGitRepo')).toBeTruthy()
    expect(screen.getByText('error.notGitRepo.fix')).toBeTruthy()
    // The page itself never carries the exception or the path: both live under
    // the fold, which is closed until the reader opens it.
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('rev-parse --show-toplevel')
    expect(details.textContent).toContain('/repo')
  })

  it('keeps the caller’s sentence as the headline when the cause is unrecognized', () => {
    render(<ErrorState what="list.error" message="client api: expected 2 argument(s), got 1" t={t} />)
    expect(screen.getByText('list.error')).toBeTruthy()
    expect(screen.getByText('error.unknownFix')).toBeTruthy()
  })
})
