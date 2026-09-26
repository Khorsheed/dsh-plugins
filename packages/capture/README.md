# @khorsheed/dsh-capture

[English](README.en.md) | 中文

渲染完再抓——懒加载的图、IntersectionObserver 唤醒的内容、页面脚本现场画的 figure，一个都不落。

静态抓取拿到的只是服务器吐出的那份 HTML：JS 重页面里它往往只剩空 div 和一句图注。这个插件在宿主半维护一个受管无头 Chrome，把 URL 真渲染一遍——滚动到底、等脚本画完——再把**渲染态 DOM** 序列化带回来：命中的 CSSOM 样式逐元素内联（`var()` 已解析），脚本全部剥掉。只会吃静态 HTML 的提取器（如灵感空间阅读器）由此长出一双能看 JS 重页面的眼睛。

## 特性

- **一个 Remote 动词 `capture.render`**——宿主经 Typert Remote 暴露命名空间 `capture`；入参 `{ url, timeoutMs? }`，返回渲染态 HTML（附 `finalUrl` / `title` / `truncated`）。坏 URL、私网目标、浏览器不可用、超时、队列满都是带 `capture/*` 错误码的 `RemoteError`，落在 `RemoteResult` 的 error 分支——成功值里不夹第二种 `{ ok }` 联合。
- **真渲染，不是抓源码**——受管无头 Chrome（Chrome for Testing）把页面跑到网络静默，再按视口步进滚动遍扫到底，每步停留 500ms 触发懒渲染；页面脚本画的交互 widget（canvas、事件驱动的 figure）在序列化前截成 WebP 静态图，可搜索文字留在 `alt` 里。
- **样式随 DOM 一起走**——命中的 CSSOM 规则按级联定胜负后逐元素写进 `style`；SVG 呈现属性（`fill`/`stroke` 等）同时写成**属性**，下游白名单只留属性时颜色照样在；`<script>`、`<style>`、样式表 `<link>` 全部剥掉。
- **SSRF 闸门逐跳重查**——只放 http(s)，拒绝带凭据的 URL；主机名经系统 resolver 解析，每一个答案都必须是公网地址；每一跳重定向重新过闸，公网 URL 302 进私网逃不掉。
- **零登录态、零残留**——每次渲染一个全新临时 BrowserContext：零 Cookie、零凭据、零存储跨渲染残留；`pipe: true` 走 stdio，不监听任何 TCP 端口；进程空闲 60s 自动退出。
- **装坏不炸启动**——浏览器二进制首次渲染时才下载到 `$DSH_HOME/state/dsh-capture`（部署状态目录，不是包目录）；下载/拉起失败只是该次调用的 `capture/unavailable`，绝不是 boot 崩溃。消费方探测 `remote.capture`，本包不在场时一切照旧。

## 契约

```ts
render({ url, timeoutMs? }) → {
  html: string        // <!DOCTYPE html> + 渲染态文档，样式已内联、脚本已剥
  finalUrl?: string   // 重定向后的落地地址
  title?: string      // document.title
  truncated?: boolean // 序列化超上限被截断时置真
}
```

浏览器半**只做挂载**（把生成的 Remote contribution 挂进客户端，让 `remote.capture` 存在），没有 UI——设置页是有意推迟的：v1 唯一的调用手势是阅读器的「渲染抓取」点击，那次点击本身就是批准。消费方探测 `remote.capture` 命名空间，缺席就安静降级（阅读器直接不渲染那个手势）。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-capture
```

重启 web 实例后生效。包自挂载（`dsh.bundle.patch` → `cordis.patch.yml`，行 id `capture`），`dsh plugin add` 把这一行 reconcile 进 profile——不用手改 cordis.yml；一个组合里该行只能挂载一次。

```sh
dsh plugin --profile web remove @khorsheed/dsh-capture
```

卸载后消费方探测不到 `remote.capture`，行为回到没装过（阅读器的「渲染抓取」手势整体消失，不报错）。

## 配置

cordis.yml 行 `config`（全部可选）：

| 键 | 默认 | 说明 |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/dsh-capture` | 状态目录（浏览器二进制 + 临时 profile + state.json） |
| `executablePath` | — | 显式 Chrome/Chromium 可执行文件（跳过受管下载） |
| `channel` | — | 系统渠道（如 `chrome`），由 puppeteer 自行解析 |
| `chromeBuildId` | `stable` | 受管下载的 Chrome for Testing 构建标记 |
| `defaultTimeoutMs` | `30000` | 默认导航超时（调用方 `timeoutMs` 钳在 1s–120s） |
| `maxChars` | `8000000` | 序列化输出上限（字符） |
| `idleTimeoutMs` | `60000` | 空闲多久后关掉受管浏览器 |
| `maxQueue` | `4` | 等待线长度（在飞的不算） |
| `dwellMs` | `500` | 遍扫每步停留（IntersectionObserver 需要 ≥ ~400ms） |
| `maxSweepMs` | `20000` | 遍扫总预算 |
| `snapshotWidgets` | `true` | 序列化前把 JS 驱动的 widget figure 截成静态图 |
| `maxSnapshots` | `40` | 单次渲染最多截多少张 widget（按文档序，其余保留 DOM） |
| `extraArgs` | `[]` | 追加 Chrome 命令行参数（部署逃生口） |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——minHost 即 0.1.5-rc.1（`dsh.compat.verifiedHost`），全量构建测试通过；Remote 面只依赖 Typert 协议与（浏览器半挂载用的）api-remotes。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）——跟踪上游，不经本地 fork。

