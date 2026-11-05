import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diffsFromResultMeta, foldFilePreview, foldFilePreviewByTurn, lineCount } from '@khorsheed/dsh-file-preview/src/fold.ts'

class WriteEditRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'integration'

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: 120_000 }
  }

  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    const functions = request.bindings.find(binding => binding.global === 'tools')?.functions
    const write = functions?.write
    const edit = functions?.edit
    if (write === undefined || edit === undefined) throw new Error('missing file tool bindings')
    await write({ file_path: 'new.md', content: 'a\nb\n' })
    const value = await edit({ file_path: 'new.md', old_string: 'b', new_string: 'b\nc' })
    return { logs: [], value }
  }
}

describe('official PTC dispatch integration', () => {
  it('folds real create/edit dispatch metadata into history and root-turn line counts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-file-preview-ptc-'))
    const ctx = new Context()
    try {
      provideWorkingDirectoryFixture(ctx, dir)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: dir })
      await ctx.plugin(ToolFs)
      await ctx.plugin(WriteEditRuntime)
      await ctx.plugin(PtcToolExecutor)
      const session = Session.create(SessionId('file-preview-ptc'))
      const agent = { ctx, session } as Agent
      const callId = ToolCallId('file-preview-ptc-run')
      const args = { code: 'create then edit new.md', description: 'Exercise real PTC file tools' }
      session.append('tool/call', { turn: 3, step: 2, callId, name: 'run_code', arguments: JSON.stringify(args) })
      const batch = await ctx.tools.execute({
        calls: [{ type: 'tool-call', id: callId, name: 'run_code', arguments: JSON.stringify(args) }],
        signal: new AbortController().signal,
        agent,
      })
      expect(batch.results[0]?.result.isError).toBe(false)
      expect(await readFile(join(dir, 'new.md'), 'utf8')).toBe('a\nb\nc\n')

      const events = session.snapshotEvents()
      const dispatches = events.filter(event => event.type === 'tool/ptc-dispatch')
      expect(dispatches).toHaveLength(2)
      expect(dispatches[0]?.data.meta).toMatchObject({ operation: 'create', diffs: [] })
      const diffs = dispatches.flatMap(event => diffsFromResultMeta(event.data.meta) ?? [])
      expect(diffs).toHaveLength(1)
      const diff = diffs[0]!
      if (diff.oldText === null) throw new Error('edit must have prior content')

      const entry = foldFilePreview(events, 500).entries.find(item => item.path === 'new.md')
      expect(entry?.diffs).toEqual([{
        seq: dispatches[1]!.seq, turn: 3, step: 2, oldText: diff.oldText, newText: diff.newText,
      }])
      const fact = foldFilePreviewByTurn(events).get(3)?.get('new.md')
      expect(fact).toMatchObject({
        step: 2,
        added: 2 + lineCount(diff.newText),
        removed: lineCount(diff.oldText),
      })
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
