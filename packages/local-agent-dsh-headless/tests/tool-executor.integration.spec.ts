import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

class ReadRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'integration'

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: 120_000 }
  }

  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    const read = request.bindings.find(binding => binding.global === 'tools')?.functions.read
    if (read === undefined) throw new Error('missing read binding')
    const value = await read({ file_path: 'note.md' })
    return { logs: [], value }
  }
}

describe.each(['native', 'ptc'] as const)('%s tool executor composition', mode => {
  it('executes the selected call form through the official registry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-headless-executor-'))
    await writeFile(join(dir, 'note.md'), 'native and PTC\n')
    const ctx = new Context()
    try {
      provideWorkingDirectoryFixture(ctx, dir)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: dir })
      await ctx.plugin(ToolFs, { applyPatch: false })
      if (mode === 'ptc') await ctx.plugin(ReadRuntime)
      await ctx.plugin(mode === 'native' ? NativeToolExecutor : PtcToolExecutor)
      const session = Session.create(SessionId(`headless-${mode}`))
      const agent = { ctx, session } as Agent
      const name = mode === 'native' ? 'read' : 'run_code'
      const args = mode === 'native'
        ? { file_path: 'note.md' }
        : { code: 'return tools.read({ file_path: "note.md" })', description: 'Read through PTC' }
      const callId = ToolCallId(`headless-${mode}-call`)
      session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
      const batch = await ctx.tools.execute({
        calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }],
        signal: new AbortController().signal,
        agent,
      })
      expect(batch.results[0]?.result.isError).toBe(false)
      const dispatches = session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch')
      expect(dispatches).toHaveLength(mode === 'ptc' ? 1 : 0)
      if (mode === 'ptc') expect(dispatches[0]?.data).toMatchObject({ name: 'read', isError: false })
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
