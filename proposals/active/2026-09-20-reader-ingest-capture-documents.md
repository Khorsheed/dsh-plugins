# 灵感空间内容摄入：渲染抓取与文档解析（reader-ingest-capture-documents）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-20
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。无重复提案。三处**相关**而非重复：[browser-pane](../closed/2026-09-13-browser-pane.md)（closed（放弃）——那是"显示型"内嵌浏览器，本提案的 capture 是"捕获型"抓取后端，复用其评审沉淀的进程模型与 SSRF/许可设计，但不交付帧串流/人机同视图）；[quote-anything](2026-09-16-quote-anything.md) 与 [canvas-space](2026-09-16-canvas-space.md) 是摄入产物的消费方（引用/画布），方向相反不构成重复；阅读器现状与重写决策见 [reader 重写 Agent Note](../../.agents/notes/implemented/feature/2026-09-17-reader-rewrite.md) 与体验梳理 `docs/upstream-proposals/2026-09-17-reader-inspiration-journey.md`。
- **官方依赖**：纯插件。capture 包使用 `puppeteer-core` + Chrome for Testing（npm 依赖，非官方包改动）；文档解析复用官方 `remote.workspaceFiles.readAll` 字节通道的既有事实，拖放入口走浏览器 File API，无需上传路由。长期可向游提 `fetchRendered` 类缝（届时登记 `docs/upstream-seam-registry.md`），不阻塞。

## 目标

灵感空间（`@khorsheed/dsh-reader`）目前只能读到"静态 HTML 里本来就有的文字"，两类内容进不来：

1. **JS 渲染的页面内容**：distill 风格交互图表站（transformer-circuits.pub 实测：102 个 `<figure>` 中绝大多数是空 div，由 d3 bundle 现场渲染）、以及科技博客常见的脚本注入图片，抓回来只剩空壳；
2. **文档文件**：arxiv 论文 PDF 等，目前无任何摄入路径（出网缝明确拒绝 `application/pdf`）。

目标是把这两类内容变成灵感空间里的**普通 entry**——归一化白名单 HTML，以应用级 DOM 渲染——从而引用（quote 选区浮层）、翻译（句级记忆管线）、阅读位置记忆三样既有能力**零适配地覆盖新内容**。判据不是"能看到"，而是"能引用、能翻译、能记住读到哪"。

**非目标（v1 明确不做）**：不做 docx/pptx/xlsx（用户 2026-09-20 拍板，有需求再立案增量）；不做扫描件 OCR；不抓取需要登录态的页面；capture 不做交互式浏览（那是已关闭的 browser-pane 的领域）；不替代官方文档预览 tab（它是"看一眼"，灵感空间是"读进去"）。

## 现状（官方契约实测 / 已有实现）

**统一支点**：无论来源，终点都是"一条 entry + 归一化 HTML"。现有管线已具备后半段——白名单归一化（`packages/dsh-reader/src/client/extract-article.ts`）、entry 落库与 TTL 缓存（宿主 `store.ts`/`service.ts`）、应用级 DOM 渲染（引用/翻译因此工作）。本提案只新增两个**入口**，下游全部复用。

**抓取侧**：宿主出网只有 `ctx.web.fetch`（纯 HTTP GET，无 JS 执行，`{url}` 单参数，默认 100,000 字符静默截断——大页面部署侧可 patch 抬高，验收实例已配 64 MB）。browser-pane 提案已关闭（用户拍板用官方 iframe Sidebar Browser），但其评审沉淀可直接复用：puppeteer-core + Chrome for Testing、pipe 连接、单进程 + 每会话 BrowserContext 的进程模型、SSRF 防护清单、站点许可门设计。**捕获型不需要 WS/帧协议/IME**——那是显示型 80% 的复杂度；capture 只是一个请求-响应 Remote verb。

**文档侧**：官方 `documentpreview` 包已内置 pdfjs-dist@6.3.289（证明客户端跑 pdfjs 可行），并开放 `ctx.documentPreviews.register` 扩展缝（ui-file-preview 有插入先例）。本仓库**没有任何文档解析依赖**（pdfjs/mammoth/jszip 全树为零）。reader 的 Remote 面（Typert）可承载新 verb；entryId 由 guid/link/hash 派生（`stableEntryId`），内容哈希可自然接入。

