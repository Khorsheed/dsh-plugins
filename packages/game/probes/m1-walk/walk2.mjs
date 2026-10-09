// Workbench walkthrough in the real UI: one page, a sequence of gestures,
// a screenshot after each. Usage: DSH_HOME=… PUPPETEER_CORE=… OUT=… node walk2.mjs <phase>
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241', OUT = process.env.OUT
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const phase = process.argv[2] || 'a'
const wait = ms => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage()
p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) console.log('console.error', m.text().slice(0, 200)) })
p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)))
await p.setViewport({ width: Number(process.env.W || 1440), height: Number(process.env.HGT || 960) })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' })
await wait(4000)
const click = t => p.evaluate(t => { const el = [...document.querySelectorAll('button,a,[role=button],[role=tab],div,span,summary')].filter(e => (e.getAttribute('aria-label') || e.textContent || '').trim() === t).pop(); if (el) { el.click(); return true } return false }, t)
const clickHas = t => p.evaluate(t => { const el = [...document.querySelectorAll('a,button,[role=button],li,div')].filter(e => (e.textContent || '').includes(t) && e.textContent.length < 80).pop(); if (el) { el.click(); return true } return false }, t)
const shot = async name => { await wait(900); await p.screenshot({ path: join(OUT, name + '.png') }); console.log('shot', name) }
const log = (...a) => console.log(...a)
async function rpc(method, args) {
  const cookie = (await p.cookies()).map(c => `${c.name}=${c.value}`).join('; ')
  const r = await fetch(BASE + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) })
  return r.json()
}
async function openTab(session) {
  log('继续', await click('继续')); await wait(600)
  log('未分组', await click('未分组')); await wait(1200)
  log('session', await clickHas(session)); await wait(2500)
  log('open right', await click('打开右侧边栏')); await wait(1200)
  log('guide', await clickHas('游戏策划操作台')); await wait(3000)
}
const sliderSet = (index, value) => p.evaluate((index, value) => {
  const el = document.querySelectorAll('input[type=range]')[index]
  if (!el) return false
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })); return true
}, index, value)

