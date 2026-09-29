# Agent Note: reader 图片救助——为 CORP 阻断的配图画一条宿主侧取图通道

Status: implemented

[English](2026-09-29-reader-image-rescue.md) | 中文

## Problem

阅读器的正文视图（灵感空间）里，部分图片渲染成浏览器的裂图图标加 alt 文本——例如 `https://claude.dev/blog/automating-eval-design-and-hillclimbing/` 的全部配图。抽取层从来不是坏的：相对 `/media/…` 地址被正确绝对化，直接抓取这些 URL 都返回 200。阻断来自响应头 `cross-origin-resource-policy: same-origin`——**浏览器**在收到字节后对跨源、no-cors 的 `<img>` 嵌入强制执行（`ERR_BLOCKED_BY_RESPONSE`）。阅读器已有的 `referrerpolicy="no-referrer"` 无用——CORP 与 referer 无关——`dangerouslySetInnerHTML` 内的任何标记改动都无法解除。只有宿主进程抓取能绕过 CORP。

## Decision

经宿主救助，且只在出错后（`packages/dsh-reader`)：只有已经在浏览器里加载失败的图片才走宿主重取；健康图片永远不碰代理。

- 新增 `src/image-fetch.ts`——`fetchImageBytes(url)`：仅 http(s)、不带凭证、拒绝 localhost 名、公网地址校验并把连接**钉死**在校验过的 DNS 答案上（自定义 `lookup`，关闭 DNS 重绑定窗口），逐跳重校验重定向（最多 3 跳，中途跳私网即拒），先验 2xx + `image/*` 再读正文，8 MiB 上限，15 秒超时。另有 `ImageFetchCache`:32 MiB 字节上限的 LRU——侧栏重挂载（会让每张被阻断的图再失败一次）只读内存。
- 在阅读器已有的带鉴权 Remote 面上新增 `@Remote('fetchImage')` 动词——刻意**不**开 `webServer` HTTP 路由，那会是一个新的无鉴权面。
- `ReaderPane` 用 `onErrorCapture` 捕获 `<img>` 错误（img 的 error 不冒泡），按挂载去重，给救回的元素打标（`data-reader-rescued`)，改指到 `data:<mime>;base64,…`。旧版宿主应答错误时图片维持裂图——降级而非爆炸。

## Alternatives considered

**所有图片都走宿主代理。** 否决：常见情形（多数正文图片直连可加载）会白白翻倍流量与延迟；出错后救助只在浏览器已经失败的地方付代理成本。

**修标记层（解析 srcset、调 referrer)。** 此处无解——地址本就绝对且正确；CORP 在响应时刻强制，与标记无关。

**搭 `ctx.web.fetch`。** 结构上不可能：该缝的解码正文是封闭的 `html|text` 联合，其 provider 对二进制直接拒答 `WEB_UNSUPPORTED_CONTENT_TYPE`（已在宿主源码核实）。给它加二进制体类型是上游提案的候选。

## Consequences

被阻断的配图现在能显示；代价是 `ctx.web.fetch` 之外多出第二条出口，已在图片尺度上做了硬化。公网地址分类器拷贝自 `packages/capture/src/url-policy.ts`（跨插件导入被禁）——共享内部落点是记录在案的后续项。新测试覆盖策略拒绝（断言零网络命中）、针对 loopback 夹具的传输、缓存、以及 pane 的救助/无重试风暴行为。

## Testing

`pnpm --filter @khorsheed/dsh-reader build` 与 `test` 对钉版 0.2.0-rc.2 检出全绿（445 个测试，含新增的 `image-fetch.spec.ts` 与 pane 救助用例）；报告中那张裂图已通过真实网络实测取回。
