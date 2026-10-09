// Scripted OpenAI-compatible model for the M1 walkthrough. It reads the
// conversation and plays one scene: create the project → write a first
// version with a slow keeper (the test fails) → on the plugin's check
// message, read + fix rules.js → finish. Logs every request.
import http from 'node:http'
import { appendFileSync } from 'node:fs'
import { CORE_LOOP, ELEMENTS, INDEX, MAIN, RULES_BUGGY, RULES_FIXED, TEST } from './game-files.mjs'
const [port, logFile] = process.argv.slice(2)
const textOf = m => typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join('')
let n = 0
function decide(messages) {
  const last = messages[messages.length - 1] || {}
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const calls = lastAssistant?.tool_calls || []
  const callNames = calls.map(c => c.function?.name)
  const all = messages.map(textOf).join('\n')
  const root = (all.match(/目录 (\/[^，\s]+)/) || [])[1]
  if (last.role === 'user' && textOf(last).includes('游戏检查未通过')) return { tools: [['read', { file_path: root + '/src/rules.js' }]] }
  if (last.role === 'tool' && callNames[0] === 'read') return { tools: [['write', { file_path: root + '/src/rules.js', content: RULES_FIXED }]] }
  if (last.role === 'tool' && calls.some(c => (c.function?.arguments || '').includes('KEEPER_SPEED = 60'))) return { text: '修好了：守夜人速度从 40 调到 60 px/秒，3 秒能走出 180px，测试会在这一轮结束时重新跑。现在可以在右栏「试玩」里玩第一版了——←/→ 走动，接住掉下来的灯油。' }
  if (last.role === 'user' && !all.includes('已建项目')) return { tools: [['game_open', { create: '灯塔守夜人', pitch: '你是孤岛上的守夜人，在雾夜里接住灯油、让灯一直亮着，撑到天亮。', elementTypes: '角色、道具、敌人', artStyle: 'pixel', pillars: '一个人守夜的紧张感；简单操作，越往后越手忙脚乱' }]] }
  if (last.role === 'tool' && callNames[0] === 'game_open') return { tools: [
    ['write', { file_path: root + '/index.html', content: INDEX }],
    ['write', { file_path: root + '/src/main.js', content: MAIN }],
    ['write', { file_path: root + '/src/rules.js', content: RULES_BUGGY }],
    ['write', { file_path: root + '/elements/units.json', content: ELEMENTS }],
    ['write', { file_path: root + '/tests/move.test.js', content: TEST }],
    ['write', { file_path: root + '/design/core-loop.md', content: CORE_LOOP }],
  ] }
  if (last.role === 'tool') return { text: '第一版写好了：像素风的灯塔、守夜人和掉落的灯油，元素放在 elements/units.json，核心循环写进了策划。' }
  return { text: '好的。' }
}
http.createServer((q, r) => {
  let body = ''
  q.on('data', c => body += c)
  q.on('end', () => {
    let j = {}; try { j = JSON.parse(body) } catch {}
    const messages = j.messages || []
    if (!q.url.includes('chat/completions')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"data":[{"id":"fake-1","object":"model"}]}') }
    const d = decide(messages)
    appendFileSync(logFile, JSON.stringify({ at: Date.now(), last: messages.slice(-1).map(m => ({ role: m.role, text: textOf(m).slice(0, 300) })), decided: d.text ? 'text' : d.tools.map(t => t[0]) }) + '\n')
    r.writeHead(200, { 'content-type': 'text/event-stream' })
    const ch = (delta, finish) => r.write('data: ' + JSON.stringify({ id: 'x' + n, object: 'chat.completion.chunk', created: 1, model: 'fake-1', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n')
    if (d.text) { ch({ role: 'assistant', content: d.text }, null); ch({}, 'stop') }
    else {
      d.tools.forEach(([name, args], index) => ch({ role: 'assistant', tool_calls: [{ index, id: 'call_' + (++n), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, null))
      ch({}, 'tool_calls')
    }
    r.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n')
    r.end('data: [DONE]\n\n')
  })
}).listen(Number(port), '127.0.0.1', () => console.log('scripted llm on', port))