**arxiv 特别现状**：大量论文有官方 HTML 版（`arxiv.org/html/<id>`），粘贴 `arxiv.org/abs/<id>` 时可优先走现有 fetch 缝抓 HTML 版——零新能力，直接受益。

**已定案的方向**（2026-09-20 与用户确认）：

| # | 决策点 | 定案 / 当前倾向 |
|---|---|---|
| D1 | capture 独立包还是并入 reader | **独立包**（见方案 §1 理由），reader 单向探测、缺席降级 |
| D2 | 文档解析放哪一侧 | **客户端解析**（File API 免上传通道），pdfjs 懒加载 spike 先行；分包不可行再退宿主侧 |
| D3 | v1 格式范围 | PDF + arxiv-HTML 升级；docx/pptx 缓议 |
| D4 | 原始字节是否留存 | **不留存**：只保留归一化 HTML + 元数据 + 来源引用（与现状一致；现状的完整度缺陷由 capture 与懒加载图修复解决，不靠留存原文补） |

## 方案

### 1. capture 包（D1：独立包，`@khorsheed/dsh-capture`，名字开工时再钉）

**为什么独立而不是并进 reader**：(a) Chrome for Testing 二进制是百 MB 级的可选基础设施，并进 reader 会让每个只想订 RSS 的用户都背上它；(b) 无头浏览器是一个独立的安全面（SSRF、站点许可、凭据隔离），值得自己的包边界与 README 威胁模型，评审与事故响应都按包切片；(c) 仓库惯例是"独立但兼容"——reader 单独可装可用（探测不到 capture 就退回现状行为），capture 单独可装（未来 canvas-space / datasets 等消费方接同一个 verb）；(d) 跨包边只走单向（reader → capture 探测），符合 `pnpm check:plugins` 的边方向规则。

**形状**：宿主半一个包，无客户端半（或极薄）。暴露 Remote verb `render({url, waitUntil?, timeoutMs?}) → { html, finalUrl, title, renderedAt, truncated }`：受管 headless Chrome（pipe 连接、每请求临时 BrowserContext、进程按空闲超时回收）导航后等 network idle + settle 窗口，序列化 `document.documentElement.outerHTML` 返回。安全面照 browser-pane 评审清单：站点 allow/block 表（首次访问要求批准）、禁 `file:`/`data:`/内网与 metadata 地址/重定向逃逸、临时 profile 不碰用户登录态、产物尺寸上限与超时。

**reader 侧集成**：`fetchEntryBody` 的兜底链变成 普通抓取 → 提取结果为空壳或 `scriptFigures > 0` → 探测 capture Remote，在则用 `render` 重抓再提取。捕获产物**永远过提取器白名单**，绝不直接渲染原始捕获 HTML。JS 渲染的 SVG 图表随 outerHTML 序列化成静态 SVG 进正文（交互控件冻成快照，这是明确接受的代价）。渲染后 DOM 可能极大（数 MB），`render` 内部做尺寸截断并置 `truncated`。

### 2. 文档解析（D2/D3/D4）

- **arxiv-HTML 升级**（最便宜的第一步）：`addSource`/粘贴链路识别 `arxiv.org/abs/<id>`（及 `/pdf/`），优先改抓 `arxiv.org/html/<id>`；HTML 版不存在时回退原 URL 并照常走「仅链接」降级。纯 reader 内部改动。
- **PDF 拖放**：墙上新增拖放区（与新增弹窗并存）。浏览器 File API 拿字节，客户端用 pdfjs-dist 逐页抽取文本块（字号信息识别标题层级），组装成白名单 HTML，经新 Remote verb `addDocumentEntry({title, html, sourceRef, contentHash, meta})` 落库为伪 source「文档」下的 entry。**entryId 用内容哈希**——同一份论文拖两次天然去重。标题取 PDF 元数据/首个标题。原始字节不留存（D4）。
- **懒加载 spike（先行）**：验证 `clientBundle`（`build/tsdown.client.ts`）产物能否承载 pdfjs 的动态 import 分包并被 `window.__ModuleLoader__` 认领；不可行则宿主侧解析（字节经 `workspaceFiles.readAll` 或新上传路由进宿主，pdfjs 跑 Node，不依赖 DOM）。
- **长文档翻译适配**：30 页论文的句量可能击穿句级记忆 4000 条 FIFO 上限；需要按 entry 的翻译进度/分章记录。与 reader 缓存收口工作衔接，细节在实施 note 里定。

