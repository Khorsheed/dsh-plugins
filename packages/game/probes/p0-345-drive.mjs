// Drives the temp instance over its Remote RPC (token → cookie, POST /api/<ns>/<method>).
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const login = await fetch(BASE + '/?token=' + token, { redirect: 'manual' })
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
async function rpc(method, args) {
  const r = await fetch(BASE + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return j
}
const dir = join(H, 'gamedev-probe'), wait = ms => new Promise(r => setTimeout(r, ms))
const events = () => readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
async function idle(sid, after) {
  for (let i = 0; i < 120; i++) { await wait(500); if (events().some(e => e.ev === 'turn/end' && e.agent === sid && e.at > after)) { await wait(600); const l = events().filter(e => e.ev === 'turn/end' && e.agent === sid && e.at > after); return l } }
  return 'timeout'
}
const ws = join(H, 'ws'); mkdirSync(ws, { recursive: true })
const step = process.argv[2]
if (step === 'setup') {
  const c = await rpc('session/create', { request: { cwd: ws } }); console.log('create', JSON.stringify(c).slice(0, 300))
  const sid = c.result.value.sessionId
  writeFileSync(join(H, 'sid'), String(sid))
  console.log('select', JSON.stringify(await rpc('session/selectModel', { request: { sessionId: sid, provider: 'fake', model: 'fake-1' } })).slice(0, 400))
}
const sid = readFileSync(join(H, 'sid'), 'utf8')
const prompt = (text, mode = 'queue') => rpc('session/prompt', { request: { requestId: randomUUID(), sessionId: sid, mode, content: [{ type: 'text', text }] } })
if (step === 'attach') {
  writeFileSync(join(dir, 'pending.txt'), '自上轮以来：参数 移动速度 1.4→1.8 · 耗油/秒 1.2→0.9；元素 雾潮.出现 第2夜起→第3夜起')
  const t = Date.now(); console.log('prompt', JSON.stringify(await prompt('雾怪是不是太快了？')).slice(0, 200))
  console.log('turn/end', JSON.stringify(await idle(sid, t)))
}
if (step === 'fail') {
  writeFileSync(join(dir, 'fail-checks'), '1')
  const t = Date.now(); console.log('prompt', JSON.stringify(await prompt('加一个二段跳')).slice(0, 200))
  console.log('turn/end', JSON.stringify(await idle(sid, t)))
  unlinkSync(join(dir, 'fail-checks'))
}
if (step === 'midrun') {
  // user steers while the agent is running; a pending change exists at that moment
  const t = Date.now(); await prompt('先说说你的计划')
  await wait(400)
  writeFileSync(join(dir, 'pending.txt'), '自上轮以来：参数 雾怪速度 0.7→0.5')
  console.log('steer', JSON.stringify(await prompt('顺便把雾怪调慢一点', 'steer')).slice(0, 200))
  console.log('turn/end', JSON.stringify(await idle(sid, t)))
}
