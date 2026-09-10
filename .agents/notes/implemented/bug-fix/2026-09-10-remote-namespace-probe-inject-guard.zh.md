# Agent Note: Remote 命名空间探测必须走 ctx.get，不能用属性访问

Status: implemented

[English](2026-09-10-remote-namespace-probe-inject-guard.md) | 中文

## Problem

在 0.1.5-rc.1 实例上活体验证 [local-files open-in-app 恢复](../feature/2026-09-10-local-files-open-in-app-restore.md)时暴露了一个死手势：工作区 tab 的「选择工作区」按钮每次点击都抛 `cannot get property "remote.directoryPicker" without inject`。该手势在 0.1.2 适配时就已悄悄死掉——当时的探测写法是属性访问 `(ctx.remote as unknown as { directoryPicker?: … }).directoryPicker`。

## Decision

`ctx.remote` 上的属性访问经由 context proxy（`vendor/cordis/src/reflect.ts`）解析，它执行按 fiber 的可见性：别的插件 fiber 注册的服务，只有消费方 fiber 在 `inject` 里声明后才可达。而声明 `remote.directoryPicker` 被否决——宿主组合里没有该命名空间时（picker seam 之前的所有宿主行）它永不注册，已注入但永不提供的服务会让整个插件 pending：旧宿主上整个工作区 tab 消失，而不是只降级一个按钮。因此探测改走 `ctx.get('remote.directoryPicker')`——reflect mixin 不经 inject 闸直接读 root store，未提供时返回 undefined，picker 手势本就把 undefined 翻译成「取消」语义的 null。`pick()` 的 RemoteResult 信封处理原本就是对的（已对照官方 `UiWorkspaceService.pickDirectory` 验证）。

## Alternatives considered

**在 `inject` 里声明 `'remote.directoryPicker'`（官方 ui-workspace 的做法）。** 对社区插件否决：ui-workspace 随永远提供该命名空间的组合一起发布；local-files 必须在没有 picker 的组合与宿主行上照常加载，那种写法会让整个插件 pending。

**给属性访问套 try/catch。** 否决：它压住崩溃，但手势恰恰在该工作的地方（0.1.5 命名空间存在）仍然死掉——错的只是访问路径。

## Consequences

「选择工作区」手势在 0.1.5 上恢复（3092 实例活体验证：无 console 报错，picker RPC 正常派发），命名空间缺席处保持「取消」语义。同文件里 `remote.localFiles` 本就走的 `ctx.get` 探测；出错的是 0.1.2 适配引入的那一处属性访问。本仓今后任何「探测可选 Remote 命名空间」的代码一律用 `ctx.get`，禁止 `ctx.remote.<ns>`。
