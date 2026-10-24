# Agent Note: 阅读器用自己的官方 HTTP 提供方实例抓订阅源和网页

Status: implemented

## Problem

阅读器抓订阅源和文章页都走 `ctx.web.fetch`，并依赖拿到源站的原始文档：`classifyPayload` 按内容开头（`<?xml`、`<rss`、`<feed`）区分订阅源和网页，正文提取需要 HTML，跨站重定向处理读 `WEB_REDIRECT_BLOCKED` 和落地 URL。宿主 0.2.1-rc.2 起，网页搜索设置页的「启用新版 Web 搜索 API」在写 `web.searchProvider` 的同时也写 `web.fetchProvider`，选中 `deepseek-fetch-api`；它返回 Markdown（`body.kind: 'text'`）、状态码恒为 200、URL 恒为请求地址。开关一开，所有订阅源都被当成网页，文章也提取不出正文。抓取请求只带 URL，web 服务也不公开提供方注册表，调用方没法指定用 `http` 提供方（缝台账 S22）。

## Decision

`src/document-fetch.ts` 每次调用时选抓取者。挂着的 `web` 是官方服务（带 `registerFetchProvider`）时，阅读器用 `@deepseek-ai/dsh-web-fetch-http` 的 `HttpFetchProvider` 自己建一个实例来抓（新增可选 peer，0.1.5 起公开导出），只建一次，用那一行的默认上限，再叠加阅读器新配置 `fetchLimits`。`web` 是别的形状、或宿主上没有这个包时，照旧走 `ctx.web.fetch`。`ctx.web` 仍是开关：没挂 `web` 就不抓。两个调用点（`fetchFollowing`、`resolvePaper`）都走它；策略和错误都是提供方自己的，重定向重建逻辑不变。

## Alternatives considered

- **看 `ctx.web` 的返回不像标记就重抓**：否决。`http` 提供方对订阅源和 JSON 也返回 `kind: 'text'`，判断只能靠猜；开关开着时每个网页还要先白花一次收费的 Fetch API 调用。
- **读 web 服务配置的提供方 id**：否决。`WebRuntime.config` 是私有字段，读它等于绑死宿主内部实现。
- **把 `image-fetch.ts` 的加固直连扩到文档**：否决。要重写官方提供方的字符集解码、重定向策略和错误词汇，而阅读器的分类正依赖这些。

## Consequences

- 开关开着时订阅源和文章照常工作，阅读器也不会花 Fetch API 调用费。
- `web-fetch-http` 行上抬过的上限不再作用于阅读器，部署方改在阅读器行上配 `fetchLimits`（中英 README 已更新）。3080 用的是默认值，行为不变。
- 用户特意选了别的抓取提供方（比如带代理的）时，阅读器的抓取不再经过它。
- 退役条件：抓取缝允许单次请求指定提供方（S22）。

## Testing

`tests/document-fetch.spec.ts`（7 个用例）钉住：没有 `web` 就没有抓取者；普通的 `{ fetch }` 缝原样使用，且不加载提供方包；官方服务上返回 Markdown 的缝被绕开、从未被调用；提供方只建一次，并带上默认值和配置的上限；包不在或构造抛错时退回缝；真实的 `@deepseek-ai/dsh-web-fetch-http` 能加载，并按它自己的策略拒绝回环地址。宿主 0.2.1-rc.3 上包测试全绿。