if (phase === 'a') {
  await openTab('我想做个小游戏')
  await shot('w-play')
  log('slider', await sliderSet(0, 85)); await wait(1500)
  log('slider', await sliderSet(3, 30)); await wait(1500)
  await shot('w-play-tuned')
  log('pick', await click('点选'))
  const f = await p.$('iframe[sandbox]'); const box = await f.boundingBox()
  // the keeper stands near x≈40..54 of 320, y≈144..156 of 200 in the letterboxed canvas
  const cw = box.width, ch = cw * 200 / 320, top = box.y + (box.height - ch) / 2
  await p.mouse.click(box.x + cw * 47 / 320, top + ch * 150 / 200); await wait(1200)
  await shot('w-pick')
  log('elements tab', await click('元素')); await wait(1500)
  await shot('w-elements')
  log('open fog', await clickHas('雾灵')); await wait(1500)
  await shot('w-element-detail')
  await p.evaluate(() => { const ta = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, '更吓人一点，像会追人的东西'); ta.dispatchEvent(new Event('input', { bubbles: true })) })
  await wait(400)
  log('to chat', await click('放进对话')); await wait(1200)
  await shot('w-drafted')
}
if (phase === 'b') {
  await openTab('我想做个小游戏')
  log('elements tab', await click('元素')); await wait(1200)
  log('open fog', await clickHas('雾灵')); await wait(1800)
  await p.evaluate(() => { const el = [...document.querySelectorAll('canvas')].find(c => c.width >= 200); el?.scrollIntoView() })
  await p.evaluate(() => document.querySelectorAll('section')[2]?.scrollIntoView())
  await shot('w-proposals')
  log('pick B', await p.evaluate(() => { const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '就要这个'); btns[1]?.click(); return btns.length }))
  await wait(2500)
  await p.evaluate(() => document.querySelector('[class*=scroll]')?.scrollTo(0, 0))
  await shot('w-picked')
  log('back', await clickHas('全部元素')); await wait(1200)
  await shot('w-elements-after')
  log('design', await click('策划')); await wait(1500)
  await shot('w-design')
  log('open mech', await clickHas('机制与规则')); await wait(1000)
  await shot('w-design-open')
  log('open numbers', await clickHas('元素与数值')); await wait(1000)
  await p.evaluate(() => { const h = [...document.querySelectorAll('button')].find(b => b.textContent.includes('元素与数值')); h?.scrollIntoView() })
  await shot('w-design-numbers')
  log('versions', await click('版本')); await wait(2000)
  await shot('w-versions')
  log('style', await click('美术风格')); await wait(1200)
  await shot('w-style')
}
if (phase === 'c') {
  // the conversation rows, scrolled to show them
  log('继续', await click('继续')); await wait(600)
  log('未分组', await click('未分组')); await wait(1200)
  log('session', await clickHas('我想做个小游戏')); await wait(3000)
  await shot('w-chat')
  log('expand turn', await p.evaluate(() => { const el = [...document.querySelectorAll('button,[role=button],div,span')].filter(e => /^已完成，用时 2/.test((e.textContent || '').trim()) && e.textContent.length < 20).pop(); el?.click(); return !!el })); await wait(1200)
  log('rows', await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => /检查未通过|已附上/.test(b.textContent || '')).map(b => b.textContent.slice(0, 40))))
  log('expand fail row', await clickHas('检查未通过 1/2')); await wait(800)
  await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.includes('检查未通过')); el?.scrollIntoView({ block: 'center' }) })
  await shot('w-chat-rows')
}
if (phase === 'd') {
  // a fresh game-mode session: the home state
  const created = await rpc('session/create', { request: { cwd: join(H, 'ws'), agentPreset: 'dsh-gamedev' } })
  log('created', JSON.stringify(created).slice(0, 120))
  await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4000)
  log('继续', await click('继续')); await wait(600)
  log('未分组', await click('未分组')); await wait(1200)
  log('new session', await p.evaluate(() => { const rows = [...document.querySelectorAll('[role=treeitem],a,li,div')].filter(e => /新会话|New session|未命名/.test(e.textContent || '') && e.textContent.length < 30); const el = rows.pop(); el?.click(); return el?.textContent }))
  await wait(2500)
  log('open right', await click('打开右侧边栏')); await wait(1200)
  log('guide', await clickHas('游戏策划操作台')); await wait(2500)
  await shot('w-home')
}
if (phase === 'e') {
  await openTab('我想做个小游戏')
  await shot('w-play2')
  log('more', await click('更多')); await wait(600)
  log('switch', await clickHas('切换项目')); await wait(1200)
  log('unbind', await click('本会话不绑定项目')); await wait(2000)
  await shot('w-home')
  await p.evaluate(() => document.querySelectorAll('[class*=scroll]')[0]?.scrollTo(0, 9999)); await wait(500)
  await shot('w-home-bottom')
  log('rebind', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => (b.textContent || '').startsWith('灯塔守夜人')); el?.click(); return !!el })); await wait(2000)
}
if (phase === 'f') {
  await openTab('我想做个小游戏')
  await shot('w-narrow-play')
  log('elements tab', await click('元素')); await wait(1200)
  log('open fog', await clickHas('雾灵')); await wait(1500)
  await shot('w-narrow-element')
}
if (phase === 'g') {
  await openTab('我想做个小游戏')
  await shot('s-header')
  log('title switch', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('灯塔守夜人') && b.textContent.includes('▾')); el?.click(); return !!el })); await wait(2000)
  await shot('s-switcher')
  log('pick other', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('雾港快递')); el?.click(); return !!el })); await wait(3000)
  await shot('s-switched')
  log('new', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('雾港快递') && b.textContent.includes('▾')); el?.click(); return !!el })); await wait(1500)
  log('new card', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => (b.textContent || '').startsWith('＋新建项目')); el?.click(); return !!el })); await wait(1500)
  await shot('s-new')
  log('back to lighthouse', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('灯塔守夜人') && (b.textContent || '').includes('v1')); el?.click(); return !!el })); await wait(1500)
}
if (phase === 'h') {
  await openTab('我想做个小游戏')
  log('title', await p.evaluate(() => { const el = document.querySelector('[class*=titleSwitch]'); el?.click(); return el?.textContent }))
  await wait(2000)
  log('pick lighthouse', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('灯塔守夜人') && (b.textContent || '').includes('像素')); el?.click(); return !!el }))
  await wait(2500)
  log('now', await p.evaluate(() => document.querySelector('[class*=titleSwitch]')?.textContent))
}
if (phase === 'i') {
  await openTab('我想做个小游戏')
  log('slider', await sliderSet(1, 1.4)); await wait(1500)
  await shot('x-dock')
  log('expand', await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null && (b.textContent || '').startsWith('面板改动')); el?.click(); return !!el })); await wait(600)
  log('write', await click('写进对话')); await wait(1200)
  await shot('x-written')
  await p.keyboard.type('耗油这样节奏刚好，后面关卡按这个调。'); await wait(400)
  await shot('x-draft')
  log('send', await click('发送消息')); await wait(6000)
  await shot('x-sent')
}
await b.close()
