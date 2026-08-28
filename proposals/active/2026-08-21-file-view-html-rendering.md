# 文件视图 HTML 渲染能力增强（file-view-html-rendering）

- **分类**：plugin
- **状态**：in-progress（M0 测试页与 `3d-artifact` skill 已交付，见实现记录）
- **最后更新**：2026-08-21
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。`datasets-store` 的「内容预览不自研渲染」是复用官方阅读器（markdown/代码），与 HTML 渲染空白正交；mission/lab 的 artifact 是数据登记，与渲染无关；mobile-access 的离线壳不涉渲染；既有 note `2026-08-18-file-preview-copy-path-and-tab-gestures` 记录的正是现状（静态 sandbox iframe）。无重复，新建。
- **官方依赖**：纯插件。渲染全链路在 `@khorsheed/dsh-file-preview`（Remote）+ `@khorsheed/dsh-client-ui-file-preview`（client）；产物行入口沿用 S1 既有绕行（turnTail chain + mention 拦截）；零官方改动。

## 目标

把文件视图（FilePreviewView / 抽屉 / 产物行共用的预览通道）的 HTML 渲染从「只能静态看」升级为「分级可信、可运行、可扛大文件」：

1. **Tier0（现状，默认）**：静态渲染不变，补 meta CSP 纵深防御。
2. **Tier1（显式开启）**：脚本在沙箱内运行（opaque origin + 进程隔离），网络全禁，能力走 postMessage 桥。
3. **大文件分级**：渲染通道上限从 512KB 放宽（可配置），超限给源码视图 + 浏览器打开出口。
4. **scripted 探测**：含脚本文件默认静态 + 提示，由用户决定升级，不静默。
5. **M0 3D 验证页**：做几个 three.js 测试页验证上述设计与 CSP 边界（本次即做）。

非目标：不进宿主 DOM 渲染任意 HTML（官方 markdown 字面文本立场不动）；不开 `allow-same-origin`（任何 tier）；不做「内容安全扫描后放行」式信任判定（扫描只用于能力探测与警示）。

## 现状（已核实）

- **官方管线**：`ui-primitives/src/markdown/render.tsx` 对 raw HTML 一律转义为字面文本；唯一 sanctioned `dangerouslySetInnerHTML` 是 shiki CodeBlock；URL 走 micromark 协议白名单（http/https/mailto）。
- **现有实现**：`FilePreviewPane.tsx` L99 `<iframe sandbox="" srcDoc>` 静态渲染 + 源码/渲染切换（默认 render）；无 CSP（dsh web 壳全仓零 CSP，srcdoc 无策略可继承）；Remote `maxReadBytes` 512KB，>512KB → `too-large`，≤512KB 可截断。
- **调研结论**（2026-08-21，`$DSH_HOME/scratch/2026-08-21-html-render-safety-and-performance-research.md`）：
  - Anthropic = iframe sandbox + 全站进程隔离 + 严格 CSP + 独立托管 origin（`claudeusercontent.com`）；Claude Code Artifacts = CSP 全禁外网 + 16MB 上限 + 全量内联（"无网络 → 无泄漏面，有限体积 → 有限渲染成本"）。
  - Chrome Site Isolation 使 opaque-origin 沙箱 iframe 独立进程 → **进程隔离 = 性能隔离**（大文档不卡宿主 UI）。
  - three.ws 实测多 MB 内联文档即挂起（6MB GLB ≈ 8MB base64 为红线）；Claude 内联 HTML、无流式。
  - `allow-scripts` 与 `allow-same-origin` 绝不能同开；srcdoc 无 HTTP 响应 → 策略必须内嵌 meta CSP。
  - CopilotKit 用 JetBrains Websandbox + Zod 校验桥 + ResizeObserver 自适应。
- **宿主能力**：file-preview 已能 `webServer.register` 自挂路由（图片路由先例）；zod 已在 host 侧依赖（`packages/file-preview`），client 侧无 zod（桥校验手写轻量即可）。

## 方案

### 1. Remote 分级（`packages/file-preview`）

- config 增 `htmlMaxReadBytes`（默认建议 4MB）：HTML/HTM 扩展名走渲染上限，其余维持 512KB 现状。
- `FilePreviewRead` 增 `htmlScripted?: boolean`：内容含 `<script` / 事件属性 → true。探测只做提示与默认档位选择，不做信任判定。
- M2 视需要增独立 `renderHtml` 通道（会话作用域、可携带 CSP/大小元信息）。

### 2. client 分层渲染（`packages/ui-file-preview`）

