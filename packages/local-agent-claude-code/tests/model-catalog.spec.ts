import { PassThrough } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeModelCatalog, claudeDirectory } from '../src/model-catalog.ts'
import { ClaudeControlRequests } from '../src/control-requests.ts'

const native = { models: [
  { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-current', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
  { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-current' },
] }

function mount(): {
  home: string; catalog: ClaudeModelCatalog; spawns: SubprocessSpawnSpec[]; requests: Record<string, unknown>[];
  fail: () => void; closed: () => number;
} {
  const home = mkdtempSync(join(tmpdir(), 'claude-directory-'))
  const spawns: SubprocessSpawnSpec[] = []
  const requests: Record<string, unknown>[] = []
  let fail = false
  let closed = 0
  const catalog = new ClaudeModelCatalog({ spawn: spec => {
    spawns.push(spec)
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolve!: (value: { exitCode: number; signal: null }) => void
    const done = new Promise<{ exitCode: number; signal: null }>(yes => { resolve = yes })
    const stop = (): void => { resolve({ exitCode: 0, signal: null }) }
    stdin.on('end', () => { closed++; stop() })
    stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString()) as Record<string, unknown>
      requests.push(request)
      stdout.write(JSON.stringify({ type: 'control_response', response: fail
        ? { subtype: 'error', request_id: request['request_id'], error: 'native probe unavailable' }
        : { subtype: 'success', request_id: request['request_id'], response: native } }) + '\n')
    })
    return { stdin, stdout, stderr, collected: undefined as never, done, terminate: stop, waitForExit: async () => true } satisfies SubprocessHandle
  } })
  return { home, catalog, spawns, requests, fail: () => { fail = true }, closed: () => closed }
}

describe('Claude native directory', () => {
  it('retains native aliases, resolved names and effort values without inventing model IDs', () => {
    expect(claudeDirectory(native)).toMatchObject({ complete: true, customInput: true, defaultModel: 'default', entries: [
      { value: 'default', label: 'Default (recommended)', resolvedModel: 'claude-current', reasoning: { options: [{ value: 'low' }, { value: 'high' }] } },
      { value: 'sonnet', source: 'native' },
    ] })
    expect(claudeDirectory(native).entries[1]?.reasoning).toBeUndefined()
    expect(claudeDirectory({})).toMatchObject({ unsupported: true, complete: false })
    expect(() => claudeDirectory({ models: 'invalid' })).toThrow('invalid model directory')
  })

  it('uses only initialize in the scoped native context and closes the discovery process', async () => {
    const m = mount()
    expect((await m.catalog.refresh(m.home)).status).toBe('ready')
    expect(m.spawns[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(m.home)
    expect(m.spawns[0]?.argv).toContain('--no-session-persistence')
    expect(m.spawns[0]?.argv).toContain('--strict-mcp-config')
    expect(m.spawns[0]?.argv).toContain('{"disableAllHooks":true}')
    expect(m.requests).toHaveLength(1)
    expect(m.requests[0]).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } })
    expect(m.closed()).toBe(1)
    m.catalog.dispose()
  })

  it('keeps native metadata when a later control request is rejected', async () => {
    const m = mount()
    await m.catalog.refresh(m.home)
    m.fail()
    const stale = await m.catalog.refresh(m.home)
    expect(stale).toMatchObject({ status: 'stale', refreshing: false, reason: 'native probe unavailable' })
    expect(stale.entries[0]?.resolvedModel).toBe('claude-current')
    m.catalog.dispose()
  })
})

describe('Claude control acknowledgements', () => {
  it('correlates replies and rejects native errors instead of counting any response as success', async () => {
    const sent: Record<string, unknown>[] = []
    const controls = new ClaudeControlRequests(frame => { sent.push(frame) })
    const change = controls.request({ subtype: 'set_model', model: 'sonnet' })
    const rejected = expect(change).rejects.toThrow('unsupported model')
    controls.accept({ type: 'control_response', response: { subtype: 'success', request_id: 'unrelated', response: {} } })
    controls.accept({ type: 'control_response', response: { subtype: 'error', request_id: sent[0]?.['request_id'], error: 'unsupported model' } })
    await rejected
    controls.close()
  })

  it('bounds missing replies and rejects in-flight controls when the process dies', async () => {
    vi.useFakeTimers()
    try {
      const controls = new ClaudeControlRequests(() => {}, 50)
      const timeout = expect(controls.request({ subtype: 'initialize' })).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(50)
      await timeout
      const interrupted = expect(controls.request({ subtype: 'set_model' })).rejects.toThrow('closed before acknowledgement')
      controls.close()
      await interrupted
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
