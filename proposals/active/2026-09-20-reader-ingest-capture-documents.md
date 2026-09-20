# 灵感空间内容摄入：渲染抓取与链接解析（reader-ingest-capture-documents）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-20
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。无重复提案。三处**相关**而非重复：[browser-pane](../closed/2026-09-13-browser-pane.md)（closed（放弃）——那是"显示型"内嵌浏览器，本提案的 capture 是"捕获型"抓取后端，复用其评审沉淀的进程模型与 SSRF/许可设计，但不交付帧串流/人机同视图）；[quote-anything](2026-09-16-quote-anything.md) 与 [canvas-space](2026-09-16-canvas-space.md) 是摄入产物的消费方（引用/画布），方向相反不构成重复；阅读器现状与重写决策见 [reader 重写 Agent Note](../../.agents/notes/implemented/feature/2026-09-17-reader-rewrite.md) 与体验梳理 `docs/upstream-proposals/2026-09-17-reader-inspiration-journey.md`。
- **官方依赖**：纯插件。capture 包使用 `puppeteer-core` + Chrome for Testing（npm 依赖，非官方包改动）；链接解析用 arxiv 公开 API 与 Crossref API（均无鉴权）。长期可向上游提 `fetchRendered` 类缝（届时登记 `docs/upstream-seam-registry.md`），不阻塞。

## 目标

灵感空间（`@khorsheed/dsh-reader`）的主场景是**读多图的科技博客**和**读论文**（用户 2026-09-20 定调），目前两类内容进不来或进不好：

1. **JS 渲染的页面内容**：distill 风格交互图表站（transformer-circuits.pub 实测：102 个 `<figure>` 全由 d3 bundle 现场渲染）、科技博客常见的脚本注入图片，抓回来只剩空壳；
2. **论文链接的可靠落地**：arxiv 链接应自动升级到官方 HTML 版；openreview 等来源的链接应尽力解析出对应的 arxiv 版本——而不是一抓了之、成败不声。

目标是把这两类内容变成灵感空间里的**普通 entry**——归一化白名单 HTML，以应用级 DOM 渲染——从而引用（quote 选区浮层）、翻译（句级记忆管线）、阅读位置记忆三样既有能力**零适配地覆盖新内容**。判据不是"能看到"，而是"能引用、能翻译、能记住读到哪"；拿不到内容时判据是"直接告知原因和建议动作"。

**非目标（本提案明确不做）**：**文档解析（PDF/docx 拖放摄入）整体推迟**（用户 2026-09-20 二次拍板：主场景已由 capture + arxiv-HTML 覆盖；openreview 类反爬来源在 capture 失败时暂无路径，痛点真实出现时单独立案，分析保留在 §4 备查）；不做扫描件 OCR；不抓取需要登录态的页面；capture 不做交互式浏览（那是已关闭的 browser-pane 的领域）；不替代官方文档预览 tab（它是"看一眼"，灵感空间是"读进去"）。

## 现状（官方契约实测 / 已有实现）

**统一支点**：无论来源，终点都是"一条 entry + 归一化 HTML"。现有管线已具备后半段——白名单归一化（`packages/dsh-reader/src/client/extract-article.ts`）、entry 落库与 TTL 缓存（宿主 `store.ts`/`service.ts`）、应用级 DOM 渲染（引用/翻译因此工作）。本提案只新增**入口**，下游全部复用。

**抓取侧**：宿主出网只有 `ctx.web.fetch`（纯 HTTP GET，无 JS 执行，`{url}` 单参数，默认 100,000 字符静默截断——大页面部署侧可 patch 抬高，验收实例已配 64 MB）。browser-pane 提案已关闭（用户拍板用官方 iframe Sidebar Browser），但其评审沉淀可直接复用：puppeteer-core + Chrome for Testing、pipe 连接、单进程 + 每会话 BrowserContext 的进程模型、SSRF 防护清单、站点许可门设计。**捕获型不需要 WS/帧协议/IME**——那是显示型 80% 的复杂度；capture 只是一个请求-响应 Remote verb。

**链接解析侧**：arxiv 有公开查询 API（`export.arxiv.org/api/query`，支持标题搜索，无鉴权）；Crossref 对 DOI 返回结构化元数据（无鉴权、不反爬）。openreview.net 实测（2026-09-20）：论坛页是 JS SPA（静态 HTML 的 title 恒为 "Forum | OpenReview"），API 被 Cloudflare 人机挑战挡（403）——服务器端拿不到论文标题，只能靠 capture 过挑战后从渲染态页面取，不承诺。

**arxiv 特别现状**：大量论文有官方 HTML 版（`arxiv.org/html/<id>`）。实测 `arxiv.org/html/2604.03147v1`：200、384 KB、含 15 个真 `<table>` 与 18 个图（LaTeXML 生成，表格/公式/章节全是语义标记，质量碾压 PDF 文本抽取）。

