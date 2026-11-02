import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { MODE_TOOLS_UNAVAILABLE_TOOL, serveMemberBridge, type MemberBridgeEnv } from '../src/member-bridge.ts'

/** One captured host-side request. */
interface HostCall {
  token: string
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

/** A fake listener whose answer depends on the request (and on how many came before). */
async function scriptedHost(answer: (request: Record<string, unknown>, index: number) => Record<string, unknown>): Promise<{ socket: string; calls: Record<string, unknown>[]; server: Server }> {
  const socket = join(mkdtempSync(join(tmpdir(), 'member-bridge-host-')), 'host.sock')
  const calls: Record<string, unknown>[] = []
  const server = createServer((connection) => {
    let buffer = ''
    connection.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
      calls.push(request)
      connection.end(`${JSON.stringify(answer(request, calls.length - 1))}\n`)
    })
  })
  await new Promise<void>((resolve) => { server.listen(socket, () => { resolve() }) })
  return { socket, calls, server }
}

/** Tiny timings so the retry and recovery paths run in milliseconds. */
const FAST = { retryDelaysMs: [1, 1], requestTimeoutMs: 1_000, recoveryDelaysMs: [5] }

/** Wait until a condition holds (bounded). */
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 3_000) throw new Error('condition never held')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const modeToolsOf = (request: Record<string, unknown>) => request['modeTools'] as Record<string, unknown> | undefined

interface BridgeRig {
  write(message: Record<string, unknown>): void
  responses(): Record<string, unknown>[]
  close(): void
}

