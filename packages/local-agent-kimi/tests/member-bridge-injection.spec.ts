import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { KimiCliProvider } from '../src/kimi-cli-provider.ts'
import {
  injectMemberBridge, memberBridgeServerKey, MEMBER_BRIDGE_SERVER_PREFIX, removeMemberBridge,
} from '../src/member-bridge-config.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'

/** A stub child that prints a reply and exits 0 on a later tick. */
function stubChild(pid: number): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push('• done\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid,
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

function mcpServers(homeDir: string): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(homeDir, 'mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers
}

describe('member-bridge-config', () => {
  it('writes the per-run bridge entry, preserving user servers and pruning stale family entries', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-mcp-'))
    writeFileSync(join(homeDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        'user-server': { command: 'user-tool' },
        [`${MEMBER_BRIDGE_SERVER_PREFIX}deadbeef`]: { command: 'node', args: ['old.js'] },
      },
    }))

    injectMemberBridge(homeDir, 'dsh-member-00cc11ee', { command: 'node', args: ['/bridge.js'] }, {
      DSH_MEMBER_SOCKET: '/h/member-bridge.sock',
      DSH_MEMBER_TOKEN: 'token-1',
    })

    const servers = mcpServers(homeDir)
    expect(servers['user-server']).toEqual({ command: 'user-tool' })
    // The stale family entry from a crashed run is gone.
    expect(servers[`${MEMBER_BRIDGE_SERVER_PREFIX}deadbeef`]).toBeUndefined()
    expect(servers['dsh-member-00cc11ee']).toEqual({
      command: 'node',
      args: ['/bridge.js'],
      env: { DSH_MEMBER_SOCKET: '/h/member-bridge.sock', DSH_MEMBER_TOKEN: 'token-1' },
    })
  })

  it('removeMemberBridge drops only the named family entry and tolerates a missing config', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-mcp-'))
    injectMemberBridge(homeDir, 'dsh-member-00cc11ee', { command: 'node', args: ['/bridge.js'] }, {})
    removeMemberBridge(homeDir, 'dsh-member-00cc11ee')
    expect(mcpServers(homeDir)).toEqual({})

    const empty = mkdtempSync(join(tmpdir(), 'kimi-mcp-'))
    expect(() => removeMemberBridge(empty, 'dsh-member-00cc11ee')).not.toThrow()
  })

  it('memberBridgeServerKey carries the token prefix', () => {
    expect(memberBridgeServerKey('abcdef1234567890')).toBe('dsh-member-abcdef12')
  })
})

describe('kimi-cli-provider member bridge injection', () => {
  const PARENT = 'parent-1'

  function memberRegistry(homeDir: string) {
    return {
      homeDir: () => homeDir,
      get: () => ({ displayName: 'Kimi Code' }),
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => undefined,
      registerMemberRun: vi.fn(() => 'token-xyz-1234'),
      bindMemberRunPid: vi.fn(),
      unregisterMemberRun: vi.fn(),
      memberBridgeSocketPath: () => join(homeDir, 'member-bridge.sock'),
      memberBridgeCommand: () => ({ command: 'node', args: ['/bridge.js'] }),
    }
  }

  function request(): SubagentStartRequest {
    return {
      label: '委派',
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'kimi-cli', label: '委派' },
    } as unknown as SubagentStartRequest
  }

  it('declares the bridge MCP with socket+token env and cleans up at settle', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-member-'))
    const ctx = new Context()
    const registry = memberRegistry(homeDir)
    ctx.provide('localAgent', registry as never)
    ctx.provide('subprocess', { spawn: () => stubChild(4242) } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const run = await provider.start(request())

    // Registered before spawn, with the run's member identity.
    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: expect.any(String),
      parentSessionId: PARENT,
      provider: 'kimi-cli',
    })
    // The scoped mcp.json declares the per-run bridge server.
    const entry = mcpServers(homeDir)[memberBridgeServerKey('token-xyz-1234')]
    expect(entry).toEqual({
      command: 'node',
      args: ['/bridge.js'],
      env: {
        DSH_MEMBER_SOCKET: join(homeDir, 'member-bridge.sock'),
        DSH_MEMBER_TOKEN: 'token-xyz-1234',
      },
    })
    // Host 0.1.5 hides the spawned child's pid: the cross-check cannot be bound
    // and the channel fails closed on its unbound-run rejection.
    expect(registry.bindMemberRunPid).not.toHaveBeenCalled()

    await run.result
    // Settle invalidates the token and prunes the config entry.
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
    expect(mcpServers(homeDir)[memberBridgeServerKey('token-xyz-1234')]).toBeUndefined()
  })

  it('injects the bridge for resume rounds too', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-member-'))
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    ctx.provide('sessionPersistence', fakeSessionPersistence() as never)
    const registry = {
      ...memberRegistry(homeDir),
      takeDelegationIntent: () => ({ kind: 'resume', childSessionId: 'child-run-1', cliSessionId: 'run-1' }),
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    }
    ctx.provide('localAgent', registry as never)
    ctx.provide('subprocess', { spawn: () => stubChild(4343) } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const run = await provider.start(request())

    // The resume round registers under the EXISTING child session id.
    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: 'child-run-1',
      parentSessionId: PARENT,
      provider: 'kimi-cli',
    })
    expect(mcpServers(homeDir)[memberBridgeServerKey('token-xyz-1234')]).toBeDefined()
    expect(registry.bindMemberRunPid).not.toHaveBeenCalled()

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('degrades to a plain run when the core predates the member channel', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-member-'))
    const ctx = new Context()
    ctx.provide('localAgent', {
      homeDir: () => homeDir,
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', { spawn: () => stubChild(4242) } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const run = await provider.start(request())

    expect((await run.result).stopReason).toBe('completed')
    // No member API on the core: no mcp.json is written at all.
    expect(existsSync(join(homeDir, 'mcp.json'))).toBe(false)
  })
})
