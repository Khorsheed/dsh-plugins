import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { applyHunks, parsePatch } from '@deepseek-ai/dsh-fs-patch'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { foldFilePreview, foldFilePreviewByTurn } from '@khorsheed/dsh-file-preview/src/fold.ts'

const parser = Object.assign(parsePatch, { applyHunks })

const PATCH = `*** Begin Patch
*** Add File: added.md
+one
+two
*** Update File: updated.md
@@
-old
+new
*** Delete File: deleted.md
*** Update File: moved-from.md
*** Move to: moved-to.md
@@
-from
+to
*** End Patch`

class ApplyPatchRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'integration'

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: 120_000 }
  }

  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    const applyPatch = request.bindings.find(binding => binding.global === 'tools')?.functions.apply_patch
    if (applyPatch === undefined) throw new Error('missing apply_patch binding')
    const value = await applyPatch({ input: PATCH })
    return { logs: [], value }
  }
}

describe.each(['native', 'ptc'] as const)('%s apply_patch integration', mode => {
  it('folds real Add/Update/Delete/Move effects without inventing creation metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-file-preview-patch-'))
    await writeFile(join(dir, 'updated.md'), 'old\n')
    await writeFile(join(dir, 'deleted.md'), 'gone\n')
    await writeFile(join(dir, 'moved-from.md'), 'from\n')
    const ctx = new Context()
    try {
      provideWorkingDirectoryFixture(ctx, dir)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: dir })
      await ctx.plugin(ToolFs, { applyPatch: true })
      if (mode === 'ptc') await ctx.plugin(ApplyPatchRuntime)
      await ctx.plugin(mode === 'native' ? NativeToolExecutor : PtcToolExecutor)
      const session = Session.create(SessionId(`file-preview-patch-${mode}`))
      const agent = { ctx, session } as Agent
      const name = mode === 'native' ? 'apply_patch' : 'run_code'
      const args = mode === 'native' ? { input: PATCH } : { code: 'apply the file patch', description: 'Exercise all patch operations' }
      const callId = ToolCallId(`file-preview-patch-${mode}`)
      const batch = await ctx.tools.execute({
        calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
        signal: new AbortController().signal,
        agent,
        log: { turn: 3, step: 2 },
      })
      expect(batch.results[0]?.result).toMatchObject({ isError: false })
      expect(await readFile(join(dir, 'added.md'), 'utf8')).toBe('one\ntwo\n')
      expect(await readFile(join(dir, 'updated.md'), 'utf8')).toBe('new\n')
      expect(await readFile(join(dir, 'moved-to.md'), 'utf8')).toBe('to\n')
      await expect(stat(join(dir, 'deleted.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(join(dir, 'moved-from.md'))).rejects.toMatchObject({ code: 'ENOENT' })

      const events = session.snapshotEvents()
      const outcome = mode === 'ptc'
        ? events.find(event => event.type === 'tool/ptc-dispatch')
        : events.find(event => event.type === 'tool/result')
      expect(outcome?.data).toMatchObject({ meta: { stopped: false } })
      const entries = foldFilePreview(events, 500, parser).entries
      expect(entries.map(entry => entry.path)).toEqual(['added.md', 'updated.md', 'deleted.md', 'moved-from.md', 'moved-to.md'])
      expect(entries[0]).toMatchObject({
        op: 'write', turn: 3, step: 2,
        lastDiff: { oldText: null, newText: 'one\ntwo\n' },
      })
      expect(entries[0]?.diffs[0]?.seq).toBe(outcome!.seq)
      expect(entries[4]?.lastDiff).toEqual({ oldText: null, newText: 'to\n' })
      expect(Object.fromEntries(foldFilePreviewByTurn(events, parser).get(3)!)).toMatchObject({
        'added.md': { added: 2, removed: 0 },
        'updated.md': { added: 1, removed: 1 },
        'deleted.md': { added: 0, removed: 1 },
        'moved-from.md': { added: 0, removed: 1 },
        'moved-to.md': { added: 1, removed: 0 },
      })
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
