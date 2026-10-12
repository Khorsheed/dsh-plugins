// P0-1: a panel-like http page hosts an opaque-origin sandboxed iframe; the
// project's files go in by postMessage; we check modules, nested imports,
// dynamic import, fetch of JSON, <img>/new Image, CSS url(), error capture.
import http from 'node:http'
import { shellHtml, readProject } from './vfs-boot.js'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)

const root = new URL('./fixture-game/', import.meta.url).pathname
const good = await readProject(root)
const broken = { ...good, 'data/enemies.json': { type: 'application/json', text: '[{"id": fog' } }
const js = v => JSON.stringify(v).replace(/</g, '\\u003c')
const parentPage = (files) => `<!doctype html><meta charset="utf-8"><body>
<iframe id="f" sandbox="allow-scripts" width="320" height="200"></iframe>
<script>
window.__log = [];
const f = document.getElementById('f');
addEventListener('message', e => { if (e.source === f.contentWindow) window.__log.push(e.data) });
f.addEventListener('load', () => f.contentWindow.postMessage({ gamedev: 'files', files: ${js(files)} }, '*'), { once: true });
f.srcdoc = ${js(shellHtml())};
window.__send = m => f.contentWindow.postMessage(m, '*');
</script>`
const pages = { '/good': parentPage(good), '/broken': parentPage(broken) }
const server = http.createServer((q, r) => { r.writeHead(pages[q.url] ? 200 : 404, { 'content-type': 'text/html' }); r.end(pages[q.url] || '') })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
const out = {}
for (const name of ['good', 'broken']) {
  const p = await browser.newPage()
  await p.goto(base + '/' + name, { waitUntil: 'load' })
  await wait(800)
  await p.evaluate(() => window.__send({ gamedev: 'inspect' }))
  await wait(200)
  await p.evaluate(() => { window.__send({ gamedev: 'input', key: 'ArrowRight', down: true }); window.__send({ gamedev: 'step', n: 60 }); window.__send({ gamedev: 'inspect' }) })
  await wait(300)
  const log = await p.evaluate(() => window.__log)
  const origin = await p.evaluate(() => { try { return document.getElementById('f').contentWindow.document ? 'readable(!)' : '?' } catch (e) { return 'blocked (opaque origin)' } })
  out[name] = { origin, messages: log.map(m => m.gamedev === 'inspect' ? { inspect: { ready: m.ready, x: m.state && Math.round(m.state.player.x), oil: m.state && Math.round(m.state.oil), enemies: m.state && m.state.enemies, lazy: m.lazy, iconWidth: m.iconWidth, bodyBg: m.bodyBg, errors: m.errors.length } } : m) }
  if (name === 'good') await p.screenshot({ path: new URL('./p0-1-good.png', import.meta.url).pathname })
}
console.log(JSON.stringify(out, null, 1))
await browser.close(); server.close()