**已定案的方向**（2026-09-20 与用户确认）：

| # | 决策点 | 定案 |
|---|---|---|
| D1 | capture 独立包还是并入 reader | **独立包**（见方案 §1 理由），reader 单向探测、缺席降级 |
| D2 | 文档解析 | **整体推迟**（分析见 §4 备查）；v 范围 = capture + arxiv-HTML + 链接解析 |
| D3 | 链接 → arxiv 对应版解析 | 进 M0：arxiv 直链升级零成本可靠；DOI 走 Crossref 可靠；openreview 尽力（capture 取标题）+ 诚实降级 |
| D4 | 新增入口是否区分 RSS/文章 URL | **不分开**：抓回来的内容决定类型（沿用重写 D15），投资方向是报错清晰度而非输入分流 |
| D5 | 抓取状态与报错 | 统一管理：宿主 annotation 是唯一事实源，卡片/详情/补抓同一 selector 派生；失败是一等状态（原因 + 建议动作） |

## 方案

### 1. capture 包（D1：独立包，`@khorsheed/dsh-capture`，名字开工时再钉）

**为什么独立而不是并进 reader**：(a) Chrome for Testing 二进制是百 MB 级的可选基础设施，并进 reader 会让每个只想订 RSS 的用户都背上它；(b) 无头浏览器是一个独立的安全面（SSRF、站点许可、凭据隔离），值得自己的包边界与 README 威胁模型，评审与事故响应都按包切片；(c) 仓库惯例是"独立但兼容"——reader 单独可装可用（探测不到 capture 就退回现状行为），capture 单独可装（未来 canvas-space / datasets 等消费方接同一个 verb）；(d) 跨包边只走单向（reader → capture 探测），符合 `pnpm check:plugins` 的边方向规则。

**形状**：宿主半一个包，无客户端半（或极薄）。暴露 Remote verb `render({url, waitUntil?, timeoutMs?}) → { html, finalUrl, title, renderedAt, truncated }`：受管 headless Chrome（pipe 连接、每请求临时 BrowserContext、进程按空闲超时回收）导航后**滚动遍扫全页再 settle**——transformer-circuits 实测（2026-09-20，Playwright 人工验证）：102 个 `<figure>` 中 20 个靠 IntersectionObserver 懒渲染，快速扫过都不触发，必须逐段停留；全部 102 个都是 DOM/SVG，无一 canvas 位图，序列化可得。安全面照 browser-pane 评审清单：站点 allow/block 表（首次访问要求批准）、禁 `file:`/`data:`/内网与 metadata 地址/重定向逃逸、临时 profile 不碰用户登录态、产物尺寸上限与超时。

**样式内联是必需品，不是打磨**：同页实测 SVG 用 CSS 变量着色（`fill="var(--brand-clay)"`，全页 84 个样式块/表），raw `outerHTML` 丢 class 与 var() 样式后图形结构在、颜色全黑。capture 序列化时要把匹配到的 CSSOM 规则内联成 `style` 属性并解析 `var()`（SingleFile 式做法）；保真兜底是把 figure 子树栅格化成 PNG 截图嵌入（保结构观感但失去 SVG 文字的可引用性）——v1 选内联路线，栅格化留作降级选项。

**reader 侧集成**：`fetchEntryBody` 的兜底链变成 普通抓取 → 提取结果为空壳或 `scriptFigures > 0` → 探测 capture Remote，在则用 `render` 重抓再提取。捕获产物**永远过提取器白名单**，绝不直接渲染原始捕获 HTML。JS 渲染的 SVG 图表随 outerHTML 序列化成静态 SVG 进正文（交互控件冻成快照，这是明确接受的代价）。渲染后 DOM 可能极大（数 MB），`render` 内部做尺寸截断并置 `truncated`。capture 的另一个用途是 D3 的 openreview 标题提取（渲染 forum SPA 取标题，过得了挑战才算数）。

### 2. arxiv-HTML 升级与链接解析器（D3，M0）

