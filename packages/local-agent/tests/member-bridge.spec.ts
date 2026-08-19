import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { serveMemberBridge } from '../src/member-bridge.ts'

/** One captured host-side request. */
interface HostCall {
  token: string
  pid: number
  to: string
  text: string
}

/** A fake member-channel listener: one NDJSON request in, a canned outcome out. */
async function fakeHost(outcome: { ok: boolean; receipt?: string; error?: string }): Promise<{ socket: string; calls: HostCall[]; server: Server }> {
  const socket = join(mkdtempSync(join(tmpdir(), 'member-bridge-host-')), 'host.sock')
  const calls: HostCall[] = []
  const server = createServer((connection) => {
    let buffer = ''
    connection.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      calls.push(JSON.parse(buffer.slice(0, newline)) as HostCall)
      connection.end(`${JSON.stringify(outcome)}\n`)
    })
  })
  await new Promise<void>((resolve) => { server.listen(socket, () => { resolve() }) })
  return { socket, calls, server }
}

interface BridgeRig {
  write(message: Record<string, unknown>): void
  responses(): Record<string, unknown>[]
  close(): void
}

/** Run the bridge loop over in-memory streams, collecting its output lines. */
function rig(env: { socket?: string; token?: string; pid?: number }): BridgeRig {
  const input = new PassThrough()
  const output = new PassThrough()
  const responses: Record<string, unknown>[] = []
  let buffer = ''
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      responses.push(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>)
      buffer = buffer.slice(newline + 1)
    }
  })
  serveMemberBridge(env, input, output)
  return {
    write: (message) => { input.write(`${JSON.stringify(message)}\n`) },
    responses: () => responses,
    close: () => { input.end() },
  }
}

/** Flush until the bridge produced n responses. */
async function untilResponses(rig: BridgeRig, n: number): Promise<Record<string, unknown>[]> {
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (rig.responses().length >= n) { resolve(); return }
      setImmediate(check)
    }
    check()
  })
  return rig.responses()
}

describe('member bridge (stdio MCP server)', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((resolve) => { server!.close(() => { resolve() }) })
    server = undefined
  })

  it('answers initialize and tools/list with the one member_message tool', async () => {
    const bridge = rig({})
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    bridge.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const responses = await untilResponses(bridge, 2)
    bridge.close()

    expect(responses[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'dsh-member-bridge' } } })
    const tools = (responses[1]?.result as { tools: { name: string }[] }).tools
    expect(tools.map(tool => tool.name)).toEqual(['member_message'])
    // The notification got no reply.
    expect(responses).toHaveLength(2)
  })

  it('forwards member_message to the host socket with token and parent pid, returning the receipt', async () => {
    const host = await fakeHost({ ok: true, receipt: 'pending-confirm' })
    server = host.server
    const bridge = rig({ socket: host.socket, token: 'tok-1', pid: 4242 })
    bridge.write({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'member_message', arguments: { to: 'child-b', text: 'X 已完成' } } })
    const responses = await untilResponses(bridge, 1)
    bridge.close()

    expect(host.calls).toEqual([{ token: 'tok-1', pid: 4242, to: 'child-b', text: 'X 已完成' }])
    expect(responses[0]).toMatchObject({
      id: 7,
      result: { content: [{ type: 'text', text: 'pending-confirm' }] },
    })
    expect((responses[0]?.result as { isError?: boolean }).isError ?? false).toBe(false)
  })

  it('maps a host-side rejection (bad/expired token) to a tool error', async () => {
    const host = await fakeHost({ ok: false, error: 'localAgent: unknown or expired member token' })
    server = host.server
    const bridge = rig({ socket: host.socket, token: 'stale', pid: 4242 })
    bridge.write({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'member_message', arguments: { to: 'child-b', text: 'hi' } } })
    const responses = await untilResponses(bridge, 1)
    bridge.close()

    expect(responses[0]).toMatchObject({
      id: 8,
      result: { isError: true, content: [{ type: 'text', text: 'localAgent: unknown or expired member token' }] },
    })
  })

  it('answers a tool error when the channel is unconfigured or unreachable', async () => {
    const unconfigured = rig({})
    unconfigured.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'member_message', arguments: { to: 'child-b', text: 'hi' } } })
    const missing = await untilResponses(unconfigured, 1)
    unconfigured.close()
    expect((missing[0]?.result as { isError?: boolean }).isError).toBe(true)

    const unreachable = rig({ socket: join(tmpdir(), 'no-such-member-bridge.sock'), token: 'tok' })
    unreachable.write({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'member_message', arguments: { to: 'child-b', text: 'hi' } } })
    const down = await untilResponses(unreachable, 1)
    unreachable.close()
    const result = down[0]?.result as { isError?: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/member channel unavailable/)
  })

  it('rejects unknown tools and answers unknown methods with MethodNotFound', async () => {
    const bridge = rig({})
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'other_tool', arguments: {} } })
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'resources/list' })
    const responses = await untilResponses(bridge, 2)
    bridge.close()

    expect(responses[0]).toMatchObject({ id: 1, error: { code: -32602 } })
    expect(responses[1]).toMatchObject({ id: 2, error: { code: -32601 } })
  })
})
