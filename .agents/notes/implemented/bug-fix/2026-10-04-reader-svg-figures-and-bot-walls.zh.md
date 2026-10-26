# Agent Note: The reader keeps CSS-variable SVG figures and routes bot walls to the rendered fetch

Status: implemented

## Problem

阅读器（`packages/reader`）在两类文章上失败：

- **用 CSS 自定义属性着色的内联 SVG 插图。** claude.dev 博客的插图（如 *automating-eval-design-and-hillclimbing* 的 fig1）把描边、填充和文字颜色写成 `var(--…)`。提取器的 SVG 子集原样保留这些属性值，但自定义属性定义在源站样式表里，阅读器不带，于是每个 `var()` 都解析为空。插图塌成没上色的散点，线、坐标轴和标签全部消失。这类页面还并排放一张桌面 SVG 和一张窄屏 `mobile` 副本，阅读器把两张都渲染了，而原页面靠自己的 CSS 隐藏其中一张。
- **微信公众号文章（`mp.weixin.qq.com`）。** 宿主 `web-fetch-http` 的请求（固定的 harness UA，没有浏览器指纹）拿回的是 HTTP 200 的「环境异常 … 完成验证后即可继续访问」验证页。这张页面的可见文字只有约 65 字，`captcha` 出现在第 8000 字符之后、预览窗口之外，所以 `BOT_WALL_PATTERN` 没认出来。结果是：添加对话框说「拒绝自动抓取」，正文抓取却把验证页当文章存了下来。也没有任何东西升级到渲染抓取，因为 `maybeAutoRender` 只在脚本插图空壳时触发。

## Decision

**SVG 插图。** 在 `src/client/extract-article.ts` 中：

- `resolveSvgVars` 改写保留下来的 SVG 属性里的每个 `var(...)`（按括号深度扫描，最多 32 轮）：
  - 有声明的回退值就用回退值；
  - 名字像底色的（`bg`/`background`/`surface`/`paper`/`canvas`/`page`，见 `SVG_GROUND_VAR`）改为 `none`；
  - 其余改为 `currentColor`，墨色随阅读器主题走。
- `isResponsiveAlternate` 丢掉 id/class 标明为窄屏变体（`mobile|narrow|small|compact|sm|xs` 词元）的顶层 `<svg>`，前提是存在一个没有这类名字的兄弟 `<svg>`。孤立的窄屏命名 SVG 保留。
- `ReaderPane.module.css` 把顶层 SVG 限制在栏宽内：`.article :not(svg) > svg { max-width: 100%; height: auto }`。

**机器人墙。**

- `BOT_WALL_PATTERN`（`src/service.ts`）新增匹配 `环境异常` 与 `完成验证后`。
- `fetchEntryBody` 对抓回的正文跑 `inspectPreview`。判为 `blocked` 时记为抓取失败（code `blocked`）并作为错误返回，不再把验证页当文章交出去。
- 客户端用 `browserSolvable`（`bot challenge` 或 `HTTP 401/403`）给这类错误分类：
  - 打开一个没有正文、且错误可由浏览器解决的条目时，经 `maybeAutoRender` 升级。该函数现在接收布尔 `wanted` 而不是插图数，走的是与脚本插图同一条 capture 路径。
  - 已挂载 capture Remote 时，详情页错误行提供「渲染抓取」按钮。
  - 已挂载时，添加对话框的 blocked 判定追加 `verdict.willRender` 说明。
- 没装 `@khorsheed/dsh-capture` 时，用户看到的不变：仍是普通的拒绝。

已手工验证：capture 服务（系统 Chrome）约 16 秒渲染出这篇微信文章，`js_content` 在，没有验证页文字，`mmbiz` 图片都已加载，提取器输出时带 `referrerpolicy="no-referrer"`。

**首次部署 3080 之后的跟进。**

- 正文以已提取的 HTML 缓存到 TTL 为止，所以上面的 SVG 规则碰不到部署前就存下的插图（fig1 依旧是散点）。现在显示正文时（`setArticle`）由 `repairStoredSvg` 重新做一遍 `var()` 解析和响应式副本删除，旧正文不用重抓就能修好。
- 添加路径存的是 `fetched.url`。对微信来说那是验证落地页（`/wappoc_appmsgcaptcha?…&target_url=…`），卡片标题和链接都指向验证页。现在添加路径改存请求的 URL。对已经存下的链接，`normalizeSource` 经 `challengeTarget`（路径含 captcha/challenge 且带 `target_url`/`return_url`/`redirect_url`）还原到文章地址；只有当标签是落地页的默认标签时才改标签。
- 抓取状态看不出来：渲染抓取进行中，卡片把拒绝文案、脚本插图文案混在一起，空正文上还挂着「受限篇幅」提示。现在：
  - 渲染进行中，一条带转圈的专用进度行（`detail.renderingWall`）取代拒绝文案；忙碌状态按条目区分；
  - 渲染失败会说明原因（`detail.renderFailed`），并保留重试按钮；
  - 截断提示只在有正文时出现；
  - 渲染成功后，用提取到的文章标题更新条目标题。

## Alternatives considered

**把源站样式表里的自定义属性值内联进来。** 这些值在宿主抓取不会取回的外部 CSS 里，而且随主题变化。`currentColor` 不需要第二次抓取，在阅读器的两种主题下都清晰可读。

**用 CSS 隐藏窄屏副本，而不是删掉。** 提取器的白名单会剥掉站点基于 class 的媒体查询，阅读器没有可靠的挂钩。直接删掉还能让它不进存储的正文和翻译输入。

**让宿主抓取发浏览器 User-Agent。** `web-fetch-http` 只接受插件传入的 `{url}`。改 UA 是宿主改动，得走上游流程。微信的验证也不只看 UA，而现成的渲染抓取已经能打开这张页面。

## Consequences

- 真正作填充色、又没有回退值的自定义属性，现在画成文字色而不是品牌色：清晰可读，但不忠实于原图。
- 名为 `…-sm`、并非响应式副本却有兄弟 SVG 的插图会被丢掉。
- 微信（以及任何能识别出的 200 验证页之后的页面）需要装 capture 插件。没装时，阅读器如实报「被拦截」，不再把验证页存成正文。
- 测试：`tests/extract-article.spec.ts`（var 解析、响应式副本丢弃、孤立窄屏保留、缓存正文在显示时修复）、`tests/boot.spec.ts`（200 验证页记为 blocked、保留请求 URL）、`tests/host-pure.spec.ts`（验证落地页链接迁移）、`tests/ReaderPane.client.spec.tsx`（遇微信墙自动渲染；无 capture 时普通拒绝；渲染进度行与失败原因）。