- **Tier0**：`sandbox=""` 不变 + srcdoc 包装为完整文档并内嵌 meta CSP（`default-src 'none'`、`script-src` 白名单 CDN、`connect-src 'none'`、`object-src/base-uri/form-action` 收死）。
- **Tier1**：`sandbox="allow-scripts"`（**无 allow-same-origin**）；切换 UI = 源码 / 静态 / 运行脚本 + 一次性确认（`locales.ts` 增文案）；包装器附带 content-visibility 注入（顶层子元素批量 `content-visibility: auto` + `contain-intrinsic-size`，用于大文档）。
- **能力桥**（新 `src/client/html-bridge.ts`）：postMessage `{id, fn, args}` → 宿主校验（fn ∈ 白名单、args 轻量校验、`message.source` 校验）→ 执行。初始能力：`openLink`（https + origin 白名单，`noopener,noreferrer`）、`copy`、`download`、`resize`。
- **看门狗**：iframe load 超时（如 10s）→ 提示回退源码视图 / 浏览器打开。

### 3. 产物行接入（S1 绕行面复用）

- HTML 产物点击 → 同一分层通道；scripted 产物显示提示徽标；"渲染"为 HTML 默认动作。

### 4. M0 3D 测试页（本次交付，`$DSH_HOME/scratch/html-render-3d-demo/`）

4 个自包含页面，全部内嵌 Tier1 meta CSP，浏览器直接打开即可验证设计：

| 页面 | 验证点 |
| --- | --- |
| `01-cube-cdn.html` | CDN three.js（jsdelivr/cdnjs）+ 旋转立方体 + OrbitControls → `script-src` CDN 白名单 + WebGL 在沙箱内可用 |
| `02-gltf-inline.html` | `GLTFLoader.parse(arrayBuffer)` + embedded base64 GLTF（全内联、零网络）→ 3D 全内联路径 |
| `03-particles-dom.html` | 万级粒子 + 巨量 DOM（`content-visibility` 开关对照）→ 大文档性能策略 |
| `04-csp-probe.html` | fetch / 外链 img / 外链 script / blob worker 各探一项 → 围栏边界与 `connect-src` 收死 |

验收方式：playwright 无头渲染每页，console 零错误 + 截图 + 探针页断言（放行/阻断符合设计）。

### 5. 生成侧契约：`3d-artifact` skill（生成-渲染闭环）

渲染器只执法、不救场（`fetch` / `loader.load` 是代码行为，渲染器无法通用改写），所以**交互/3D 产物的合规责任在生成侧**：生成 HTML 的模型必须在生成时刻遵守契约。本次决策（2026-08-21）：**生成侧告知只做 skill**（M3 交付），其余手段后置：

- **做**：`3d-artifact` skill —— 契约清单（自包含 / 零运行时网络 / CDN 白名单 / 体积红线）+ `02-gltf-inline.html` 参考实现 + 生成后自检清单。按需加载（progressive disclosure），模型在生成 3D 产物时自行加载。
- **暂不做（后置）**：AGENTS.md 常驻规则、生成后自动预检脚本、`gen_3d_artifact` 生成工具化。
- **后置触发条件**：出现"模型未加载 skill 导致产物违约"的实例（渲染器回退静态/源码视图即为可见违约信号），再评估上预检脚本或工具化。
- **兜底**：违约产物不会爆炸——渲染器按 Tier0/源码视图安全失败，用户可人工浏览器打开；4 个测试页（02 = 契约正例、04 = 越界反例）即回归样本。

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 3D 测试页 + playwright 验证 CSP/渲染设计 | **已完成**（2026-08-21：4 页全过，探针 7 项符合设计） |
| M1 | Remote 分级 + scripted 探测（含单测） | **已完成**（`a4d7883`：`htmlMaxReadBytes` 4MiB + `htmlScripted` 提示，106 tests） |
| M2 | client Tier0/Tier1 + 桥 + 看门狗（含单测） | **已完成**（`e981c25`：buildSrcDoc 内嵌 CSP / allow-scripts 门控 / dshBridge 白名单桥 / 10s 看门狗，125 tests） |
| M3 | 产物行接入 + 3D 专项：`3d-artifact` skill（生成侧契约）+ 体积红线/纹理调优 | 进行中（skill 已交付 `0bff9d2`；产物行接入待做） |

## 实现记录