### 3. 降级与诚实的 UI

- 检测到 `scriptFigures > 0` 且 capture 缺席（或站点未批准）时，提示旁加「在浏览器中打开」按钮，走官方 `openTab('browser')` 公共缝（0.1.6-alpha.2 起）。人能去看交互图，引用/翻译够不到——这是诚实降级，不是能力宣称。
- PDF 解析失败（加密/扫描件/损坏）给出具体原因与原文链接，不静默产空 entry。

## 里程碑

- **M0（reader 内，纯增量）**：arxiv-HTML 升级 + scriptFigures 降级按钮 + pdfjs 懒加载 spike 结论。可独立验收。
- **M1（reader 内）**：PDF 拖放摄入闭环（拖入 → 解析 → entry → 引用/翻译/位置记忆可用）+ 长文档翻译适配。可独立验收。
- **M2（capture 包）**：`@khorsheed/dsh-capture` 宿主半 + reader 探测集成 + 许可门。可独立验收；reader 在无 capture 时行为不变。
- **M3（可选，后议）**：docx/pptx；向官方 `documentPreviews.register` 顺带注册渲染器；epub。

## 实现记录

（随实施追加：相关 Agent Note / 包名 / 提交）

前置工作：reader 提取器懒加载图恢复、缓存/位置修复（`reader/capture-prep-fixes` 分支，2026-09-20，Agent Note 随提交）。

## 验收标准（done 判定，绑定可插拔交付）

1. 所有新包可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle、`dsh.bundle.patch` 自挂载、`files` 清单、`dsh.client.inject` 声明齐全；`pnpm check:plugins`、`pnpm check:hygiene` 过。
2. **M1 验收**（3080）：拖入一篇 arxiv PDF → 灵感空间出现对应 entry，正文可读 → 划选可引用到会话 → 开启翻译正常出译文 → 切走再切回位置恢复 → 同一文件再拖不产生重复 entry。粘贴 arxiv abs URL 时实际抓到 HTML 版全文。
3. **M2 验收**（3080）：安装 capture 后，抓 transformer-circuits.pub 该类页面，Figure 1/2 以静态 SVG 进入正文、可引用；未批准站点被许可门拦下；卸载 capture 后 reader 行为退回现状（提示 + 降级按钮），无报错。
4. 安全：capture 对 `file:`/内网地址/metadata 地址/跨源重定向逃逸的拦截各有测试；README 写明威胁模型与"不承载登录态"。
5. `pnpm run build && pnpm run test` 全绿（涉及包）。

## 风险 / 放弃的东西

① **pdfjs 进 client bundle 的体积**（1 MB+ 量级）：懒加载分包可行性未验证（M0 spike）；最坏情况退宿主侧解析，代价是多一条字节上传通道。
② **capture 的安全面**：无头浏览器能读到的页面内容会进插件管线（prompt injection 面）；缓解靠站点许可门 + 产物过白名单 + 不碰登录态，**不是免疫**—— threat model 写进 README。
③ **快照保真度有界**：异步数据（hyparquet 类）要等 settle；交互控件冻结；headless 渲染与日常浏览器不逐像素一致。写进 README，不当保真镜像宣称。
④ **arxiv HTML 覆盖率非 100%**：老论文没有 HTML 版，回退路径必须照常工作（仅链接卡片 / 提示拖 PDF）。
⑤ **出网截断仍在**：capture 返回的渲染 DOM 也可能超大；截断策略与「内容未完整呈现」提示沿用现有机制。
⑥ **放弃 docx/pptx/xlsx/OCR/epub（v1）**：格式增量各自立案，不在本提案扩张。
⑦ **不留存原始字节**：用户重装/换机后无法"查看原版排版"；若该需求复燃，单独立案评估存储预算（论文 PDF 10–50 MB 级）。
