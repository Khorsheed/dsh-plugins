// Drive the walkthrough over the instance's RPC: create a 游戏开发模式 session,
// send one prompt, wait for the version to land in the play area.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const login = await fetch(BASE + '/?token=' + token, { redirect: 'manual' })
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
async function rpc(method, args) {
  const r = await fetch(BASE + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) })
  const t = await r.text(); try { return JSON.parse(t) } catch { return t }
}
const ws = join(H, 'ws')
const c = await rpc('session/create', { request: { cwd: ws, agentPreset: 'dsh-gamedev' } })
console.log('create', JSON.stringify(c).slice(0, 300))
const sid = c.result.value.sessionId
writeFileSync(join(H, 'sid'), String(sid))
console.log('select', JSON.stringify(await rpc('session/selectModel', { request: { sessionId: sid, provider: 'fake', model: 'fake-1' } })).slice(0, 200))
const p = await rpc('session/prompt', { request: { requestId: randomUUID(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: '我想做个小游戏：雾夜里守灯塔，像素风。主角是守夜人，要接住灯油让灯一直亮着，灯暗了雾就会涌上来。' }] } })
console.log('prompt', JSON.stringify(p).slice(0, 200))
const current = join(ws, 'game', '.game', 'current.json')
for (let i = 0; i < 120 && !existsSync(current); i++) await new Promise(r => setTimeout(r, 1000))
console.log('current', existsSync(current) ? readFileSync(current, 'utf8') : 'none')
