/**
 * The `2d-canvas` kit: native canvas plus an HTML/CSS layer, pixel-row looks
 * drawn with `dshDraw`, the eight built-in 2D art styles. This is the
 * workbench's original runtime, moved behind the kit seam unchanged.
 * @module @khorsheed/dsh-game
 */
import { normalizeLook, PIXEL_LOOK_HINT } from '../project.ts'
import { ART_STYLES } from '../types.ts'
import { KIT_RUNTIME_FILE, type RuntimeKit } from './types.ts'

/** The frame runtime: pixel-look drawing helpers over `window.dshElements`. Kept as a string (never `fn.toString()`). */
const RUNTIME = `(function(){
  var CH = '0123456789abcdefghijklmnopqrstuvwxyz';
  window.dshDraw = function(g, look, state, x, y, scale){
    if (typeof look === 'string') { var el = window.dshElements[look]; look = el && el.look }
    if (!look || !look.states || !look.palette) return false;
    var names = Object.keys(look.states), rows = look.states[state] || look.states[names[0]];
    if (!rows) return false;
    scale = scale || 1;
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
      var col = look.palette[CH.indexOf(rows[r].charAt(c))];
      if (!col) continue;
      g.fillStyle = col; g.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), Math.ceil(scale), Math.ceil(scale));
    }
    return true;
  };
  window.dshLookSize = function(look){
    if (typeof look === 'string') { var el = window.dshElements[look]; look = el && el.look }
    var rows = look && look.states && look.states[Object.keys(look.states)[0]];
    return rows ? { w: rows[0].length, h: rows.length } : { w: 0, h: 0 };
  };
})();`

/** Blank when the first canvas, scaled to 32×32 through a 2D context, holds one color. */
const BLANK_PROBE = `(() => {
  const c = document.querySelector('canvas');
  if (!c || c.width <= 0 || c.height <= 0) return null;
  const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32;
  const p = probe.getContext('2d'); p.drawImage(c, 0, 0, 32, 32);
  const d = p.getImageData(0, 0, 32, 32).data; const distinct = new Set();
  for (let i = 0; i < d.length; i += 4) { distinct.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); if (distinct.size > 1) break; }
  return distinct.size <= 1;
})()`

const STYLE_LINES = ART_STYLES.map(s => `- \`${s.id}\` ${s.label}：${s.look}`).join('\n')

/** The 2D canvas kit. */
export const CANVAS_2D: RuntimeKit = {
  id: '2d-canvas',
  version: 1,
  label: '2D 画布',
  runtimeFiles: () => ({ [KIT_RUNTIME_FILE]: { type: 'text/javascript', text: RUNTIME } }),
  normalizeLook,
  lookHint: PIXEL_LOOK_HINT,
  blankProbe: BLANK_PROBE,
  styles: ART_STYLES,
  skillSection: `## 运行环境
- 只有 2D：原生 canvas 加 HTML/CSS 做界面。不能联网、不能引外部 CDN（沙箱 CSP 全拦），所有代码和资源都放项目里。
- 存档用 \`localStorage\`（面板替你保存在用户浏览器里）。
- 没有文生图：画面全部用代码画（canvas 绘制、像素数组、SVG）。严格按 game.json 的 artStyle 画：
${STYLE_LINES}
- 外观 look 的格式：\`{ "palette": ["#1a1c2c", "#ffcd75", …], "states": { "idle": ["..00..", ".0110.", …], "move": [...] } }\`。每行一个字符串，\`.\` 透明，\`0-9a-z\` 是 palette 下标；同一状态各行等宽，常用 16×16。颜色优先取 game.json 的 \`palette\`（来自美术风格）。画的时候用 \`dshDraw(ctx2d, 元素id或look, 状态名, x, y, 放大倍数)\`，尺寸用 \`dshLookSize(元素id)\`。
`,
}
