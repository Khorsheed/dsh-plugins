const { default: puppeteer } = await import(process.env.PUPPETEER_CORE)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 })
await p.goto('file://' + process.env.PROTO, { waitUntil: 'load' })
for (const i of process.argv.slice(2)) {
  await p.evaluate(i => document.querySelectorAll('#steps > *')[i].click(), Number(i))
  await new Promise(r => setTimeout(r, 400))
  await p.screenshot({ path: `${process.env.OUT}/proto-s${i}.png` })
}
await b.close()
