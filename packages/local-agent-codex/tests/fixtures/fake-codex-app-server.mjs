/**
 * A fake `codex app-server --stdio` for the model-catalog specs: NDJSON
 * JSON-RPC over stdio. Answers `initialize`, ignores the `initialized`
 * notification, and answers `model/list` with a fixture carrying a hidden
 * entry, a duplicate, a `model`-only entry, and a non-string id. Behavior
 * switches on FAKE_CODEX_MODE:
 *   (unset)   — the well-formed fixture below;
 *   "garbage" — a malformed wire line, then a wrong-shaped model/list result;
 *   "silent"  — answers initialize, then never answers model/list.
 * The process never exits on its own (the probe's teardown owns its death).
 */

const MODELS = [
  { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', description: 'fixture', hidden: false, supportedReasoningEfforts: [] },
  { id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false },
  { id: 'gpt-5-legacy', model: 'gpt-5-legacy', displayName: 'legacy', hidden: true },
  { id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5 dup', hidden: false },
  { model: 'only-model-field', hidden: false },
  { id: 42, hidden: false },
]

const MODE = process.env.FAKE_CODEX_MODE ?? ''
let buffer = ''

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function answer(request) {
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: { serverInfo: { name: 'fake-codex', version: '0.144.0' } } })
    return
  }
  if (request.method === 'model/list') {
    if (MODE === 'silent') return
    if (MODE === 'garbage') {
      process.stdout.write('this is not json\n')
      write({ jsonrpc: '2.0', id: request.id, result: { data: 'not-an-array' } })
      return
    }
    write({ jsonrpc: '2.0', id: request.id, result: { data: MODELS } })
  }
}

process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8')
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    if (line.trim() === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.id !== undefined && typeof message.method === 'string') answer(message)
  }
})