- **arxiv 直链升级**（零成本可靠）：`addSource`/粘贴链路识别 `arxiv.org/abs/<id>` 与 `/pdf/<id>`，优先改抓 `arxiv.org/html/<id>`；HTML 版不存在（404）时回退原 URL 照常走「仅链接」降级。注意截断依赖：HTML 版常见 300 KB–1 MB，默认 100,000 字符上限下会被截断——UI 沿用「内容未完整呈现」提示，部署侧 patch 抬高 `maxBodyChars` 可解（验收实例已配 64 MB）。
- **DOI → arxiv**（可靠）：DOI 链接先经 Crossref 取标题与元数据，再 arxiv API 标题搜索，相似度校验（标题归一化后编辑距离阈值）通过才落地为 arxiv HTML entry，并把原 DOI 记入来源引用。
- **openreview → arxiv**（尽力）：服务器端拿不到标题（SPA + 反爬，见现状）。capture 在场时尝试渲染 forum 页取标题再走搜索；不在场或失败时诚实降级：卡片标注「这是 OpenReview 页面，服务器端无法读取」+ 建议动作（「在浏览器中打开」/「如果它有 arxiv 版，直接粘 arxiv 链接」）。**绝不猜、绝不静默存空壳**。
- 解析器是独立纯函数模块（URL/标题 → candidate arxiv id），逐来源一个 resolver，表驱动，方便后续加 dblp / Semantic Scholar 等来源。

### 3. 抓取结果与报错设计（D4/D5，M0）

新增弹窗维持单一输入框（D4）。抓取结果结构化分类，每个结果 = `{ outcome, reasonCode, message, suggestion }`，三处出口共用同一份分类：

**添加时的三种结局，直接告知**：
- 是 feed → 「已订阅，按计划刷新」；
- 是网页且取到正文 → 「已存这篇文章」；
- 取不到正文 → **照样存成「仅链接」卡片，但当场告知原因**（不静默）：反爬/登录墙（建议：在浏览器中打开 / 装 capture）、非 HTML 内容如 PDF（建议：浏览器打开；文档解析上线后可拖入）、站点不可达（HTTP 状态/超时）。

**卡片抓取的五态模型**：未抓取 / 抓取中 / 已抓取 / **抓取失败（带原因与建议动作按钮）** / 已过期（缓存 TTL 到期）。失败态在卡片上直接显示原因行和动作按钮，不是工具提示里的一闪而过。

**状态统一管理**（修现状缺陷）：唯一事实源是宿主 annotation（`fetch.state` + 失败原因 + 正文在场性），客户端经单一 selector 派生所有表面（卡片按钮、详情页、补抓）。现状 bug：详情页打开路径抓取成功后不回写卡片读的镜像状态，导致"点进去其实抓成功了，退出来卡片还显示「抓取」"（2026-09-20 用户截图实证）——open/fetchBody/backfill 三条路径成功后统一回写同一状态。此项作为前置修复随 `reader/capture-prep-fixes` 分支落地，不依赖本提案其余部分。

### 4. 文档解析（推迟备查）

推迟的决定记录在案（D2）。当时的分析保留供重启时使用：官方 `documentpreview` 已内置 pdfjs-dist@6.3.289（客户端跑 pdfjs 可行，但那不是公共能力，插件须自带依赖，client bundle 体积 +1 MB 量级，懒加载分包可行性未 spike）；pdfjs 是渲染器不是结构提取器——正文/标题可用（双栏需 x 坐标聚类），**表格退化为文本行**（行列恢复是脆弱启发式），公式基本不可用——arxiv-HTML 路径质量碾压 PDF 路径，这正是"先链接解析、缓文档解析"的依据。重启时的入口设计：浏览器 File API 拖放免上传通道、entryId 用内容哈希去重、原始字节不留存（只留归一化 HTML + 元数据 + 来源引用）。

## 里程碑

- **M0（reader 内，纯增量）**：arxiv-HTML 升级 + 链接解析器（DOI/Crossref + openreview 尽力）+ scriptFigures 降级按钮 + 抓取报错分类与状态统一（§3）。可独立验收。
- **M1（capture 包）**：`@khorsheed/dsh-capture` 宿主半 + reader 探测集成 + 许可门 + openreview 标题提取。可独立验收；reader 在无 capture 时行为不变。
- **M2（推迟）**：文档解析（§4）；docx/pptx；epub。各自单独立案。

## 实现记录

（随实施追加：相关 Agent Note / 包名 / 提交）

前置工作：reader 提取器懒加载图恢复、缓存/位置/抓取状态修复（`reader/capture-prep-fixes` 分支，2026-09-20，Agent Note 随提交）。

**M0（`reader/m0-ingest` 分支，2026-09-20/21，全部落在 `@khorsheed/dsh-reader`）**：