降级都是安静的，绝不炸启动：没有浏览器二进制时每次调用得 `capture/unavailable`；磁盘不可写时 allow 记录仅内存；无会话、无 fs、无 web 缝的组合照样 boot。浏览器半在任何 web 组合里挂载命名空间；headless 组合没有 `remote` 服务，挂载静默跳过。机器可读版见 package.json 的 `dsh.compat`。

## 已知限制

- **交互控件冻成快照**——序列化是静态 DOM：按钮、输入框、展开器失去行为（脚本本来就不随产物走）；JS 驱动的 widget figure 默认截成静态图片。
- **headless ≠ 逐像素一致**——字体、GPU 光栅、部分 DRM 内容在 `--headless=new` 下与日常浏览器不同；本包不承诺保真镜像。
- **跨源样式表读不到**——浏览器拒绝读它们的 CSSOM（SecurityError），跳过并计数：只丢这些表里的颜色。
- **级联是近似**——选择器权重是手算的紧凑实现（`:is()` 取参数最大值、`:where()` 为零），`@container`/`@scope` 按包含处理，`@layer` 按文档序；伪元素样式（`::before` 内容等）不内联；同一属性上「内联 shorthand 带 `var()`」与「命中规则」相争时规则错赢（内联本该胜）——限于这一极端组合。对图着色这类声明是准确的，对整页布局还原不承诺。
- **懒加载有预算**——遍扫总预算 20s；更长的页面抓到预算所及之处。
- **登录墙页面抓回来就是登录墙**——每次渲染都是零 Cookie 的全新上下文：这是设计，不是缺陷。
- **v1 的 allow 记录不做闸**——首次成功渲染后按主机名记下允许记录（首准时间、最近时间、次数，500 条 LRU），供未来非交互调用方做「以前批准过」的闸门；v1 里它只做簿记，危险目标无论记录永远拒绝。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**渲染管线（一次 render 的路径）。**

1. **URL 政策**：只放 http(s)；带凭据的 URL（`user:pass@host`）拒绝——本包永不携带登录态。主机名经系统 resolver 解析，**每一个**答案都必须是公网地址；字面 IP（含 `2130706433`、`0x7f.1` 这类被 WHATWG 解析器归一化的异形）直接分类。回环 / RFC1918 / CGNAT / 链路本地（含 `169.254.169.254` 云元数据）/ 组播 / 保留段全拒；IPv4 映射、NAT64、6to4 的 IPv6 按其内嵌 IPv4 分类。`localhost` 按名拒绝，不过 DNS。
2. **队列**：一次一个渲染（无头 Chrome 一跑就是几百 MB），等待线有上限，满了拒 `capture/busy`。
3. **受管浏览器**：一个 Chrome 进程（`pipe: true` 走 stdio——不监听任何 TCP 端口；`--headless=new`），**每次渲染一个全新临时 BrowserContext**。进程空闲 60s 自动退出，下次渲染重新拉起；崩溃后下次渲染自动重启。二进制是 Chrome for Testing，首次渲染时才下载；`executablePath` / `channel` 配置可改用系统 Chrome。
4. **拦截 + 导航**：请求拦截开着，**每一跳重定向都重新过第 1 步的政策**（公网 URL 302 进私网是经典 SSRF 逃逸，逐跳重查就是为此）。子资源放 http(s)/data/blob，其余 scheme（file:、chrome: 等）掐断。HTTP ≥ 400 判 `capture/navigation-failed`；导航超时判 `capture/timeout`（默认 30s，`timeoutMs` 可覆盖，钳在 1–120s）。
5. **静止等待**：`load` 之后等网络静默（500ms 无在途请求，上限 5s）。
6. **滚动遍扫**：按视口 0.8 步进扫到底，**每步停留 500ms**——transformer-circuits.pub 实测 102 个 figure 中约 20 个靠 IntersectionObserver 懒渲染，120ms/步的快扫不触发它们。扫完不回滚（虚拟化页面可能卸载屏外内容）。
7. **widget 快照**：导航前装入的监听器探针已给事件驱动的元素打好标；此刻按文档序把 canvas / 带监听的 figure 截成 WebP data URI（2x 光栅保字清，`alt` 留至多 400 字符可搜索文本），子树换成 `<img>`。超过 4096px 的 widget 与截图失败的保留原 DOM；快照阶段整体失败只记日志，绝不拖垮这次渲染。`snapshotWidgets: false` 整相关闭。
8. **内联 + 序列化**：在同一文档里：命中的 CSSOM 规则按（`!important` → 内联性 → 选择器权重 → 文档序）定胜负，写进元素 `style`；`var(--x)` 沿自定义属性级联解析（含回退与嵌套，带环保护；脚本运行时设置的或跨源样式表定义的变量由 `getComputedStyle` 兜底）；SVG 元素的呈现属性同时写成**属性**——下游白名单若只留属性不留 `style`，颜色照样在。页面脚本直接写进呈现属性的 `var()`（`fill="var(--brand)"`）与内联 shorthand 里的 `var()`（浏览器把 `background: var(--x)` 拆成枚举为空值的待替换长属性，只有属性文本还带着它）在序列化前按文本解析——实测 transformer-circuits 全页零残留。然后剥掉全部 `<script>`、`<style>` 与样式表 `<link>`（规则已内联，样式块成了冗余体积），序列化 `<!DOCTYPE html>` + `documentElement.outerHTML`，超上限（默认约 8M 字符）截断并置 `truncated`。

