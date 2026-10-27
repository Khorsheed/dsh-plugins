/**
 * The in-sandbox loader (probe P0-1, proposal §5): a tiny HTML shell that
 * receives a project's files, mints blob URLs inside its OWN opaque origin,
 * rewrites relative module specifiers and CSS `url()`, shims `fetch` and
 * element `src`, then writes the project's `index.html` over itself.
 *
 * Shared by both halves: the panel puts the shell in a
 * `sandbox="allow-scripts"` iframe and posts the files in; the host's checks
 * load the same shell in headless Chrome with the files pre-set on
 * `window.__VFS_FILES__`. Everything that runs in the frame is kept as
 * STRINGS here — never `fn.toString()` — so a bundler's renaming can never
 * break it.
 *
 * The bridge script is installed twice, in the shell and again in the written
 * document, because `document.open()` drops every window listener. It reports
 * errors to the parent, and stands in for `localStorage` (an opaque origin
 * has none): saves start from what the parent sends with the files and each
 * write is posted back for the parent to keep.
 * @module @khorsheed/dsh-game/vfs
 */

/** The frame's CSP: nothing leaves the frame; scripts and assets come from blobs only. */
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; "
  + "img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src blob: data:"

/** The bridge (runs in the frame). */
const BRIDGE = `(function(){
  var errors = window.__gamedevErrors || (window.__gamedevErrors = []);
  function post(m){ try { if (parent !== window) parent.postMessage(m, '*') } catch (e) {} }
  function report(kind, msg){ var t = String(msg); if (errors.length < 50) errors.push({ kind: kind, msg: t }); post({ gamedev: 'error', kind: kind, msg: t }) }
  addEventListener('error', function(e){
    if (e.target && e.target !== window && e.target.tagName) { report('resource', (e.target.tagName || '') + ' ' + (e.target.src || e.target.href || '').slice(0, 60)); return }
    report('error', (e.message || '') + (e.lineno ? ' (line ' + e.lineno + ')' : ''))
  }, true);
  addEventListener('unhandledrejection', function(e){ report('rejection', e.reason && e.reason.message || e.reason) });
  if (!console.__gd) { var ce = console.error; console.error = function(){ report('console', [].join.call(arguments, ' ')); return ce.apply(console, arguments) }; console.__gd = 1 }
  var saves = window.__gdSaves || (window.__gdSaves = {});
  var nativeOk = false;
  try { nativeOk = !!window.localStorage && (window.localStorage.getItem('__gd'), true) } catch (e) {}
  if (!nativeOk) {
    var store = {
      getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(saves, k) ? saves[k] : null },
      setItem: function(k, v){ saves[String(k)] = String(v); post({ gamedev: 'save', saves: saves }) },
      removeItem: function(k){ delete saves[String(k)]; post({ gamedev: 'save', saves: saves }) },
      clear: function(){ for (var k in saves) delete saves[k]; post({ gamedev: 'save', saves: saves }) },
      key: function(i){ return Object.keys(saves)[i] || null },
      get length(){ return Object.keys(saves).length }
    };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function(){ return store } }) } catch (e) {}
  }
  window.dshParams = window.dshParams || {};
  window.dshElements = window.dshElements || {};
  addEventListener('message', function(e){
    var d = e.data || {}, g = window.dshGame;
    if (d.gamedev === 'inspect') post({ gamedev: 'inspect', ready: !!(g && g.ready), state: g && g.state ? g.state() : null, errors: errors });
    if (d.gamedev === 'params' && d.values) {
      for (var k in d.values) window.dshParams[k] = Number(d.values[k]);
      dispatchEvent(new CustomEvent('dshparams', { detail: window.dshParams }));
    }
    if (d.gamedev === 'element' && d.element && d.element.id) {
      window.dshElements[d.element.id] = d.element;
      dispatchEvent(new CustomEvent('dshelements', { detail: d.element }));
    }
    if (d.gamedev === 'pick') {
      var cv = document.querySelector('canvas'), id = null, ref = null, cx = 0, cy = 0;
      if (cv) {
        var rect = cv.getBoundingClientRect(), px = d.x * innerWidth, py = d.y * innerHeight;
        cx = (px - rect.left) * cv.width / rect.width; cy = (py - rect.top) * cv.height / rect.height;
        if (g && typeof g.pick === 'function' && cx >= 0 && cy >= 0 && cx <= cv.width && cy <= cv.height) {
          try { var got = g.pick(cx, cy); if (got && typeof got === 'object') { ref = got; id = got.id || null } else id = got || null } catch (err) { report('error', 'pick: ' + err.message) }
        }
      }
      // A string id (2D games) or a structured reference (dsh3d: id, inst, name, state, point, region).
      post({ gamedev: 'picked', id: id, ref: ref, hover: !!d.hover, supported: !!(g && typeof g.pick === 'function'), x: d.x, y: d.y });
    }
    // The panel's pick mode freezes the game; a candidate's changes get ringed. Both optional on the game side.
    // The panel sends them as soon as the files are posted, often before the game's modules ran: the latest
    // of each is kept and applied once window.dshGame appears (polled briefly; installs share one record).
    if (d.gamedev === 'pause' || d.gamedev === 'highlight') {
      var pend = window.__gdPend || (window.__gdPend = {});
      pend[d.gamedev] = d;
      var apply = function () {
        var game = window.dshGame;
        if (!game) return false;
        var p = window.__gdPend || {};
        if (p.pause && typeof game.pause === 'function') { try { game.pause(!!p.pause.on) } catch (err) { report('error', 'pause: ' + err.message) } }
        if (p.highlight && typeof game.highlight === 'function') { try { game.highlight(Array.isArray(p.highlight.list) ? p.highlight.list : []) } catch (err) { report('error', 'highlight: ' + err.message) } }
        window.__gdPend = {};
        return true;
      };
      if (!apply() && !window.__gdPendTimer) {
        var tries = 0;
        window.__gdPendTimer = setInterval(function () { if (apply() || ++tries > 150) { clearInterval(window.__gdPendTimer); window.__gdPendTimer = 0 } }, 100);
      }
    }
  });
})();`

