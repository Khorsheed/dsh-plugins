# @khorsheed/dsh-inline-html-render 完整参考

> 面向开发者与 agent 的完整说明：沙箱与能力桥、卡片写法协议、DOM 识别方式与实现原理。2026-10-26 前它是本包的 README；面向用户的简介见 [README](../README.md)。

[English](reference.en.md) | 中文

把「做出来给你看」变成字面意思——agent 写的 `` ```dsh-card `` 代码块,在对话正文里原地变成一张能点、能动的 HTML 卡片。

没有它的时候,agent 想让你**看到**一个效果,只能贴段代码让你脑补,或者写个 HTML 文件等你去预览里打开。这个插件把 info string 为 `dsh-card` 的 fenced block 在消息流中间替换成一个沙箱 iframe,直接运行其中的 HTML——内联在段落之间、真正可交互,而不是 ASCII 图或一句描述。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/inline-html-card-1.png" width="640" alt="agent 回复中间的 dsh-card 代码块被渲染成一张带 tab 的数据观测卡片，与上下文文字自然衔接">

```dsh-card
<div style="font:14px system-ui;padding:16px;background:#1e1e1e;border-radius:10px;color:#eee">
  <div style="font-weight:600;margin-bottom:8px">设计 token 对照</div>
  <div style="display:flex;gap:8px">
    <span style="background:#4f8cff;color:#fff;padding:4px 10px;border-radius:6px">primary</span>
    <span style="background:#2ea043;color:#fff;padding:4px 10px;border-radius:6px">success</span>
    <span style="background:#d29922;color:#fff;padding:4px 10px;border-radius:6px">warning</span>
  </div>
</div>
```

上面这段在会话里不是一个代码块,而是一张渲染出来的卡片。

## 特性

- **内联在段落中间**——卡片就长在 agent 写它的位置,与上下文文字自然衔接;不是附件,也不占侧栏。
- **真正可交互**——卡片跑在 `sandbox="allow-scripts"` 的 iframe 里,完整 DOM/CSS/JS 可用:hover、点击、tab 切换、内联 SVG/canvas 动图都行。
- **严格沙箱**——不透明源(永不带 `allow-same-origin`)加注入式严格 CSP(`connect-src 'none'`,脚本/样式仅内联):卡片脚本碰不到宿主 DOM 与 Cookie,也联不了网。对外只开放 `window.dshBridge` 的 `openLink`(仅 https)/`copy`/`download`(仅 data: URL)三个能力,宿主侧逐条校验来源窗口与参数形状。
- **高度自适应**——不透明源让外层读不到内容高度,卡片文档在 load/resize 时把真实内容高度 postMessage 出来,外层据此撑开(封顶 20000px,防失控卡片)。
- **链接走宿主路由**——`openLink` 在带 ui-sidebar-browser 的宿主上开进右侧栏 Browser 标签页,否则退化为新窗口(`noopener`);每次打开时现探测,标签类型热增热删都不卡死。
- **公开槽优先、天然降级**——0.2.2-rc.2 起用官方 Markdown fence 槽渲染卡片;旧宿主才改写**已经渲染出来的** DOM(在代码块旁插入 iframe 并隐藏原块),不改一行官方源码;没装本插件时,`` ```dsh-card `` 就是一个普通代码块,什么也不坏。
- **随包两个作者 skill**——host 半边注册 `inline-html-card` 与 `3d-artifact`(provider 均为 `inline-html-render`),拉取式发现:agent 需要「画出来」时按协议写作,不往每个会话里塞协议。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-inline-html-render
```

重启 web 实例后生效;卸载即精确还原之前的组合。

```sh
dsh plugin --profile web remove @khorsheed/dsh-inline-html-render
```

## 给 agent 的写法

host 半边注册的 `inline-html-card` 与 `3d-artifact` 两个 skill 同属一套 HTML 作者协议。只要用户想要**看得见的结果**(“show me / 预览 / 做个卡片看看 / 对比几个视觉效果 / 想要个能点的小组件”),agent 就会套用这个协议。核心约束(完整协议见随包 skill):

- 恰好一个 fenced block,info string 严格为 `dsh-card`;**用三个反引号,不要四个、不要嵌套**——嵌套会被解析成外层代码块,卡片不渲染。
- 内容自包含:CSS/JS 全部内联,图片用 `data:` URI,零运行时网络。
- 内容即卡片:直接渲染内容本身,别再包一层假窗口/标题栏容器。
- 不访问宿主——外链、复制、下载走 `window.dshBridge`。

`3d-artifact` 面向单文件 3D / 数字孪生 HTML(three.js importmap 走白名单 CDN、GLB 模型 base64 内联、自带 Tier1 CSP);渲染器尊重卡片自带的 CSP,不重复注入。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.5-rc.1`):✅ 完整——旧宿主使用标准 DOM 与客户端运行时 `ClientContext`,minHost 0.1.2-rc.1,0.1.2 之前的宿主请停留在旧发布线。
- 源码线(deepseek-harness master):✅(verifiedHost: 0.2.2-rc.2)——`conversation.chat.markdown.fence` 以 `dsh-card` 为 key 注册,流式标志、settle 后挂载、卸载与旧宿主 DOM fallback 均经构建和 41 项测试验证。真实 rc.2 Chromium 组合也已通过官方槽显示卡片内容,iframe 带 `sandbox="allow-scripts"`,页面与控制台均无错误。

