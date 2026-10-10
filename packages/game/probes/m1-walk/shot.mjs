// Open the walkthrough session in the web UI and screenshot the game tab.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241', OUT = process.env.OUT
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const sid = readFileSync(join(H, 'sid'), 'utf8')
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage()
p.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)) })
await p.setViewport({ width: Number(process.env.W || 1440), height: Number(process.env.HGT || 900) })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' })
const wait = ms => new Promise(r => setTimeout(r, ms))
await wait(4000)
const step = process.env.STEP || 'probe'
const texts = () => p.evaluate(() => [...document.querySelectorAll('button,[role=tab],[role=button],a')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(Boolean).slice(0, 120))
const click = t => p.evaluate(t => { const el = [...document.querySelectorAll('button,a,[role=button],[role=tab],[role=treeitem],div,span')].filter(e => (e.getAttribute('aria-label') || e.textContent || '').trim() === t).pop(); if (el) { el.click(); return true } return false }, t)
const clickHas = t => p.evaluate(t => { const el = [...document.querySelectorAll('a,button,[role=button],[role=treeitem],li,div')].filter(e => (e.textContent || '').includes(t) && e.textContent.length < 80).pop(); if (el) { el.click(); return el.textContent.trim().slice(0, 40) } return null }, t)
console.log('url', p.url().replace(/token=[^&]+/, 'token=***'))
for (const s of (process.env.CLICKS || '').split('|').filter(Boolean)) {
  const ok = s.startsWith('~') ? await clickHas(s.slice(1)) : await click(s)
  console.log('click', s, ok); await wait(1500)
}
if (process.env.KEYS) {
  const f = await p.$('iframe[sandbox]'); const box = f && await f.boundingBox()
  if (box) { await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await wait(300) }
  await p.keyboard.down('ArrowRight'); await wait(2500); await p.keyboard.up('ArrowRight'); await wait(300)
}
console.log('url-after', p.url().replace(/token=[^&]+/, 'token=***'))
await p.screenshot({ path: join(OUT, (process.env.NAME || 'probe') + '.png') })
await b.close()
