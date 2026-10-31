# Agent Note: 宿主 0.2.1-rc.4 适配——精确源码基线与当前 main 整合

Status: implemented

[English](2026-10-27-host-021-rc4-adaptation.md) | 中文

## Problem

npm 最初发布 rc4 时还没有公开源码 tag，因此前置适配使用 rc4 二进制包配 rc3 类型/测试种子。后来宿主在 `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` 发布了 `dsh-v0.2.1-rc.4`，而本地 `main` 自适配分支建立以来已增加 80 个非合并提交。最终验收必须使用精确 rc4 源码、纳入这些新插件改动，同时避免悄悄变成 rc5 验收。

## Decision

开发依赖图和两个固定 workflow 的宿主都钉在 rc4。只读源码检出使用精确 rc4 tag；`pnpm-workspace.yaml` 携带 rc4 pin，重新生成的锁文件同时保留当前 main 的 agent-nav workspace 边和 file-preview 的 PTC 测试依赖。`.github/workflows/ci.yml` 与 `publish.yml` 使用同一个 tag。动态前瞻 lane 继续跟随 npm `next`；它现在是 rc5，不作为本波证据。

将 `39f598455` 的 `main` 合并进适配分支。file-preview 同时保留 main 的独立 16 MiB 图片上限和新增 PTC 派发 diff 消费。S17 保留 game 轮询消费方，但用途更正为实际行为：协作间绑定在没有官方事件时变化后刷新 tab；自动导航由目的地行机制负责。

四类结论不变：**结合**——local-agent-dsh-headless 直接受益于 MCP 空资源和 account stderr 修复；**开做**——file-preview 开始消费官方早已发布的 PTC 派发元数据；**换接口**——rc4 没有新接口可迁；**退役**——没有整包退役。reader 保留自持 HTTP provider，因为 rc4 仍不能让单次请求选择 provider。file-preview mentions 和 mobile 的旧 View CSS 保留，因为其最低宿主线仍需要它们。生产验收前不前移最低宿主和 `verifiedHost` 标注。

## Alternatives considered

**继续使用 npm rc4 加 rc3 源码种子验收。** 精确 tag 已发布后不再接受：源码与二进制混线不能证明最终类型/测试结果。

**跟随 `next`、master 或 rc5。** 作为范围漂移拒绝。前瞻 lane 对预警仍有价值，但本波在所有固定位置只认一个不可变 rc4 提交。

**统一提高最低宿主并删除旧线绕行。** 拒绝：rc4 并不要求放弃已支持的旧宿主，这些绕行也不妨碍新行为。

## Consequences

分支包含当前 main 和 rc4 基线，构建、测试、打包均有完整绿色结果。没有整包退役，生产实例没有变化。各包兼容标注仍等待单独协调的 3080 宿主迁移和活体验收。main 删除源码模块后，game 和 library 必须 clean rebuild；否则增量类型产物会留下失效文件并让产物校验失败。

## Testing

跨宿主干净构建/测试使用已清理的 TypeScript 缓存和强制 typert 生成，基线是精确 rc4 检出。game 和 library clean rebuild 后，最终 `pnpm gate --all` 通过全部 17 步，包括全包测试、401 个脚本测试、文档门禁和 42 个发布包校验。

定向运行时证据独立于 monorepo gate。两个真实社区 headless `--serve` 进程使用仅声明 tools 的 stdio MCP server：`resources` 与 `resourceTemplates` 都返回空数组，每次 69 个 stdout frame 全部解析为 JSON-RPC，两个进程都以 0 退出。官方 rc4 的 ACP stdout/account 日志（2 个）、MCP 协议行为（5 个）和会话 View 行为（38 个）测试通过。reader 在 `http` 与 `deepseek-fetch-api` 两种选择下的真实运行各解析出 20 条在线订阅条目并读取 27,706 字符的 HTML 文章；选中的 DeepSeek Markdown provider 收到零次调用。file-preview 通过 22 个文件、221 个用例，包括真实 PTC create/edit 派发元数据和独立图片上限路径。

## Related

- [file-preview PTC 派发 diff](../bug-fix/2026-10-27-file-preview-ptc-dispatch-diffs.zh.md)
- [宿主 0.2.0-rc.2 适配](2026-09-29-host-020-rc2-adaptation.zh.md)
- `docs/upstream-seam-registry.md`，尤其 S1、S17、S22。
