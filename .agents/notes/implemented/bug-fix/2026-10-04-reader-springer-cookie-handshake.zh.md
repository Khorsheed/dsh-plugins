# Agent Note: The reader treats Springer Nature's cookie handshake as a wall the rendered fetch walks through

Status: implemented

## Problem

一篇 Springer 文章（`link.springer.com/article/10.1140/epjds/…`，开放获取）显示「这个地址需要登录（机构代理或单点登录）」，但文章并不需要登录。2026-10-04 实测：

- 不带 cookie 的请求会被 303 到 `idp.springer.com/authorize?response_type=cookie&…`。这个端点签发一次性 code，经 `/transit` 把浏览器送回文章（`?error=cookies_not_supported&code=…`），随后返回全文。`www.nature.com` 经 `idp.nature.com` 走同一套。
- 宿主的 `web-fetch-http` 不跟随跨站跳转，只报出目标 origin，插件的抓取之间也不保存 cookie。所以普通抓取永远走不完这次握手；直接请求跳回的地址，只会再开始一次握手。
- `classifyFetchFailure` 用 `LOGIN_HOST_PATTERN` 看到主机名里的 `idp`，就把这一跳记成 `login`。这个 code 永远不会升级到渲染抓取。
- 无头浏览器（capture，系统 Chrome）约 36 秒读出全文，标题正确，各章节齐全。

同一张卡片在 state 里还以同一个 id 存了两份（`link-1v6imqy`，相隔 0.7 秒）。`addSource` 在抓取之前查重，所以第一次抓取还没结束时，第二次点「添加」也通过了同样的查重，两次提交都把来源插了进去。

## Decision

- `COOKIE_HANDSHAKE_HOSTS`（`idp.springer.com`、`idp.nature.com`）和 `isCookieHandshake(message)` 放在 `src/types.ts`，宿主端和客户端共用。
- `classifyFetchFailure` 把跳往这些主机的跨站跳转记为 `blocked`，判断放在登录主机检查之前。
- 客户端的 `browserSolvable` 和 `describeFetchFailure` 认这条握手消息。装了 capture 时，打开这类条目会像微信墙一样自动渲染。
- state 规范化时，把消息是这次握手的已存 `login` 失败（来源的 `failure` 和条目的 `failureCode`）改记为 `blocked`。修复前存下的链接不用重新添加就能恢复。
- 添加的提交改走 `withNewSource`：在提交内部再按 id 和 URL 查一次重，让添加变成幂等操作。`normalizeStateDoc` 每个 id 只保留第一条，磁盘上已有的重复会被清掉。

## Alternatives considered

**由宿主端逐跳走完握手。** 接口只给出目标 origin，不给完整的 `authorize` URL，也没有 cookie 罐。直接请求 `…?error=cookies_not_supported` 得到的是又一个 303（实测）。不改宿主就做不到。

**把所有 `idp.*` 跳转都当作浏览器能解决。** `idp` 也是真正的机构身份提供方常用的名字。没有阅读者会话的无头浏览器同样会碰上真正的登录，所以名单保持显式，每一项都先实测。

**从 Europe PMC 取开放获取全文。** 它没有收录这篇文章（实测），而且也只能覆盖 Springer 的一部分文章。

## Consequences

- Springer 和 Nature 的文章需要装 capture 插件。没装时卡片显示「被拦截」而不是「需要登录」，现在这个说法才是准确的。
- 付费墙后的 Springer 文章只会渲染出摘要页：渲染抓取拿到的就是不带 cookie 的浏览器能看到的内容，不会更多。
- 新的握手主机就是 `COOKIE_HANDSHAKE_HOSTS` 里新增一行，加之前先实测。
- 测试：
  - `tests/host-pure.spec.ts`：握手记为 `blocked`，陌生的 `idp` 不算；已存的 `login` 改记，真正的登录保留；每个 id 只保留一个来源。
  - `tests/boot.spec.ts`：两次并发添加只存一个来源。
  - `tests/ReaderPane.client.spec.tsx`：遇 Springer 握手时自动渲染。
