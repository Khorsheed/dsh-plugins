/**
 * Member bridge: a minimal standalone MCP server (stdio, newline-delimited
 * JSON-RPC) exposing member messaging and room coordination tools to the CLI
 * member that spawned it. Each call is forwarded to the host's member-channel
 * listener over the loopback socket named by `DSH_MEMBER_SOCKET`,
 * authenticated by the per-run token in `DSH_MEMBER_TOKEN`; the host's
 * receipt is the tool result verbatim.
 *
 * The process is dependency-free (node builtins only) because the CLI spawns
 * it bare: `node <this file>`, with the socket path and token in its
 * environment (written into the CLI's scoped MCP config by the provider).
 * Covers the MCP handshake subset a client needs: `initialize`,
 * `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
 * @module @khorsheed/dsh-local-agent/member-bridge
 */

import { createInterface } from 'node:readline'
import { connect } from 'node:net'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type { MemberRoomCommandName } from './types.ts'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from './types.ts'

/** The one tool this server exposes. */
export const MEMBER_MESSAGE_TOOL = 'member_message'

const TOOL_DESCRIPTION = [
  'Notify another CLI member of this room/session group (member-to-member message).',
  '`to` is the target member\'s dsh child session id (or a member name when a room manages the group).',
  'The delivery receipt is returned verbatim: sent / pending-confirm / busy / an error reason.',
].join(' ')

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'The target member\'s child session id (or room-roster name).' },
    text: { type: 'string', description: 'The notification text, delivered with your provenance.' },
  },
  required: ['to', 'text'],
  additionalProperties: false,
} as const

const ROOM_TOOLS = [
  { name: 'room_read', description: 'Read your room roster, coordinator, deliveries, recent outcomes and available harness providers. Identity comes from the host.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'room_invite', description: 'Coordinator only: invite a member. An optional firstTask starts in the background and returns its result to you automatically.',
    inputSchema: { type: 'object', properties: {
      provider: { type: 'string' }, name: { type: 'string' }, instructions: { type: 'string' },
      cwd: { type: 'string' }, model: { type: 'string' }, firstTask: { type: 'string' },
    }, required: ['provider', 'name'], additionalProperties: false } },
  { name: 'room_message', description: 'Coordinator only: dispatch background work to a room member by name. Returns acceptance immediately; completion arrives as a correlated report. Do not poll.',
    inputSchema: { type: 'object', properties: { member: { type: 'string' }, text: { type: 'string' } }, required: ['member', 'text'], additionalProperties: false } },
] as const

export async function callRoomCommand(env: MemberBridgeEnv, name: MemberRoomCommandName, args: unknown): Promise<Record<string, unknown>> {
  if (env.socket === undefined || env.token === undefined) return toolText('member channel is not configured for this run', true)
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return toolText('Room tool arguments must be an object', true)
  try {
    const outcome = await callHost(env.socket, { token: env.token, command: { name, arguments: args } })
    return toolText(outcome.ok ? outcome.receipt ?? 'accepted' : outcome.error ?? 'Room command rejected', !outcome.ok)
  } catch (error) { return toolText(`Room command unavailable: ${String(error)}`, true) }
}

/** What the bridge needs from its environment (injectable for tests). */
export interface MemberBridgeEnv {
  /** Host member-channel socket path. */
  readonly socket?: string | undefined
  /** This run's member-channel token. */
  readonly token?: string | undefined
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: unknown
}

/** One socket round trip: send the request line, read the one-line response. */
function callHost(socket: string, payload: Record<string, unknown>): Promise<{ ok: boolean; receipt?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const connection = connect(socket)
    let buffer = ''
    connection.on('connect', () => {
      connection.write(`${JSON.stringify(payload)}\n`)
    })
    connection.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      connection.end()
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as { ok: boolean; receipt?: string; error?: string })
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    connection.on('error', reject)
  })
}

/** A successful MCP tool result carrying the receipt text. */
function toolText(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError }
}

/**
 * Handle one `member_message` tool call: forward to the host listener and map
 * the outcome to a tool result. Channel failures (missing env, unreachable
 * listener, rejected token) are tool errors; delivery verdicts are text.
 * @param env - the bridge's environment (socket, token).
 * @param args - the tool arguments (`to`, `text`).
 * @returns the MCP tool result object.
 */
export async function callMemberMessage(
  env: MemberBridgeEnv,
  args: { to?: unknown; text?: unknown },
): Promise<Record<string, unknown>> {
  if (env.socket === undefined || env.token === undefined) {
    return toolText('member channel is not configured for this run (missing socket/token environment)', true)
  }
  if (typeof args.to !== 'string' || typeof args.text !== 'string') {
    return toolText('member_message requires string arguments `to` and `text`', true)
  }
  try {
    const outcome = await callHost(env.socket, {
      token: env.token,
      to: args.to,
      text: args.text,
    })
    if (outcome.ok) return toolText(outcome.receipt ?? 'sent')
    return toolText(outcome.error ?? 'member channel rejected the message', true)
  } catch (error: unknown) {
    return toolText(`member channel unavailable: ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

/**
 * Run the stdio JSON-RPC loop over the given streams (injectable for tests).
 * Unknown methods with an id get a MethodNotFound error; notifications are
 * ignored. Never throws — a malformed line is answered with a parse error and
 * the loop continues.
 * @param env - the bridge's environment.
 * @param input - the stdin side.
 * @param output - the stdout side.
 */
export function serveMemberBridge(env: MemberBridgeEnv, input: Readable, output: Writable): void {
  const write = (message: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(message)}\n`)
  }
  const lines = createInterface({ input, terminal: false })
  lines.on('line', (line) => {
    if (line.trim() === '') return
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    const id = request.id
    switch (request.method) {
      case 'initialize': {
        const params = request.params as { protocolVersion?: string } | undefined
        write({
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            protocolVersion: params?.protocolVersion ?? '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'dsh-member-bridge', version: '0.1.0' },
          },
        })
        return
      }
      case 'ping':
        write({ jsonrpc: '2.0', id: id ?? null, result: {} })
        return
      case 'tools/list':
        write({
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            tools: [{
              name: MEMBER_MESSAGE_TOOL,
              description: TOOL_DESCRIPTION,
              inputSchema: TOOL_SCHEMA,
            }, ...ROOM_TOOLS],
          },
        })
        return
      case 'tools/call': {
        const params = request.params as { name?: string; arguments?: { to?: unknown; text?: unknown } } | undefined
        if (ROOM_TOOLS.some(tool => tool.name === params?.name)) {
          void callRoomCommand(env, params!.name as MemberRoomCommandName, params!.arguments ?? {}).then(result => write({ jsonrpc: '2.0', id: id ?? null, result }))
          return
        }
        if (params?.name !== MEMBER_MESSAGE_TOOL) {
          write({ jsonrpc: '2.0', id: id ?? null, error: { code: -32602, message: `unknown tool ${String(params?.name)}` } })
          return
        }
        void callMemberMessage(env, params.arguments ?? {}).then((result) => {
          write({ jsonrpc: '2.0', id: id ?? null, result })
        })
        return
      }
      default:
        // Notifications (no id) — e.g. notifications/initialized — get no reply.
        if (id !== undefined) {
          write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(request.method)}` } })
        }
    }
  })
}

/** True when this file is the process entry (`node member-bridge.js`). */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  serveMemberBridge({
    socket: process.env[MEMBER_BRIDGE_SOCKET_ENV],
    token: process.env[MEMBER_BRIDGE_TOKEN_ENV],
  }, process.stdin, process.stdout)
}
