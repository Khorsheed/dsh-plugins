# Agent Note: file-preview 图片路由不再受加载顺序影响

Status: implemented

## Problem

`@khorsheed/dsh-file-preview` 通过宿主路由 `/file-preview-image/<会话>/<路径>` 把图片字节（png、jpg、svg 等）交给浏览器。`read` 对图片返回这个路由的地址；没有路由时返回 `kind: 'binary'`，详情页显示「二进制文件，无法预览文本」。

原来构造函数用一次性的 `ctx.get('webServer')` / `ctx.get('agents')` 探测来决定是否注册路由，而 `static inject` 只声明了 `fs`。Cordis 不保证加载顺序：服务早于这两个可选服务启动时，探测拿到 `undefined`，路由永远不注册，之后也不会再探测。2026-10-20 生产 3080 上会话产物里所有图片都显示为二进制，请求 `/file-preview-image/…` 得到的是与未知路径相同的空 404。产物以精灵图和 SVG 为主的游戏开发模式让问题暴露出来。

## Decision

路由放在 `ctx.inject(['webServer', 'agents'], …)` 子 fiber 里。两个服务都就绪时（不论先后顺序），Cordis 执行这个子 fiber；其中任一离开时撤销它。子 fiber 的 effect 注册路由，并把 agents 注册表存到服务上；撤销时注销路由、清空注册表，图片读取退回 `binary`。是否签发路由地址改为看子 fiber 是否在运行（`this.agents !== undefined`），不再是构造时定下的标志。

headless 组合不受影响：没有 `webServer` 时子 fiber 不会执行，图片照旧按 `binary` 返回。

## Alternatives considered

**把 `webServer`、`agents` 加进 `static inject`。** Cordis 4 没有可选依赖的写法（对象形式只是把名字映射到拦截配置，依赖仍是必需的），没有 web 服务器的 headless 组合会因此加载不了这个服务，连文本预览也会失去。否决。

**保留探测，用定时器重试，或每次读取时重新探测。** 读取时探测能签发地址，但服务上线的那一刻仍然要注册路由，所以生命周期钩子省不掉。`ctx.inject` 就是这个钩子，仓里也已有用法（`ankh-guard`、`canvas-novel`）。否决，等于重造 fiber。

**SVG 在客户端从文本直接渲染，绕开路由。** 对这一种格式可以当作 headless 下的兜底，但位图（以及以后的音视频，它们需要同一条字节通道）照样坏着。暂缓，未否决。

## Consequences

- 图片预览不再依赖插件的启动顺序；宿主的 web 服务器或 agents 注册表重启后，路由会自动恢复。
- 子 fiber 是异步执行的（服务就绪后的下一个任务）。构造服务后马上读图片的测试要先等一拍。`tests/read.spec.ts` 固定了服务后到和离开两种情况：服务到齐前返回 binary，到齐后返回路由地址，其中一个离开后又返回 binary。
- 这条路由也是计划中音视频预览（支持字节范围请求）要用的字节通道，那部分工作会沿用这套生命周期，不再另加一次探测。
