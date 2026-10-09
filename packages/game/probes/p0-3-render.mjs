// Screenshot how gamedev-sourced messages render in the chat.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const H = process.env.DSH_HOME, BASE = 'http://127.0.0.1:3241'
const token = readFileSync(join(H, 'instance.log'), 'utf8').match(/token=([^\s]+)/)[1]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-proxy-server'] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 1000 })
await p.goto(BASE + '/?token=' + token, { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 4000))
console.log('url after login:', p.url().replace(/token=[^&]+/, 'token=***'))
const clickText = t => p.evaluate(t => { const el = [...document.querySelectorAll('button,a,[role=button],[role=treeitem],div,span')].filter(e => e.textContent && e.textContent.trim() === t).pop(); if (el) { el.click(); return true } return false }, t)
console.log('继续', await clickText('继续')); await new Promise(r => setTimeout(r, 800))
console.log('未分组', await clickText('未分组')); await new Promise(r => setTimeout(r, 1200))
const hit = await p.evaluate(() => { const el = [...document.querySelectorAll('a,button,[role=button],[role=treeitem],li,div')].filter(e => /好的，已经改好了/.test(e.textContent || '') && e.textContent.length < 40).pop(); if (el) { el.click(); return el.textContent.trim().slice(0, 30) } return null })
console.log('clicked:', hit)
await new Promise(r => setTimeout(r, 2500))
console.log('expand', await p.evaluate(() => { const el = [...document.querySelectorAll('button,[role=button],div,span')].filter(e => /用时.{0,3}5.{0,3}秒/.test(e.textContent || '') && e.textContent.length < 30).pop(); if (el) { el.click(); return true } return false }))
await new Promise(r => setTimeout(r, 3000))
console.log('轨迹', await clickText('轨迹')); await new Promise(r => setTimeout(r, 2500))
console.log('url now:', p.url().replace(/token=[^&]+/, 'token=***'))
await p.evaluate(() => { const s = [...document.querySelectorAll("*")].filter(e => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== "visible"); s.forEach(e => e.scrollTop = 0) }); await new Promise(r => setTimeout(r, 500)); await p.screenshot({ path: join(process.env.OUT, "p0-3-trajectory.png") })
await b.close()
