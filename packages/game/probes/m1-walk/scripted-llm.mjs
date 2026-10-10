// Scripted OpenAI-compatible model for the M1 walkthrough. It reads the
// conversation and plays one scene: create the project → write a first
// version with a slow keeper (the test fails) → on the plugin's check
// message, read + fix rules.js → finish. Logs every request.
import http from 'node:http'
import { appendFileSync } from 'node:fs'
import { CORE_LOOP, ELEMENTS, INDEX, MAIN, MECHANICS, TEST, manifest } from './game-files.mjs'
const [port, logFile] = process.argv.slice(2)
const textOf = m => typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join('')
let n = 0
const r = s => s.replace(/ /g, '.')
const FOG_VARIANTS = [
  { label: 'A 烟团', note: '圆滚滚的一团烟，两只黄眼睛', look: { palette: ['#94b0c2', '#ffcd75', '#1a1c2c', '#566c86'], states: { idle: ['...0000...', '..000000..', '.00100100.', '.00000000.', '0000000000', '0000220000', '.03000030.', '.0.00.00.0'].map(r) } } },
  { label: 'B 尖刺雾', note: '边缘带刺，看起来更凶', look: { palette: ['#5d275d', '#ff3864', '#f4f4f4', '#333c57'], states: { idle: ['0..0..0..0', '.00000000.', '0011001100', '.02200220.', '0000000000', '.00033000.', '0.000000.0', '..0.00.0..'].map(r) } } },
  { label: 'C 斗篷幽灵', note: '更像人形，披着斗篷', look: { palette: ['#3b5dc9', '#73eff7', '#1a1c2c', '#29366f'], states: { idle: ['...0000...', '..000000..', '..011110..', '..021120..', '.00000000.', '.03333330.', '0333333330', '03.33.33.3'].map(r) } } },
]
function decide(messages) {
  const last = messages[messages.length - 1] || {}
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const calls = lastAssistant?.tool_calls || []
  const callNames = calls.map(c => c.function?.name)
  const args0 = calls[0]?.function?.arguments || ''
  const all = messages.map(textOf).join('\n')
  const root = (all.match(/目录 (\/[^，\s]+)/) || [])[1]
  const id = (all.match(/已建项目《[^》]+》（(g_[0-9a-f]+)）/) || [])[1]
  const tail = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i--) tail.unshift(textOf(messages[i]))
  const lastText = tail.length > 0 ? tail.join('\n') : textOf(last)
  const wroteIndex = messages.some(m => (m.tool_calls || []).some(c => (c.function?.arguments || '').includes('index.html')))
  if (last.role === 'user' && lastText.includes('加一个敌人')) return { tools: [['read', { file_path: root + '/elements/units.json' }]] }
  if (last.role === 'tool' && callNames[0] === 'read' && args0.includes('units.json') && all.includes('加一个敌人') && !all.includes('"reef"')) {
    const units = JSON.parse(ELEMENTS)
    units.push({ id: 'reef', name: '暗礁', type: '敌人', damage: 2, look: { palette: ['#333c57', '#566c86', '#94b0c2'], states: { idle: ['..0000..', '.011110.', '01122110', '00000000'] } } })
    return { tools: [
      ['write', { file_path: root + '/elements/units.json', content: JSON.stringify(units, null, 2) }],
      ['write', { file_path: root + '/design/levels.md', content: '# 关卡与节奏\n\n- 第 1 夜：只有灯油和雾灵。\n- 第 2 夜起：海面出现暗礁，碰到扣 2 灯油。\n' }],
    ] }
  }
  if (last.role === 'tool' && callNames[0] === 'write' && args0.includes('reef')) return { text: '加了新敌人「暗礁」（碰到扣 2 灯油），并把第 2 夜起出现暗礁写进了「关卡与节奏」。' }
  if (last.role === 'user' && lastText.includes('游戏检查未通过')) return { tools: [['read', { file_path: root + '/game.json' }]] }
  if (last.role === 'tool' && callNames[0] === 'read' && all.includes('游戏检查未通过') && !all.includes('"value": 60')) return { tools: [['write', { file_path: root + '/game.json', content: manifest(id, 60) }]] }
  if (last.role === 'tool' && callNames[0] === 'write' && args0.includes('\\"value\\": 60')) return { text: '修好了：守夜人的默认移动速度从 40 调到 60 px/s，3 秒能走出 180px。现在右栏「试玩」里能玩第一版了——←/→ 走动接灯油；下面的参数可以边玩边拖。' }
  if (last.role === 'user' && lastText.includes('外观改成')) return { tools: [['game_propose', { element: 'fog', request: '更吓人一点', variants: JSON.stringify(FOG_VARIANTS) }]] }
  if (last.role === 'tool' && callNames[0] === 'game_propose') return { text: '给了雾灵 3 个方案，放在右栏「元素 → 雾灵」里：A 还是圆的烟团，B 边缘带刺更凶，C 更像披斗篷的人形。挑中哪个就直接换进游戏。' }
  if (last.role === 'user' && !all.includes('已建项目')) return { tools: [['game_open', { create: '灯塔守夜人', pitch: '你是孤岛上的守夜人，在雾夜里接住灯油、让灯一直亮着，撑到天亮。', elementTypes: '角色、道具、敌人', artStyle: 'pixel', pillars: '一个人守夜的紧张感；简单操作，越往后越手忙脚乱；灯就是生命' }]] }
  if (last.role === 'tool' && callNames[0] === 'game_open') return { tools: [['read', { file_path: root + '/game.json' }]] }
  if (last.role === 'tool' && callNames[0] === 'read' && !wroteIndex) return { tools: [
    ['write', { file_path: root + '/game.json', content: manifest(id, 40) }],
    ['write', { file_path: root + '/index.html', content: INDEX }],
    ['write', { file_path: root + '/src/main.js', content: MAIN }],
    ['write', { file_path: root + '/elements/units.json', content: ELEMENTS }],
    ['write', { file_path: root + '/tests/move.test.js', content: TEST }],
    ['write', { file_path: root + '/design/core-loop.md', content: CORE_LOOP }],
    ['write', { file_path: root + '/design/mechanics.md', content: MECHANICS }],
  ] }
  if (last.role === 'tool') return { text: '第一版写好了：像素风的灯塔、守夜人、灯油滴和雾灵，四个可调参数写进了 game.json，核心循环和机制写进了策划。' }
  if (lastText.includes('用户在右栏游戏面板里改了')) return { text: '收到你在面板里的改动，我会按这些值来调后面的平衡。' }
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
