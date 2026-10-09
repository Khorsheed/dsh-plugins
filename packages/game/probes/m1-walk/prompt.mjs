import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const login = await fetch(BASE + '/?token=' + token, { redirect: 'manual' })
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
const sid = readFileSync(join(H, 'sid'), 'utf8')
const r = await fetch(BASE + '/api/session/prompt', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'session/prompt', payload: { args: { request: { requestId: randomUUID(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: process.argv[2] }] } } } }) })
console.log((await r.text()).slice(0, 160))