/** The loader (runs in the frame): defines `window.__boot(files)`. */
const LOADER = `window.__boot = function (files) {
  var urls = {};
  function norm(base, rel) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.indexOf('//') === 0) return null;
    var clean = rel.split(/[?#]/)[0], out = [];
    var parts = ((clean.charAt(0) === '/' ? '' : base) + clean).split('/');
    for (var i = 0; i < parts.length; i++) { var s = parts[i]; if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s) }
    return out.join('/');
  }
  function dir(p) { return p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/') + 1) : '' }
  function bytes(p) {
    var f = files[p];
    if (f.text != null) return new TextEncoder().encode(f.text);
    var bin = atob(f.b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function text(p) { return files[p].text != null ? files[p].text : new TextDecoder().decode(bytes(p)) }
  function mint(body, type) { return URL.createObjectURL(new Blob([body], { type: type })) }
  function rewriteCss(css, base) {
    return css.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g, function (m, q, u) { var r = norm(base, u); return r && files[r] ? 'url("' + urlFor(r) + '")' : m });
  }
  var busy = {};
  // An exact bare name, else the longest prefix key ending in '/' (import-map style).
  function bareOf(spec) {
    if (bare[spec]) return bare[spec];
    var best = '';
    for (var k in bare) if (k.charAt(k.length - 1) === '/' && spec.indexOf(k) === 0 && k.length > best.length) best = k;
    return best ? bare[best] + spec.slice(best.length) : undefined;
  }
  function modUrl(p) {
    if (urls[p]) return urls[p];
    if (busy[p]) throw new Error('module cycle at ' + p);
    busy[p] = 1;
    var src = text(p).replace(/(\\bimport\\s*\\(\\s*|\\bfrom\\s*|\\bimport\\s+)(['"])([^'"]+)\\2/g, function (m, pre, q, spec) {
      var r = /^\\.{0,2}\\//.test(spec) ? norm(dir(p), spec) : bareOf(spec);
      return r && files[r] ? pre + q + modUrl(r) + q : m;
    });
    delete busy[p];
    return (urls[p] = mint(src, 'text/javascript'));
  }
  function urlFor(p) {
    if (urls[p]) return urls[p];
    if (/\\.m?js$/.test(p)) return modUrl(p);
    if (/\\.css$/.test(p)) return (urls[p] = mint(rewriteCss(text(p), dir(p)), 'text/css'));
    return (urls[p] = mint(bytes(p), files[p].type));
  }
  function rel(v) { var r = typeof v === 'string' && norm('', v); return r && files[r] ? urlFor(r) : null }
  // A project path's blob URL (null when the project has no such file): three's loading
  // manager maps model and texture paths through it, since a relative Request has no usable base here.
  window.__dshFileUrl = rel;
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : input && input.url;
    var r = typeof u === 'string' && norm('', u);
    if (r && files[r]) return Promise.resolve(new Response(bytes(r), { status: 200, headers: { 'content-type': files[r].type } }));
    return nativeFetch(input, init);
  };
  [[HTMLImageElement.prototype, 'src'], [HTMLMediaElement.prototype, 'src'], [HTMLSourceElement.prototype, 'src']].forEach(function (pair) {
    var d = Object.getOwnPropertyDescriptor(pair[0], pair[1]);
    Object.defineProperty(pair[0], pair[1], { configurable: true, enumerable: d.enumerable, get: function () { return d.get.call(this) }, set: function (v) { d.set.call(this, rel(v) || v) } });
  });
  // The kit's bare module map (e.g. 'three' → '_dsh/three.module.js').
  var bare = {};
  try { if (files['_dsh/imports.json']) bare = JSON.parse(text('_dsh/imports.json')) || {} } catch (e) {}
  if (!files['index.html']) { document.body.textContent = '这个版本没有 index.html'; return }
  try {
    var manifest = files['game.json'] ? JSON.parse(text('game.json')) : {};
    window.dshManifest = manifest;
    (manifest.params || []).forEach(function (p) { if (p && p.key && !(p.key in window.dshParams)) window.dshParams[p.key] = Number(p.value) });
  } catch (e) {}
  Object.keys(files).forEach(function (p) {
    if (p.indexOf('elements/') !== 0 || !/\.json$/.test(p)) return;
    try { var raw = JSON.parse(text(p)); (Array.isArray(raw) ? raw : [raw]).forEach(function (el) { if (el && el.id) window.dshElements[el.id] = el }) } catch (e) {}
  });
  var doc = new DOMParser().parseFromString(text('index.html'), 'text/html');
  doc.querySelectorAll('[src]').forEach(function (el) { var u = rel(el.getAttribute('src')); if (u) el.setAttribute('src', u) });
  doc.querySelectorAll('link[href]').forEach(function (el) { var u = rel(el.getAttribute('href')); if (u) el.setAttribute('href', u) });
  doc.querySelectorAll('style').forEach(function (st) { st.textContent = rewriteCss(st.textContent, '') });
  var meta = doc.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = window.__GD_CSP;
  var bridge = doc.createElement('script'); bridge.textContent = window.__GD_BRIDGE;
  doc.head.prepend(meta, bridge);
  // The kit runtime runs right after the bridge, before any of the game's own scripts.
  if (files['_dsh/runtime.js']) { var kit = doc.createElement('script'); kit.src = urlFor('_dsh/runtime.js'); bridge.after(kit) }
  document.open(); document.write('<!doctype html>' + doc.documentElement.outerHTML); document.close();
};`

