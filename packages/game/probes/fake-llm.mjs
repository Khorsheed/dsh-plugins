// Fake OpenAI-compatible chat endpoint: logs each request's messages, answers with one short text.
import http from 'node:http'
import { appendFileSync } from 'node:fs'
const [port, logFile, delay = '0'] = process.argv.slice(2)
http.createServer((q, r) => {
  let body = ''
  q.on('data', c => body += c)
  q.on('end', () => setTimeout(() => {
    let j = {}; try { j = JSON.parse(body) } catch {}
    appendFileSync(logFile, JSON.stringify({ at: Date.now(), url: q.url, messages: (j.messages || []).map(m => ({ role: m.role, text: typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join('') })).slice(-6) }) + '\n')
    if (!q.url.includes('chat/completions')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"data":[{"id":"fake-1","object":"model"}]}') }
    const text = '好的，已经改好了。'
    if (j.stream) {
      r.writeHead(200, { 'content-type': 'text/event-stream' })
      const ch = (delta, finish) => r.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n')
      ch({ role: 'assistant', content: text }, null); ch({}, 'stop')
      r.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n')
      r.end('data: [DONE]\n\n')
    } else {
      r.writeHead(200, { 'content-type': 'application/json' })
      r.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'fake-1', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
    }
  }, Number(delay)))
}).listen(Number(port), '127.0.0.1', () => console.log('fake llm on', port))