/** Run the bridge loop over in-memory streams, collecting its output lines. */
function rig(env: MemberBridgeEnv): BridgeRig {
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

  it('answers initialize and tools/list with member messaging and room coordination tools', async () => {
    const bridge = rig({})
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    bridge.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const responses = await untilResponses(bridge, 2)
    bridge.close()

    expect(responses[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'dsh-member-bridge' } } })
    const tools = (responses[1]?.result as { tools: { name: string }[] }).tools
    expect(tools.map(tool => tool.name)).toEqual(['member_message', 'room_plan', 'room_read', 'room_invite', 'ask_user_question', 'room_message', 'room_help'])
    // The notification got no reply.
    expect(responses).toHaveLength(2)
  })

  it('forwards room commands without accepting an actor or room identity', async () => {
    const host = await fakeHost({ ok: true, receipt: 'accepted' })
    server = host.server
    const bridge = rig({ socket: host.socket, token: 'tok-1' })
    bridge.write({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'room_message', arguments: { member: 'worker', text: 'small job' } } })
    const responses = await untilResponses(bridge, 1)
    bridge.close()
    expect(responses[0]).toMatchObject({ id: 8, result: { isError: false, content: [{ text: 'accepted' }] } })
    expect(host.calls[0]).toEqual({ token: 'tok-1', command: { name: 'room_message', arguments: { member: 'worker', text: 'small job' } } })
  })

  it('forwards member_message to the host socket with the per-run token, returning the receipt', async () => {
    const host = await fakeHost({ ok: true, receipt: 'pending-confirm' })
    server = host.server
    const bridge = rig({ socket: host.socket, token: 'tok-1' })
    bridge.write({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'member_message', arguments: { to: 'child-b', text: 'X 已完成' } } })
    const responses = await untilResponses(bridge, 1)
    bridge.close()

    expect(host.calls).toEqual([{ token: 'tok-1', to: 'child-b', text: 'X 已完成' }])
    expect(responses[0]).toMatchObject({
      id: 7,
      result: { content: [{ type: 'text', text: 'pending-confirm' }] },
    })
    expect((responses[0]?.result as { isError?: boolean }).isError ?? false).toBe(false)
  })

  it('maps a host-side rejection (bad/expired token) to a tool error', async () => {
    const host = await fakeHost({ ok: false, error: 'localAgent: unknown or expired member token' })
    server = host.server
    const bridge = rig({ socket: host.socket, token: 'stale' })
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

  it('forwards other tool names as mode tools (an error without a host) and answers unknown methods with MethodNotFound', async () => {
    const bridge = rig({})
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'other_tool', arguments: {} } })
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'resources/list' })
    bridge.write({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} })
    const responses = await untilResponses(bridge, 3)
    bridge.close()
    const byId = (id: number) => responses.find(response => response.id === id)

    expect(byId(1)).toMatchObject({ result: { isError: true } })
    expect(byId(2)).toMatchObject({ error: { code: -32601 } })
    expect(byId(3)).toMatchObject({ error: { code: -32602 } })
  })

  it('advertises tools.listChanged so a recovered mode-tool list can be announced', async () => {
    const bridge = rig({})
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    const [hello] = await untilResponses(bridge, 1)
    bridge.close()
    expect(hello).toMatchObject({ result: { capabilities: { tools: { listChanged: true } } } })
  })

  it('a member with no mode (the host answers an empty list) gets no placeholder, no report and no probing', async () => {
    const host = await scriptedHost(() => ({ ok: true, tools: [] }))
    server = host.server
    const log: string[] = []
    const bridge = rig({ socket: host.socket, token: 'tok-1', timing: FAST, log: line => log.push(line) })
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const [listed] = await untilResponses(bridge, 1)
    await new Promise(resolve => setTimeout(resolve, 40))
    bridge.close()
    const names = (listed?.result as { tools: { name: string }[] }).tools.map(tool => tool.name)
    expect(names).not.toContain(MODE_TOOLS_UNAVAILABLE_TOOL)
    expect(names).toHaveLength(7)
    expect(host.calls).toEqual([{ token: 'tok-1', modeTools: { list: true } }])
    expect(log).toEqual([])
  })

  it('a failed mode-tool fetch is retried, then lists the placeholder, logs and reports it', async () => {
    const host = await scriptedHost(request => modeToolsOf(request)?.['report'] !== undefined
      ? { ok: true, recorded: true }
      : { ok: false, error: 'localAgent: unknown or expired member token' })
    server = host.server
    const log: string[] = []
    const bridge = rig({ socket: host.socket, token: 'tok-1', timing: { ...FAST, recoveryDelaysMs: [60_000] }, log: line => log.push(line) })
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const [listed] = await untilResponses(bridge, 1)
    await until(() => host.calls.some(call => modeToolsOf(call)?.['report'] !== undefined))
    const tools = (listed?.result as { tools: { name: string; description: string }[] }).tools
    const placeholder = tools.find(tool => tool.name === MODE_TOOLS_UNAVAILABLE_TOOL)
    expect(placeholder?.description).toMatch(/ABSENT from this process: localAgent: unknown or expired member token\. Calling them will not work until this member is reloaded/)
    expect(placeholder?.description).toMatch(/Do not retry them.*Tell the user/)
    expect(tools.map(tool => tool.name).slice(0, 7)).toEqual(['member_message', 'room_plan', 'room_read', 'room_invite', 'ask_user_question', 'room_message', 'room_help'])
    // One attempt plus one per retry delay, then the report.
    expect(host.calls.filter(call => modeToolsOf(call)?.['list'] === true)).toHaveLength(3)
    expect(host.calls.find(call => modeToolsOf(call)?.['report'] !== undefined)).toEqual({
      token: 'tok-1', modeTools: { report: { served: 'placeholder', reason: 'localAgent: unknown or expired member token' } },
    })
    expect(log.join('\n')).toMatch(/mode tools unavailable, serving mode_tools_unavailable: localAgent: unknown or expired member token/)

    // Calling the placeholder reports again and answers a tool error the room shows.
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: MODE_TOOLS_UNAVAILABLE_TOOL, arguments: {} } })
    const [, called] = await untilResponses(bridge, 2)
    bridge.close()
    expect(called).toMatchObject({ id: 2, result: { isError: true } })
    expect((called?.result as { content: { text: string }[] }).content[0]?.text).toMatch(/^Mode tools unavailable: localAgent: unknown or expired member token\. Reported to the room/)
    expect(host.calls.filter(call => modeToolsOf(call)?.['report'] !== undefined)).toHaveLength(2)
  })

  it('an unreachable host also ends in the placeholder (bounded, never hangs)', async () => {
    const log: string[] = []
    const bridge = rig({ socket: join(tmpdir(), 'no-such-member-bridge.sock'), token: 'tok', timing: { ...FAST, recoveryDelaysMs: [60_000] }, log: line => log.push(line) })
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const [listed] = await untilResponses(bridge, 1)
    bridge.close()
    expect((listed?.result as { tools: { name: string }[] }).tools.at(-1)?.name).toBe(MODE_TOOLS_UNAVAILABLE_TOOL)
    expect(log[0]).toMatch(/member channel unreachable/)
  })

  it('keeps probing after a placeholder and announces list_changed once the host answers', async () => {
    let healthy = false
    const host = await scriptedHost((request) => {
      if (modeToolsOf(request)?.['report'] !== undefined) return { ok: true, recorded: true }
      return healthy ? { ok: true, tools: [{ name: 'game_publish', description: 'publish', inputSchema: { type: 'object' } }] } : { ok: false, error: 'host restarting' }
    })
    server = host.server
    const log: string[] = []
    const bridge = rig({ socket: host.socket, token: 'tok-1', timing: FAST, log: line => log.push(line) })
    bridge.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await untilResponses(bridge, 1)
    // Still failing: the background probes keep coming, flagged as probes.
    await until(() => host.calls.filter(call => modeToolsOf(call)?.['probe'] === true).length >= 2)
    expect(bridge.responses()).toHaveLength(1)
    healthy = true
    await untilResponses(bridge, 2)
    expect(bridge.responses()[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    expect(log.join('\n')).toMatch(/reachable again \(1\)/)

    // A CLI that ignores the notification still holds the placeholder: it still waits for the reload.
    bridge.write({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: MODE_TOOLS_UNAVAILABLE_TOOL, arguments: {} } })
    const called = (await untilResponses(bridge, 3))[2]
    expect((called?.result as { content: { text: string }[] }).content[0]?.text).toMatch(/host answers again, but this process still lacks them.*reloaded with its mode tools when its next round starts/)

    // A CLI that honors it re-lists and gets the mode tools, no placeholder.
    const probes = host.calls.filter(call => modeToolsOf(call)?.['probe'] === true).length
    bridge.write({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const relisted = (await untilResponses(bridge, 4))[3]
    await new Promise(resolve => setTimeout(resolve, 30))
    bridge.close()
    const names = (relisted?.result as { tools: { name: string }[] }).tools.map(tool => tool.name)
    expect(names).toContain('game_publish')
    expect(names).not.toContain(MODE_TOOLS_UNAVAILABLE_TOOL)
    // Probing stopped with the recovery.
    expect(host.calls.filter(call => modeToolsOf(call)?.['probe'] === true).length).toBe(probes)
    expect(bridge.responses()).toHaveLength(4)
  })
})
