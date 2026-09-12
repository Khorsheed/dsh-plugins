# @khorsheed/dsh-inline-html-render

[English](README.en.md) | 中文

让 agent 直接在对话正文里渲染**可交互的 HTML 卡片**的插件:agent 写一个 ` ```dsh-card ```` fenced block,插件把这一段在消息流中间替换成**沙箱 iframe** 运行其 HTML——真正的内联、可交互,而不是 ASCII 图或一句描述。

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

- **内联在段落中间**——卡片就长在 agent 写它的位置,与文字自然衔接。
- **真正可交互**——卡片在 `sandbox="allow-scripts"` 的 iframe 里,支持任意 DOM/CSS/JS 交互(hover、点击、tab 切换、内联 SVG/canvas 动图)。
- **零侵入官方**——只改写官方**已经渲染出来的 DOM**(在渲染后的 `.md-code-block` 旁插入 iframe 并隐藏原块),不改一行官方源码。没有本插件时,` ```dsh-card ```` 退化成普通代码块,零崩溃。
- **严格沙箱**——注入 CSP(`connect-src 'none'`),卡片脚本无法联网、无法访问宿主。仅开放 `window.dshBridge.openLink / copy / download` 三个受控能力。

## 安装

不在默认 web bundle 中;一条命令完成安装并挂载(通过 `dsh.bundle` 自挂载):

```sh
dsh plugin --profile <p> add @khorsheed/dsh-inline-html-render      # 安装
dsh plugin --profile <p> remove @khorsheed/dsh-inline-html-render   # 卸载
```

## 给 agent 的写法

host 半边注册了同属 HTML 作者协议的 `inline-html-card` 与 `3d-artifact` 两个 skill（provider 均为 `inline-html-render`）。只要用户想要**看得见的结果**(比如 "show me / 预览 / 做个卡片看看 / 对比几个视觉效果 / 想要个能点击的小组件",而不是读一段文字),agent 就会套用这个协议。核心约束(详见 skill):

- 恰好一个 fenced block,info string 严格为 `dsh-card`;**用三个反引号 ```,不要用四个反引号嵌套**(嵌套会被解析成外层代码块,卡片不渲染)。
- 内容自包含:CSS/JS 内联,图片用 `data:` URI,零外部网络。
- 不要访问宿主——用 `window.dshBridge` 做外链/复制/下载。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——本插件只消费标准 DOM + 客户端运行时 `ClientContext`，`ui-conversation` 渲染出的 `.md-code-block` / banner infostring 显示位 / `data-streaming` 结构在 0.1.2-rc.1 上无变化；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- **依赖官方渲染 DOM 细节**——渲染器靠 `.md-code-block` 包裹及其 banner 里 info string 的**前导文本** `dsh-card`(本版本官方 CodeBlock 用 hash banner 包裹,没有稳定的 `.infostring` 类;also 兼容显式 `.infostring` 的元素)和 `AssistantMarkdown` 的 `data-streaming` 定位并对齐流式结束。这是仓库接受的 last-resort DOM-anchor 模式(与 message-tools 的 dom-hider 同型)。官方若改动 wrapper 类名、banner 文本形状或 info string 位置,需要用 MutationObserver 的降级路径复核。
- **沙箱无网络**——卡片脚本不能 fetch/外链资源(白名单 CDN 也不放行,比 file-preview 的 Tier1 更严)。需要联网的画面请用 file-preview 的 HTML 渲染链路,而非本插件。
- **iframe 高度自适应**——卡片渲染后按其内容高度自动撑开;极少数动态撑高的场景可能需手动触发 `data-dsh-card` 重新挂载。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

- `src/index.ts`(node 半边)——注册 `inline-html-card` 与 `3d-artifact` skill（`skills` 服务可选，缺失时保持 pending）。
- `src/client/`(浏览器半边,`/plugins/inline-html-render/client.js`):

| 模块 | 职责 |
| --- | --- |
| `renderer.ts` | `MutationObserver` 监控 DOM;对每个 info string 为 `dsh-card` 的 `.md-code-block`(显式 `.infostring` 或 banner 前导文本),读取 `<pre>` 文本(原始 HTML),在块旁插入 iframe、隐藏原块;流式未结束(`data-streaming` 存在)时不挂载,结束后重扫。 |
| `srcdoc.ts` | 把卡片 HTML 包成带严格 CSP + `dshBridge` 的完整文档(`srcdoc`)。 |
| `bridge.ts` | 宿主侧校验 iframe 消息(来源窗口 + 白名单 + 参数形状),响应 `openLink/copy/download`。 |

**为什么插 sibling 而不是替换节点**:React 拥有 markdown 树,直接 `removeChild` 会让 React 的 reconciliation 与 DOM 打架(可能抛错或让原块复活)。所以本插件**从不删 React 的节点**——把 iframe 作为兄弟节点插入该块之后,再把块 `style.display='none'`(一个 React 不管的样式),并用 MutationObserver 在每次变更后重扫。React 替换节点时(内容变化重建节点),新的块同样被捕获、再次隐藏。

**流式对齐**:回合运行时,`AssistantMarkdown` 在根上设 `data-streaming`,块内容是部分且会被重渲染。插件只在无 `data-streaming` 祖先时挂载,杜绝在半截内容上渲染。回合结束 React 重渲染时会移除 `data-streaming` 并重建块,observer 此时才真正替换。

**给插件作者**——卡片协议是拉取式(skill),不推给每个会话。你只需照 ` ```dsh-card ```` 写自包含 HTML。

</details>

## License

MIT
