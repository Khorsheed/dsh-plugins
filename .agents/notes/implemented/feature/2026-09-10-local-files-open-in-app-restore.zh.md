# Agent Note: local-files external-open 手势改走官方 open-in-app 路由

Status: implemented

[English](2026-09-10-local-files-open-in-app-restore.md) | 中文

## Problem

Host 0.1.2 把连接的 host 事实折进了 generation 的开场帧，`canOpenPath` 随之离开 wire，local-files 的 loopback 闸门（`isLoopback && hostDescription.canOpenPath === true`）永远无法确认，工作区浏览器的「打开目录 / 在 IDE 打开」手势被永久隐藏。原先假设的恢复 seam——官方 `remote.session.canOpenWorkspacePath` RPC——不存在也不会有：host 0.1.5 以 open-in-app 形态提供了该能力（`@deepseek-ai/dsh-host-open-in-app` + `@deepseek-ai/dsh-client-ui-open-in-app`，均在默认 web bundle 中）。[0.1.5 适配提案](../../../proposals/active/2026-09-10-host-015-adaptation.md)为 local-files 定案 A：包保持 `conversation.view` tab 不动，只把手势接到 open-in-app。

## Decision

client 新增 `src/client/open-in-app.ts`，镜像官方浏览器半的 wire 面。路由常量（`/open-in-app/apps`、`/open-in-app/open`）与载荷类型逐字镜像 `@deepseek-ai/dsh-host-open-in-app` 的 `./shared`——client bundle 纯净门禁止对 host 包的值导入，而镜像常量在路由万一迁移时降级为「手势隐藏」，绝不会变成启动失败。`OpenInAppProbe` 每页 GET 一次 apps 路由进 snapshot store（未应答前为 null；任何失败——宿主无 open-in-app 的 404、网络错误、畸形载荷——发布空列表，与官方 header split button 的降级一致），手势触发时向 open 路由 POST `{app, path}`。两次调用都是同源 fetch：host 路由在 connection 服务的 `requestRejection` 信任闸之后（Host/Origin + 登录令牌 cookie），同源浏览器流量天然通过。

显隐闸门替换掉失效的 `canOpenPath` 检查：探测到的 id 列表解析出支撑应用时才渲染对应手势——「打开目录」用 `finder`/`explorer`/`filemanager`（按 catalog 顺序），「在 IDE 打开」用编辑器/IDE id（cursor、vscode……JetBrains 家族，按 catalog 顺序）。官方 open 路由只收目录路径，所以两个文件手势都打开选中文件的所在目录（folder 手势原本如此；IDE 手势此前传文件本身，0.1.5 宿主会拒绝）。失效的 loopback 闸门一并移除：官方 header 按钮也不按 loopback 门控——远程浏览器的点击在宿主上启动应用，这正是该能力的定义语义——随之不再使用的 `connection` 服务、镜像模块 `host-description.ts` 与 `@deepseek-ai/dsh-client-connection` 依赖一并离包。

## Alternatives considered

**等待/提议 `remote.session.canOpenWorkspacePath`。** 否决：该 seam 上游不存在，0.1.5 的 open-in-app 就是官方答案；再提议是对已落地决策的重审。

**改为导入 `@deepseek-ai/dsh-host-open-in-app/shared` 而非镜像常量。** 否决：该说明符既不是平台模块、内联安全的 wire 层，也不是生成的 `/remote` 贡献，bundle 纯净门直接让构建失败；为三个字符串扩充内联白名单不如带出处注释的镜像。

**依赖 `@deepseek-ai/dsh-client-ui-open-in-app`、读它的 controller 状态。** 否决：为二十行 fetch 的探测引入跨插件运行时耦合；独立性规则只允许「兄弟缺席不可见」的集成，而兄弟包在这里没有我们需要的增量。

**在闸门里保留 loopback 合取项。** 否决：open-in-app 的路由经 connection 信任闸鉴权，与 loopback 无关，官方消费者向任何已认证浏览器展示按钮；local-files 自搞一套 loopback 规则只会无端偏离能力语义。

## Consequences

宿主 ≥ 0.1.5 时手势回归；0.1.2–0.1.4 宿主探测失败、手势保持隐藏，因此 `minHost` 维持 0.1.2-rc.1，Compatibility 表从一刀切的降级改为分行结论。手势现在只能打开目录——「在 IDE 打开单个文件」无法经 open-in-app 表达。应用选择按 catalog 顺序固定（首个解析到的文件管理器 / IDE）；官方 split button 的按用户选择菜单有意未移植——若用户要求自选 IDE，该菜单就是后续项。覆盖：`tests/open-in-app.client.spec.ts` 钉住探测结局（成功 / 404 / 网络失败 / 畸形载荷）、单次共享读、open 路由 POST 形状与两个 picker 的优先序。ui-file-preview 与 worktrees 带着同样的失效闸门与各自的 `dsh.compat.notes` follow-up，由各自的改动迁移到同一模式。