/** Starts the boot: pre-set files (headless) or the first `files` message (panel). */
const START = `if (window.__VFS_FILES__) window.__boot(window.__VFS_FILES__);
else { var once = false; addEventListener('message', function (e) {
  var d = e.data;
  if (once || !d || d.gamedev !== 'files') return;
  once = true;
  if (d.saves && typeof d.saves === 'object') { var s = window.__gdSaves || (window.__gdSaves = {}); for (var k in d.saves) s[k] = String(d.saves[k]) }
  if (d.params && typeof d.params === 'object') { window.dshParams = window.dshParams || {}; for (var pk in d.params) window.dshParams[pk] = Number(d.params[pk]) }
  window.__boot(d.files);
}); }`

/** Escape a string for embedding inside an inline `<script>` (a literal `</script>` would end it). */
function scriptSafe(json: string): string {
  return json.replace(/</g, '\\u003c')
}

/**
 * The shell document. `extraHead` lets the headless runner add a marker;
 * the panel passes nothing.
 * @param extraHead - raw HTML placed before the bridge.
 * @returns the complete HTML string.
 */
export function shellHtml(extraHead = ''): string {
  const globals = `window.__GD_CSP=${scriptSafe(JSON.stringify(SANDBOX_CSP))};window.__GD_BRIDGE=${scriptSafe(JSON.stringify(BRIDGE))};`
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`
    + `<style>html,body{margin:0;height:100%;background:#111;color:#ccc;font:13px system-ui}</style>`
    + `${extraHead}<script>${BRIDGE}</script><script>${globals}${LOADER}</script><script>${START}</script>`
}

/** Messages the frame posts to its parent. */
export type FrameMessage =
  | { readonly gamedev: 'error'; readonly kind: string; readonly msg: string }
  | { readonly gamedev: 'save'; readonly saves: Readonly<Record<string, string>> }
  | { readonly gamedev: 'inspect'; readonly ready: boolean; readonly state: unknown; readonly errors: readonly { kind: string; msg: string }[] }
  | { readonly gamedev: 'picked'; readonly id: string | null; readonly ref: PickRef | null; readonly hover: boolean; readonly supported: boolean; readonly x: number; readonly y: number }
  | { readonly gamedev: 'preview'; readonly png: string }
  | { readonly gamedev: 'preview-clips'; readonly names: readonly string[]; readonly parts: ModelParts | null }
  | { readonly gamedev: 'preview-turned' }

/** What a loaded glTF model can be tuned by (the preview reports it once loaded). */
export interface ModelParts {
  readonly materials: readonly { readonly name: string; readonly color: string; readonly vertexColors: boolean }[]
  readonly bones: readonly string[]
  readonly morphs: readonly string[]
}

/** What a game's `pick` may return beyond a bare id (dsh3d returns this). */
export interface PickRef {
  readonly id: string | null
  readonly inst?: string | null
  readonly name?: string | null
  readonly state?: string | null
  readonly ground?: boolean
  readonly point?: { readonly x: number; readonly y: number; readonly z: number }
  readonly region?: string | null
}

/**
 * A single self-contained HTML file for a build (decision: sharing starts as
 * a file export). The same shell, with the files embedded; opened from disk
 * it has a real origin, so the game's own localStorage works natively.
 */
export function exportHtml(title: string, files: Readonly<Record<string, unknown>>): string {
  const embedded = `<title>${title.replace(/[<&]/g, '')}</title><script>window.__VFS_FILES__=${scriptSafe(JSON.stringify(files))}</script>`
  return shellHtml(embedded)
}
