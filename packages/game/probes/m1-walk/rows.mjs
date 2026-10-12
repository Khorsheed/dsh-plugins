import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const wait = ms => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage(); await p.setViewport({ width: 1100, height: 900 })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' }); await wait(4000)
const ev = (f, a) => p.evaluate(f, a)
await ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '继续')?.click()); await wait(600)
await ev(() => [...document.querySelectorAll('div,span,button')].filter(e => e.textContent.trim() === '未分组').pop()?.click()); await wait(1200)
await ev(() => [...document.querySelectorAll('div,a,li')].filter(e => (e.textContent || '').includes('我想做个小游戏') && e.textContent.length < 40).pop()?.click()); await wait(3000)
console.log(await ev(() => { const els = [...document.querySelectorAll('button,[role=button],div,span')].filter(e => /^已完成，用时 \d+\s?秒/.test((e.textContent || '').trim()) && e.textContent.length < 20); els.forEach(e => e.click()); return els.length })); await wait(1500)
console.log(await ev(() => { const els = [...document.querySelectorAll('button,[role=button],div,span')].filter(e => /^已(写入|读取|完成分析|调用)/.test((e.textContent || '').trim()) && e.textContent.length < 30); els.forEach(e => e.click()); return els.length })); await wait(1500)
for (const [label, name] of [['检查未通过', 'w-row-fail'], ['已附上', 'w-row-attached']]) {
  await ev(l => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.includes(l)); el?.click(); el?.scrollIntoView({ block: 'center' }) }, label)
  await wait(700)
  await ev(l => { [...document.querySelectorAll('button')].find(b => b.textContent.includes(l))?.scrollIntoView({ block: 'center' }) }, label)
  await wait(300)
  await p.screenshot({ path: join(process.env.OUT, name + '.png') })
}
await b.close()
