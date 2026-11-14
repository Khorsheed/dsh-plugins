import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { provisionDshScope } from '../src/provision.ts'

interface WireMessage {
  id?: number
  method?: string
  result?: unknown
  error?: { message: string }
  params?: {
    turn?: number
    reason?: { kind?: string }
    event?: { type?: string; data?: { message?: { content?: Array<{ type?: string; text?: string }> } } }
  }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`${label} timed out`)) }, 20_000)
      timer.unref()
    })])
  } finally {
    clearTimeout(timer)
  }
}

describe('account delegation through the real sub-dsh CLI', () => {
  it('prepares and completes a live round with the inherited account token', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-account-round-'))
    const headers: Array<{ account: string | undefined; apiKey: string | undefined }> = []
    const server = createServer((request, response) => {
      const isListing = request.method === 'GET' && request.url === '/models'
      const isMessage = request.method === 'POST' && request.url === '/anthropic/v1/messages'
      if (!isListing && !isMessage) {
        response.writeHead(404).end()
        return
      }
      headers.push({ account: request.headers['x-dsh-auth-token'], apiKey: request.headers['x-api-key'] })
      request.on('data', () => {})
      request.on('end', () => {
        if (isListing) {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{
            id: 'deepseek-flash', name: 'Account Flash', context_window: 1_048_576, max_output_tokens: 393_216,
            input_modalities: ['text'], output_modalities: ['text'], effort: { supported_levels: ['high'], default_level: 'high' },
            api_capabilities: { anthropic_messages: {} },
          }] }))
          return
        }
        const events = [
          { type: 'message_start', message: { id: 'msg_account', model: 'deepseek-flash', usage: { input_tokens: 3, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ]
        response.writeHead(200, { 'content-type': 'text/event-stream' })
          .end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${address.port}`
    const harness = process.env['DSH_HARNESS'] ?? join(homedir(), 'code/deepseek-harness')
    provisionDshScope(home, { inheritModelConfiguration: true })
    const child = spawn(process.execPath, [
      '--import', 'tsx/esm', join(harness, 'apps/cli/src/bin.ts'), '--profile', 'headless-local-agent-dsh',
      '--serve', '--model', 'deepseek-account/deepseek-flash',
    ], {
      cwd: harness,
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_AGENTS_HOME: join(home, 'agents'),
        TSX_TSCONFIG_PATH: join(harness, 'tsconfig.json'),
        DSH_MEMBER_BRIDGE_ENTRY: fileURLToPath(new URL('../../local-agent/lib/member-bridge.js', import.meta.url)),
        DSH_MEMBER_SOCKET: join(home, 'member.sock'),
        DSH_MEMBER_TOKEN: 'fixture-member-token',
        DSH_LOCAL_AGENT_MODEL_CONFIG: JSON.stringify({ deepseekAccount: { baseURL: `${origin}/anthropic` } }),
        DSH_LOCAL_AGENT_DEEPSEEK_ACCOUNT_TOKEN: 'fixture-account-token',
        DSH_LOCAL_AGENT_DEEPSEEK_ACCOUNT_ORIGIN: origin,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exited = new Promise<number | null>(resolve => { child.once('close', code => { resolve(code) }) })
    let diagnostics = ''
    let answer = ''
    let buffer = ''
    const messages: WireMessage[] = []
    const pending = new Map<number, (message: WireMessage) => void>()
    let idle!: (message: WireMessage) => void
    const idleMessage = new Promise<WireMessage>(resolve => { idle = resolve })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { diagnostics = (diagnostics + chunk).slice(-8000) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (line === '') continue
        const message = JSON.parse(line) as WireMessage
        messages.push(message)
        if (message.id !== undefined) {
          pending.get(message.id)?.(message)
          pending.delete(message.id)
        }
        if (message.method === 'session/idle' && message.params?.turn === 1) idle(message)
        if (message.params?.event?.type === 'assistant/message') {
          answer = message.params.event.data?.message?.content?.filter(block => block.type === 'text').map(block => block.text).join('') ?? answer
        }
      }
    })
    const request = (id: number, method: string, params: Record<string, unknown> = {}): Promise<WireMessage> => {
      const response = new Promise<WireMessage>(resolve => { pending.set(id, resolve) })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      return bounded(response, `${method}: ${diagnostics}`)
    }
    try {
      const initialized = await request(1, 'initialize')
      expect(initialized.result).toEqual({
        serverInfo: { name: '@khorsheed/dsh-local-agent-dsh-headless/serve' }, protocolVersion: 1,
      })
      expect((await request(2, 'session/prepare')).result).toEqual({ prepared: true })
      expect((await request(3, 'turn/start', { sessionId: 'account-member', text: 'Reply with OK', resume: false, turn: 1 })).result)
        .toEqual({ accepted: true })
      expect((await bounded(idleMessage, `turn: ${diagnostics}`)).params?.reason?.kind).toBe('completed')
      expect(answer, JSON.stringify({ headers, messages: messages.filter(message => message.method === 'session/idle' || message.params?.event?.type === 'assistant/message') })).toBe('OK')
      await request(4, 'shutdown')
      expect(await bounded(exited, `exit: ${diagnostics}`)).toBe(0)
      expect(headers.length).toBeGreaterThanOrEqual(2)
      for (const header of headers) expect(header).toEqual({ account: 'fixture-account-token', apiKey: undefined })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
      await new Promise(resolve => server.close(resolve))
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})
