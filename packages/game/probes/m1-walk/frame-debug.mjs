import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' })
const wait = ms => new Promise(r => setTimeout(r, ms)); await wait(4000)
const click = t => p.evaluate(t => { const el = [...document.querySelectorAll('button,a,[role=button],div,span')].filter(e => (e.getAttribute('aria-label') || e.textContent || '').trim() === t).pop(); el?.click() }, t)
const clickHas = t => p.evaluate(t => { const el = [...document.querySelectorAll('a,button,[role=button],li,div')].filter(e => (e.textContent || '').includes(t) && e.textContent.length < 80).pop(); el?.click() }, t)
await click('继续'); await wait(800); await click('未分组'); await wait(1200); await clickHas('我想做个小游戏'); await wait(2000); await click('打开右侧边栏'); await wait(1500); await clickHas('和 agent 一起做小游戏'); await wait(3000)
const frame = p.frames().find(f => f !== p.mainFrame() && f.url().startsWith('about:srcdoc'))
console.log('frames', p.frames().map(f => f.url().slice(0, 40)))
if (frame) console.log(await frame.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, css: getComputedStyle(c).width + ' ' + getComputedStyle(c).height, inner: innerWidth + 'x' + innerHeight, head: document.head.innerHTML.slice(0, 600) } }))
await b.close()