## 已知限制

- **旧宿主仍依赖官方渲染 DOM 细节**——0.2.2-rc.2 起由官方 fence 槽直接提供 `dsh-card` 信息串;旧宿主定位靠 `.md-code-block` 容器,识别走三层:显式 `.infostring` 元素→ banner 前导文本→ **内容签名**(完整 HTML 文档或逐字严格 CSP meta),并用 `data-streaming` 对齐流式结束。仅旧路径有缺口:信息串不可见时,**裸 HTML 片段**不识别为卡片,请写成完整文档。
- **默认 CSP 无网络**——渲染器注入的默认 CSP 连白名单 CDN 也不放行(比 file-preview 的 Tier1 更严);卡片文档自带 CSP 时以自带为准(`3d-artifact` 协议即内嵌放行两个 CDN `script-src` 的 Tier1 CSP)。需要联网画面的其它场景请走 file-preview 的 HTML 渲染链路,而非本插件。
- **卡片交互状态不跨重渲染**——代码内容变化会重建 iframe,卡片里的临时状态(输入、滚动位置)不保留。
- **高度自适应有边界**——高度来自卡片内部上报,封顶 20000px;极少数持续动态撑高的布局可能需要手动触发重扫。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**架构。** 浏览器半部分在 0.2.2-rc.2 通过只注入 `slots` 的嵌套作用域调用 `slots.inject('conversation.chat.markdown.fence', …)` 注册语言层。旧 DOM 观察器覆盖 fence 声明缺席的宿主,并在语言层注册成功后销毁,因此激活顺序不会造成重复 iframe。不注册 Remote。host 半部分(`src/index.ts`)经 `ctx.inject(['skills'], …)` 等 skill 注册表就绪后,注册随包的两个内容型 skill(SKILL.md 缺失/畸形只 warn 不 throw;组合里没有 `skills` 服务时保持 pending,绝不炸 boot)。身份三角:cordis.patch.yml 行 id `inline-html-render` = package.json name = tsdown `clientBundle` id。

| 模块 | 职责 |
| --- | --- |
| `src/client/fence.tsx` | 注册 `dsh-card` 语言层;流式时保留原代码块,settle 后挂载沙箱 iframe,卸载时清理由本插件持有的监听和计时器。 |
| `src/client/frame.ts` | 新旧两条路径共用的 iframe 生命周期:创建 srcdoc、加载状态与能力桥,dispose 时完整回收。 |
| `src/client/renderer.ts` | 旧宿主 DOM fallback:`MutationObserver` 找到 `dsh-card` 块,在块旁插入 iframe 容器并隐藏原块;React 重建块后回收孤儿容器并重挂。 |
| `src/client/loading.ts` | 父页加载状态:立即覆盖首绘空白;只接受当前 iframe 的 `ready` 消息,忽略初始空文档的 load;10 秒停滞后显示错误与重试,dispose 清理计时器和消息监听。 |
| `src/client/srcdoc.ts` | 把卡片 HTML 包成带严格 CSP + `dshBridge` 的完整 srcdoc 文档:片段自动补 `<html>/<head>`;作者自带的 CSP meta 统一移入 `<head>`,未声明时才补默认策略,不重复注入。sandbox 永不带 `allow-same-origin`。 |
| `src/client/bridge.ts` | 宿主侧逐条校验 iframe 消息(`event.source` 必须是受控 iframe 的 window、fn 白名单、按函数校验参数形状),响应 `openLink/copy/download` 与高度上报;未知或畸形调用回错误,绝不在宿主抛异常。 |

**旧路径为什么插兄弟节点而不是替换**:React 拥有 markdown 树,直接 `removeChild` 会让 React 的 reconciliation 与 DOM 打架(可能抛错或让原块复活)。旧路径**从不删 React 的节点**——容器作为兄弟节点插在块之后,再把块 `style.display='none'`,并用 MutationObserver 在每次变更后重扫。新槽路径由 React 直接拥有容器,不再需要这套规避。

**流式对齐**:新槽直接消费官方 `streaming` 标志,流式时渲染官方 children,settle 后才创建 iframe。旧路径只在无 `data-streaming` 祖先时挂载,回合结束 observer 重扫。

**链接路由**:`openLink` 每次打开时探测 `sidebarRightTabs`/`sidebarRight`——宿主注册了 `browser` 标签类型(ui-sidebar-browser)就开进右侧栏 Browser 标签,探测失败或 open 抛错都退化为 `window.open`(https、noopener);桥处理器强制仅 https 目标。

**给插件作者**:卡片协议是拉取式(skill),不推给每个会话;照 `` ```dsh-card `` 写自包含 HTML 即可。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/inline-html-render`)。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](../CHANGELOG.md)。
