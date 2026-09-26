# 上游功能请求：`CodeBlock`/`CodeToolbar` 给 fence 信息串一个稳定的 DOM 钩子(`data-lang`)

- **状态**：功能请求（待上游评估）
- **提出方**：dsh-plugins 社区仓（`@khorsheed/dsh-*` 系列包作者）
- **目标读者**:deepseek-harness 上游维护者（`packages/client/ui-primitives` 的 markdown 渲染）
- **提出日期**：2026-09-27（3080 生产实例 dsh-card 卡片失声排查期间）

## 一句话

fence 的 info string(``` 后面的语言标记）是 markdown 语义的一部分，但当前渲染流水线在「shiki 没有该语法」时把它**完全丢弃**——DOM 里没有任何痕迹。请在 `.md-code-block` 根元素上补一个 `data-lang="<原始 info string>"` 数据属性，让下游（插件、样式、测试）不依赖 banner 文案也能读到它。

## 背景与证据

1. **info string 是唯一语义载体，且正在消失**。`render.tsx` 把它传给 `CodeBlock` 的 `lang`;`CodeToolbar`(`8d2cd0cf72`「unify code block styling」引入）的语言标签是 `supportsHighlighting(lang) ? lang : labels.codeLabel`——shiki 不认得的语言一律渲染为本地化通用标签（如「代码块」)。于是 ` ```dsh-card ` 这样的自定义 fence 在 DOM 里与「没写语言的代码块」完全不可区分：没有 `.infostring`(那条臂只在 `toolbarLabels === undefined` 时渲染）、没有 `language-*` 类、没有任何 data 属性。
2. **下游真实依赖它**。我们的 `inline-html-render` 插件把 `dsh-card` fence 原位换成沙箱 iframe（对话内嵌可交互卡片）——识别只能靠 DOM。rc.1 之前 banner 前导文本是 `<info>复制`，可靠；rc.1 起卡片静默退化成普通代码块、零报错，用户在 3080 生产上实踩。
3. **仓内已有同类钩子的先例**。`CodeBlock` 自己就声明了 `data-code-block-banner` / `data-code-block-content`,注释原文：「These paired attributes are stable semantic hooks for owner styling and DOM tests」——`data-lang` 是同诉求的自然延伸。

## 建议形态

`CodeBlock` 根元素（`.md-code-block`）上加 `data-lang={lang}`(`lang` 缺省时省略属性）。一行改动，零渲染面差异，对高亮路径无影响。

（更进一步的版本：`CodeToolbar` 对 shiki 不认得的语言，把通用标签改成「通用标签 + title=lang」或直接显示原始串。我们只请求 `data-lang`;toolbar 显示什么是产品决策，不替上游定。)

## 我们的临时绕行（供评估紧迫性)

插件侧已落内容签名识别（`@khorsheed/dsh-inline-html-render@0.1.14`)：无信息串时，完整 HTML 文档（doctype 开头、`</html>` 收尾）或含逐字严格 CSP meta 的代码块判定为卡片。这对「裸 HTML 片段卡片」无能为力，且本质是把语义标记降级为内容猜测——`data-lang` 落地后我们会退回纯信息串识别并退役签名臂。