**权限模型（v1）：手势门。** 调用方只在用户显式点击时调 `render`——那次点击就是批准。首次**成功**渲染后把该站点（按主机名）记进 `state.json` 的 allow 记录，供未来非交互调用方做「以前批准过」的闸门；v1 里这份记录不做任何闸，失败的渲染不批准任何东西。持久化用 `node:fs` 原子写（临时文件 + rename），**不走 `ctx.fs`**（那是按会话策略上锁的沙箱文件系统）；磁盘不可写降级为仅内存，文件损坏读成空但**永不覆盖**。

**威胁模型。**

- **不受信页面内容会进入插件管线**：渲染产物是攻击者可控文本，可能写着「忽略之前的指令」。本包的缓解是 URL 政策 + 手势门 + 产物尺寸上限；**prompt injection 面是调用方的白名单问题**——阅读器把捕获产物过同一道白名单归一化，绝不直接渲染原始捕获 HTML。别把 `render` 的产物当受信内容。
- **不承载登录态**：每次渲染是全新临时 BrowserContext；带凭据的 URL 被拒；受管实例不是你的日常浏览器，你的 Cookie 不在里面。
- **SSRF**：私网/回环/链路本地/元数据地址在每一跳重定向后重查；DNS 解析失败即拒绝（未验证的主机绝不导航）。
- **进程面**：pipe 连接不监听端口；临时 profile 目录进程退出即清（残留下次拉起前扫除）；二进制来自 Google 官方 Chrome for Testing 渠道。

**架构。** Host 半 `apply` 提供 `capture` 服务核心（`ctx.provide('capture', …)`）并挂上薄 Remote 面 `captureRemote`（命名空间 `capture`，一行委托给服务核心）；浏览器半经 `ctx.remote.$mount` 挂载生成的 Remote contribution，无任何 UI。身份三角：`cordis.patch.yml` 行名、tsdown `clientBundle` id、`src/invariant.ts` 的 `PACKAGE_NAME` 同为 `@khorsheed/dsh-capture`。

**导出。** 主入口导出 `CaptureService`、`CaptureBrowserManager`、`SerialRenderQueue`、`CaptureStore`、URL 政策与页面任务的纯函数及全部线上类型；`/client` 导出浏览器半（`apply`/`inject`），`/remote` 是生成的客户端 Remote contribution，`/types` 提供线上类型，`/invariant` 是能力探针伴侣。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/capture`）。问题与贡献请移步该仓库。

```sh
pnpm install && pnpm run build   # gen-typert → tsc → tsdown（先跑 host 面）
pnpm run test                    # vitest：纯测试 + 真实 Context boot + 集成
```

集成测试（`tests/render.integration.spec.ts`）用真实 Chrome 打本地 fixture 服务器（IntersectionObserver 图 + CSS 变量 SVG + 重定向逃逸）；**没有 Chrome 二进制时整体跳过**（CI 就没有）。给测试供二进制的三种方式：`DSH_CAPTURE_CHROME_PATH` 环境变量、默认状态目录下的受管安装、系统 `chrome` 渠道。