- **M0（2026-08-21）**：4 个测试页 + 冒烟脚本交付于 `$DSH_HOME/scratch/html-render-3d-demo/`（`01-cube-cdn` / `02-gltf-inline` / `03-particles-dom` / `04-csp-probe`），playwright（chromium-1228）无头渲染全 PASS，截图与像素采样确认出图。
- **M0 关键发现（已写回设计）**：three r152 的 `GLTFLoader` 对 `data:` URI 缓冲走 `fetch`，会被 `connect-src 'none'` 拦截——与 three.ws 契约的教训一致。**内联 3D 必须用 GLB 容器 + `atob` → `parse(arrayBuffer)` 的零 fetch 路径**；该模式已作为 Tier1/3D 专项的硬性约定。`blob:` Worker 在 `worker-src blob:` 下放行；`img-src` 收窄到 `data:/blob:` 后外链图片被正确阻断。
- **2026-08-21 决策**：生成侧告知只做 `3d-artifact` skill（方案 §5）；AGENTS.md 常驻规则 / 预检脚本 / 生成工具化明确后置，触发条件见 §5。
- **2026-08-21 skill 已交付**：`3d-artifact` skill 随 `@khorsheed/dsh-file-preview` 打包（`skills/3d-artifact/SKILL.md` + `files` glob）并在 `FilePreviewService` 构造器经可选 `skills` 服务注册（照 ankh-guard 范式，缺能力降级）；pack-smoke 测试断言 tarball 携带；提交 `0bff9d2`，Agent Note `implemented/feature/2026-08-21-3d-artifact-skill-registration`。
- **2026-08-21 测试用例**：用「超写实数字孪生峡谷+悬索桥」提示词按 skill 契约生成 `scratch/html-render-3d-demo/05-digital-twin-canyon.html`（程序化地形 V 谷、河流、双塔悬索桥+车流、山峦/风机/输电塔、数字孪生叠加：点云/BIM 线框/热力图/传感器/无人机），playwright 验证 PASS：2.7s 加载、58 fps（无头 SwiftShader）、60 车辆、console 零错误；截图 `05-default/05-close.png`。
- **2026-08-21 构建修复**：e007ba3 破坏 `gen-typert`（files 目录写法 vs 生成器字面校验）——五个 typert 包补回字面 `lib/typert.*.js` 条目，`gen-typert` 恢复通过；提交 `2a198ab`，Agent Note `implemented/bug-fix/2026-08-21-typert-files-reconciliation`。
- **2026-08-21 E2E（throwaway 实例 `~/.dsh-html-demo:3291`，link 装 file-preview + ui-file-preview）**：向实例内 agent 发送**简化提示词**（纯 CSS/SVG、零脚本、内嵌 Tier1 CSP、≤30KB——静态沙箱下 CSS 动画可跑，省 token）→ 生成 `canyon-bridge.html`（20KB，**0 script、CSP 合规、无外链**）→ **产物视图列表拿到**（fold 采集：`canyon-bridge.html / ws / 第 1 轮 · 第 6 步`）→ **点行渲染正常**：sandboxed iframe（Tier0 静态）+ 源码/渲染切换 + **35 个 CSS 动画运行** + 数字孪生面板（主缆张力/挠度/风速…）；**正文 mention 点击开抽屉 ✅**。发现：官方**工具结果行**的文件链接（write 工具输出的 disclosure 行）走官方 `workspaces.openPath`（跳 IDE），不在插件拦截面内——S1 缝的新表面，已补登记。

## 验收标准（done 判定）

- 以 `@khorsheed/dsh-file-preview` + `@khorsheed/dsh-client-ui-file-preview` **可插拔交付**（`dsh plugin add/remove`，零官方改动）。
- 浏览器实测：抽屉打开含脚本 HTML → 静态默认 + 提示；确认后脚本运行且宿主 UI 不卡（独立进程）；openLink 白名单内外行为正确；>512KB HTML 可渲染；CSP 探针页放行/阻断符合设计。
- 测试全绿：CSP 注入、桥校验、探测、超时回退、srcdoc 包装（既有断言同步更新）。
- 4 个 3D 测试页在 playwright 下 console 零错误、截图可见渲染结果。
- M3 交付 `3d-artifact` skill：含契约清单、`02-gltf-inline.html` 参考实现、生成后自检清单。

## 风险 / 放弃的东西

- **桥是新增攻击面**：白名单 + 校验 + source 校验三层，宁可缺能力不可放错。
- **meta CSP 误伤**：CDN 白名单过窄则 CDN 库加载失败 → 3D 测试页即回归样本。
- **现有 srcdoc 断言随包装失效** → 同步更新测试。
- **skill 未被模型加载（接受的风险）**：产物可能违约（外链 / fetch / `data:` 缓冲）——渲染器安全失败（静态/源码视图）兜底，失败可见；出现实例后启用预检脚本（后置手段）。
- 放弃：`allow-same-origin`（沙箱 + 进程隔离红线，任何 tier 不开）；宿主 DOM 渲染任意 HTML；独立 origin 服务器（opaque origin 已够，相对资源解析不承诺——Tier1 提示用户用 data:/绝对 URL）；本期不做 AGENTS.md 常驻规则 / 生成后预检脚本 / 生成工具化（后置，触发条件见方案 §5）。
