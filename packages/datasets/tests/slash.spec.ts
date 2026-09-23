/**
 * The `/datasets` slash face after the preset-visibility rollout (A3): the
 * handler itself (usage, bind/unbind, the default-repo fallback) plus the
 * grant backstop — refuse only when the session's preset composition is
 * readable and names no `@khorsheed/dsh-datasets-tool` row; every unreadable
 * path fails open.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createDatasetsService, type DatasetsService } from '../src/service.ts'
import { BIND_RETIRED, handleDatasetsCommand } from '../src/slash.ts'
import { cleanup, stateOptions } from './helpers.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) cleanup(root)
})

function service(defaultRepo = ''): DatasetsService {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'dsh-datasets-slash-wt-'))
  const bindingsRoot = mkdtempSync(join(tmpdir(), 'dsh-datasets-slash-bind-'))
  roots.push(worktreeRoot, bindingsRoot)
  return createDatasetsService({ ...stateOptions(worktreeRoot), bindingsRoot, defaultRepo })
}

/** Invoke the handler as `sess-1`, optionally with an agent-scope ctx probe. */
function run(
  svc: DatasetsService,
  rawInput: string,
  agentPresets?: unknown,
): Promise<CommandResult> {
  const agent: Record<string, unknown> = { session: { id: 'sess-1' } }
  if (agentPresets !== undefined) {
    agent['ctx'] = { get: (name: string) => (name === 'agentPresets' ? agentPresets : undefined) }
  }
  return handleDatasetsCommand(svc, { rawInput, agent } as unknown as CommandInvocation)
}

/** A roster probe: the session joined `presetId`; the inventory answers `groups`. */
function roster(presetId: string | undefined, groups: unknown): unknown {
  return {
    composedPreset: () => presetId,
    compositionInventory: () => Promise.resolve(groups),
  }
}

const ROW = '@khorsheed/dsh-datasets-tool'

describe('/datasets handler', () => {
  it('a bare invocation answers with the usage line', async () => {
    const result = await run(service(), '')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('usage: /datasets list')
  })

  it('bind is retired: it points the person at the registry and records nothing (T73)', async () => {
    const svc = service()
    const bound = await run(svc, 'bind /repo/library --datasets alpha,beta --layers visible')
    expect(bound).toEqual({ kind: 'error', text: BIND_RETIRED })
    expect(bound.text).toContain('Register repository')
    expect(svc.binding({ id: 'sess-1' as never })).toBeUndefined()
    // unbind still clears a legacy record, so a session can drop what it had.
    svc.bind({ id: 'sess-1' as never }, { repoPath: '/repo/library' })
    const cleared = await run(svc, 'unbind')
    expect(cleared).toMatchObject({ kind: 'success', text: 'dataset binding cleared' })
    expect(svc.binding({ id: 'sess-1' as never })).toBeUndefined()
  })

  it('list without a binding falls back to the service\'s defaultRepo, then refuses honestly', async () => {
    // No default: the refusal names the ways to supply a repo.
    const none = await run(service(), 'list')
    expect(none.kind).toBe('error')
    expect(none.text).toContain('no dataset repository')
    // A configured default is TRIED (and fails on disk here — proving the
    // fallback reached resolveScope rather than the NO_REPO refusal above).
    const withDefault = await run(service('/definitely/absent/repo'), 'list')
    expect(withDefault.kind).toBe('error')
    expect(withDefault.text).not.toContain('no dataset repository')
  })
})

describe('/datasets grant backstop', () => {
  it('refuses when the session preset is readable and names no companion row', async () => {
    const result = await run(service(), '', roster('standard', [{ id: 'standard', rows: [] }]))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/datasets is not granted to this session')
    expect(result.text).toContain(ROW)
    expect(result.text).toContain('standard')
  })

  it('passes when the preset composition names the companion row', async () => {
    const result = await run(service(), '', roster('eval', [{ id: 'eval', rows: [{ moduleName: ROW }] }]))
    expect(result.text).toContain('usage: /datasets list')
  })

  it('fails open when the agent carries no scope context', async () => {
    const result = await run(service(), '')
    expect(result.text).toContain('usage: /datasets list')
  })

  it('fails open when the roster service is absent', async () => {
    const result = await run(service(), '', undefined)
    expect(result.text).toContain('usage: /datasets list')
  })

  it('fails open when the session joined no preset', async () => {
    const result = await run(service(), '', roster(undefined, []))
    expect(result.text).toContain('usage: /datasets list')
  })

  it('fails open when the inventory throws', async () => {
    const throwing = {
      composedPreset: () => 'standard',
      compositionInventory: () => Promise.reject(new Error('unreadable')),
    }
    const result = await run(service(), '', throwing)
    expect(result.text).toContain('usage: /datasets list')
  })

  it('fails open when the preset group is missing or broken', async () => {
    const missing = await run(service(), '', roster('ghost', [{ id: 'standard', rows: [] }]))
    expect(missing.text).toContain('usage: /datasets list')
    const broken = await run(service(), '', roster('standard', [{ id: 'standard', broken: 'unreadable', rows: [] }]))
    expect(broken.text).toContain('usage: /datasets list')
  })
})