- `18cd1731` arXiv abs/pdf 链接添加时升级到官方 HTML 版（404 回退原地址；升级 URL 参与查重）——`src/arxiv.ts` + `service.ts` addSource。
- `f2e83c72` 链接解析器（`src/link-resolvers.ts`，表驱动纯模块）：DOI 经 Crossref（`filter=doi:` + `select` 列表路由）→ arXiv 标题搜索（6 词短语上限，实测）→ 标题相似度 + 作者姓重合双因子闸；OpenReview 不抓直接答 `unreadable`（新失败码）；源文档新增 `resolvedFrom` 标注来源。Agent Note：[link-ingest](../../.agents/notes/implemented/feature/2026-09-20-reader-link-ingest.md)。
- `4f756538` 脚本插图提示给真浏览器出口：注入面 `browserTabAvailable`/`openBrowserTab` 探测 `browser` tab kind（0.1.6-alpha.2+），缺席退回外部链接。
- `f61c8d58` 抓取失败分类动作（§3/D5）：卡片失败态原因行 + 按因手势（unreachable 重试 / 墙类在浏览器打开 / 终局不可点）；添加弹窗仅链接判定带建议动作；「渲染抓取」槽位仅在 `capture` Remote 探测在场时渲染（M1 前恒隐，流程已完整：render → 同一道白名单提取 → 存正文）。Agent Note：[failure-actions](../../.agents/notes/implemented/feature/2026-09-21-reader-failure-actions.md)。
- `21846c05` MathML 安全子集放行（公式原生渲染；`annotation-xml` 与脚本永不放行）。Agent Note：[mathml](../../.agents/notes/implemented/feature/2026-09-21-reader-mathml.md)。
- `28a3846b` UI 打磨：最近阅读换官方 `IconClockOutline16`；墙面标题与二级页标题统一 15px/600。
- `e9215f91` 判定弹窗动作按钮与句子的空白修正（JSX 换行不产生空格）。
- 面板内锚点跳转（`#cite.*`/`#fig.*`）**推迟**：白名单剥掉所有 `id`，滚动目标不存在；恢复 id 是归一化契约变更（正文重哈希、译文映射重定键），超出 M0 体量——记录在 mathml note 的 Alternatives。

## 验收标准（done 判定，绑定可插拔交付）

1. 所有新包可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle、`dsh.bundle.patch` 自挂载、`files` 清单、`dsh.client.inject` 声明齐全；`pnpm check:plugins`、`pnpm check:hygiene` 过。
2. **M0 验收**（3080）：粘贴 arxiv abs/pdf 链接 → 实际抓到 HTML 版全文（表格为真 `<table>`）；粘贴 DOI 链接 → 命中 arxiv 版并标注来源；粘贴 openreview 链接（无 capture）→ 存仅链接卡片并告知原因与建议；任一抓取失败 → 卡片显示失败态 + 原因 + 动作；详情页抓取成功后退回墙上，卡片状态正确翻转。
3. **M1 验收**（3080）：安装 capture 后，抓 transformer-circuits.pub 该类页面，Figure 1/2 以静态 SVG 进入正文、颜色不失、可引用；未批准站点被许可门拦下；卸载 capture 后 reader 行为退回现状（提示 + 降级按钮），无报错。
4. 安全：capture 对 `file:`/内网地址/metadata 地址/跨源重定向逃逸的拦截各有测试；README 写明威胁模型与"不承载登录态"。
5. `pnpm run build && pnpm run test` 全绿（涉及包）。

## 风险 / 放弃的东西

① **capture 的安全面**：无头浏览器能读到的页面内容会进插件管线（prompt injection 面）；缓解靠站点许可门 + 产物过白名单 + 不碰登录态，**不是免疫**——threat model 写进 README。
② **快照保真度有界**：懒渲染内容要求滚动遍扫 + 逐段停留（transformer-circuits 实测 20/102 图靠 IntersectionObserver，快扫不触发）；class/CSS 变量样式需内联否则图形失色；交互控件冻结；headless 渲染与日常浏览器不逐像素一致。写进 README，不当保真镜像宣称。
③ **外部解析服务（Jina Reader 类）不作默认**（用户 2026-09-20 问到，记录在案）：URL 与文档内容会离开部署边界发往第三方、需 API key、有速率限制——与仓库自包含哲学冲突。可作为 capture 的可选 provider 后议（显式配置、默认关），主线始终是自托管无头浏览器。
④ **arxiv HTML 覆盖率非 100% + 截断依赖**：老论文没有 HTML 版，回退路径必须照常工作；HTML 版普遍超过默认 100,000 字符上限（实测样本 384 KB），默认部署下会截断，依赖部署侧 patch 或上游缝分页。
⑤ **反爬站点不承诺**：openreview 实测 403 + Cloudflare 人机挑战；capture 过挑战是军备竞赛，不承诺任何站点可用；openreview 论文在 capture 失败时暂无路径（文档解析推迟的已知代价，D2）。
⑥ **链接解析器是模糊匹配**：标题搜索 + 相似度校验可能误命中；校验不过必须降级而不是猜。误配比不配更糟。
⑦ **出网截断仍在**：capture 返回的渲染 DOM 也可能超大；截断策略与「内容未完整呈现」提示沿用现有机制。
⑧ **推迟文档解析/全部办公格式/OCR**：PDF 拖放、docx/pptx/xlsx、扫描件、epub 各自单独立案，不在本提案扩张。
