// P0-1 probe: the in-sandbox loader. Runs inside an opaque-origin iframe
// (sandbox="allow-scripts", no allow-same-origin). Receives the project's files,
// mints blob URLs in the frame's OWN origin, rewrites relative module
// specifiers and CSS url(), shims fetch / element src, then writes index.html.
// The BRIDGE string is re-installed inside the written document because
// document.open() erases every window listener.
const BRIDGE = `(function(){
  var errors = window.__gamedevErrors || (window.__gamedevErrors = []);
  function post(m){ try { if (parent !== window) parent.postMessage(m, '*') } catch (e) {} }
  function report(kind, msg){ errors.push({ kind: kind, msg: String(msg) }); post({ gamedev: 'error', kind: kind, msg: String(msg) }) }
  addEventListener('error', function(e){ report('error', (e.message || '') + ' @' + (e.filename || '').slice(0, 40) + ':' + (e.lineno || '')) });
  addEventListener('unhandledrejection', function(e){ report('rejection', e.reason && e.reason.message || e.reason) });
  if (!console.__gd) { var ce = console.error; console.error = function(){ report('console', [].join.call(arguments, ' ')); return ce.apply(console, arguments) }; console.__gd = 1 }
  addEventListener('dshgame-ready', function(){ post({ gamedev: 'ready' }) });
  addEventListener('message', function(e){
    var d = e.data || {}, g = window.dshGame;
    if (d.gamedev === 'inspect') {
      var icon = document.getElementById('icon');
      post({ gamedev: 'inspect', ready: !!(g && g.ready), state: g && g.state(), lazy: g && g.lazyClamp,
        iconWidth: icon ? icon.naturalWidth : -1, bodyBg: getComputedStyle(document.body).backgroundImage.slice(0, 12),
        errors: errors });
    }
    if (d.gamedev === 'input' && g) g.input(d.key, d.down);
    if (d.gamedev === 'step' && g) { for (var i = 0; i < (d.n || 1); i++) g.step(d.dt || 1 / 60) }
  });
})();`

const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src blob: data:"

function boot(files) {
  const urls = {}
  const norm = (base, rel) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('//')) return null
    const clean = rel.split(/[?#]/)[0]
    const out = []
    for (const seg of ((clean.startsWith('/') ? '' : base) + clean).split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') out.pop(); else out.push(seg)
    }
    return out.join('/')
  }
  const dir = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''
  const bytes = p => {
    const f = files[p]
    if (f.text != null) return new TextEncoder().encode(f.text)
    const bin = atob(f.b64), u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    return u
  }
  const text = p => files[p].text != null ? files[p].text : new TextDecoder().decode(bytes(p))
  const mint = (body, type) => URL.createObjectURL(new Blob([body], { type }))
  const rewriteCss = (css, base) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    const r = norm(base, u); return r && files[r] ? 'url("' + urlFor(r) + '")' : m
  })
  const busy = new Set()
  const modUrl = p => {
    if (urls[p]) return urls[p]
    if (busy.has(p)) throw new Error('module cycle at ' + p)
    busy.add(p)
    const src = text(p).replace(/(\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)(['"])(\.{0,2}\/[^'"]+)\2/g, (m, pre, q, spec) => {
      const r = norm(dir(p), spec); return r && files[r] ? pre + q + modUrl(r) + q : m
    })
    busy.delete(p)
    return (urls[p] = mint(src, 'text/javascript'))
  }
  const urlFor = p => urls[p] || (/\.m?js$/.test(p) ? modUrl(p)
    : /\.css$/.test(p) ? (urls[p] = mint(rewriteCss(text(p), dir(p)), 'text/css'))
    : (urls[p] = mint(bytes(p), files[p].type)))
  const rel = v => { const r = typeof v === 'string' && norm('', v); return r && files[r] ? urlFor(r) : null }

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url
    const r = typeof u === 'string' && norm('', u)
    if (r && files[r]) return Promise.resolve(new Response(bytes(r), { status: 200, headers: { 'content-type': files[r].type } }))
    return nativeFetch(input, init)
  }
  for (const [proto, attr] of [[HTMLImageElement.prototype, 'src'], [HTMLMediaElement.prototype, 'src'], [HTMLSourceElement.prototype, 'src']]) {
    const d = Object.getOwnPropertyDescriptor(proto, attr)
    Object.defineProperty(proto, attr, { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this) }, set(v) { d.set.call(this, rel(v) || v) } })
  }

  const doc = new DOMParser().parseFromString(text('index.html'), 'text/html')
  doc.querySelectorAll('[src]').forEach(el => { const u = rel(el.getAttribute('src')); if (u) el.setAttribute('src', u) })
  doc.querySelectorAll('link[href]').forEach(el => { const u = rel(el.getAttribute('href')); if (u) el.setAttribute('href', u) })
  doc.querySelectorAll('style').forEach(st => { st.textContent = rewriteCss(st.textContent, '') })
  const head = doc.head
  const meta = doc.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = CSP
  const bridge = doc.createElement('script'); bridge.textContent = BRIDGE
  head.prepend(meta, bridge)
  document.open(); document.write('<!doctype html>' + doc.documentElement.outerHTML); document.close()
}

// The srcdoc shell: CSP + bridge + this loader. Files arrive by postMessage, or
// pre-embedded as window.__VFS_FILES__ (headless runs load the shell top-level).
export function shellHtml(extraHead = '') {
  const loader = 'var CSP=' + JSON.stringify(CSP) + ';var BRIDGE=' + JSON.stringify(BRIDGE) + ';window.__boot=' + boot.toString() + ';'
  const start = 'if (window.__VFS_FILES__) window.__boot(window.__VFS_FILES__); else { var once = false; addEventListener("message", function(e){ if (!once && e.data && e.data.gamedev === "files") { once = true; window.__boot(e.data.files) } }) }'
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '">'
    + extraHead + '<script>' + BRIDGE + '</script><script>' + loader + '</script><script>' + start + '</script>'
}

const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg', svg: 'image/svg+xml' }
const TEXT = new Set(['html', 'js', 'mjs', 'css', 'json', 'svg'])
export async function readProject(root) {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, relative, extname } = await import('node:path')
  const files = {}
  const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (!e.name.startsWith('.')) await walk(p); continue }
    const ext = extname(e.name).slice(1).toLowerCase(), key = relative(root, p).split('\\').join('/')
    const buf = await readFile(p)
    files[key] = TEXT.has(ext) ? { type: TYPES[ext], text: buf.toString('utf8') } : { type: TYPES[ext] || 'application/octet-stream', b64: buf.toString('base64') }
  } }
  await walk(root)
  return files
}
