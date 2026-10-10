import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const wait = ms => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' }); await wait(4000)
const ev = (f, a) => p.evaluate(f, a)
await ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '继续')?.click()); await wait(600)
await ev(() => [...document.querySelectorAll('div,span,button')].filter(e => e.textContent.trim() === '未分组').pop()?.click()); await wait(1200)
await ev(() => [...document.querySelectorAll('div,a,li')].filter(e => (e.textContent || '').includes('我想做个小游戏') && e.textContent.length < 40).pop()?.click()); await wait(2500)
await ev(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '打开右侧边栏')?.click()); await wait(1200)
await ev(() => [...document.querySelectorAll('div,a,li,button')].filter(e => (e.textContent || '').includes('游戏策划操作台') && e.textContent.length < 80).pop()?.click()); await wait(3000)
console.log(JSON.stringify(await ev(() => {
  const btn = document.querySelector('[class*=titleSwitch]')
  const chain = []; let el = btn
  for (let i = 0; i < 5 && el; i++) { const cs = getComputedStyle(el); chain.push({ tag: el.tagName, cls: el.className.slice(0, 40), w: Math.round(el.getBoundingClientRect().width), flex: cs.flex, maxw: cs.maxWidth, minw: cs.minWidth }); el = el.parentElement }
  const row = btn.closest('[data-compact]'); const kids = row ? [...row.children].map(k => ({ cls: k.className.slice(0, 30), w: Math.round(k.getBoundingClientRect().width) })) : []
  return { chain, kids }
}), null, 1))
await b.close()
