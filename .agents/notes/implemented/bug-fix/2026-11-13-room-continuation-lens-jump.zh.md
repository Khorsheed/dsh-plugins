# Agent Note: 重启续跑有真实消息节点，Context Lens 可以定位

Status: implemented

[English](2026-11-13-room-continuation-lens-jump.md) | [中文](2026-11-13-room-continuation-lens-jump.zh.md)

## Problem

在房间 6a56367b 里，点击 Context Lens 的第 140 / 143 轮，左侧对话不动。这一轮是 seq 1777 的手动重启续跑 `room/dispatch`，不是宿主的第 140 轮。这条 dispatch 带 `continues` 和 `task`，但没有 `messageId`；`task` 指的是启动任务的旧用户消息，不是这次续跑。Room 的直接 dispatch 续跑路径没有为该事件生成可见消息节点，因此 Lens 没有定位锚点。seq 1432 的较早自动续跑有相同文案，按正文匹配会选错轮次。

轮次菜单重复选择当前轮时，也会在同步对话之前提前返回；而点击当前轮的请求柱已经会同步对话。

## Decision

- Room 已有的 `room-auto-continue` 会话节点同时覆盖自动续跑和没有独立 `user/message` 的手动直接续跑。后者带 `manual: true`，读作「房间 · 手动」/「Room · manual」。普通用户消息仍使用官方气泡，旧日志不改写。
- Context Lens 保留 dispatch 的 `via` 和 `continues` 事实。自动续跑，或没有独立用户消息的续跑，提供 `room.continuationSeq`；`startSeq` 也是这条 dispatch 的 seq。定位器翻到该 seq，按准确的 `room-auto-continue` 类型和宿主引擎 key「类型长度:类型seq」匹配，沿用原来的落地与重试行为。
- 菜单选择轮次总会同步对话；只有轮次真的改变时才重置面板的轮次与请求状态。
- DOM 绕行仍归属 [S20](../../../../docs/upstream-seam-registry.md)。两个包必须一起交付：Room 不渲染手动续跑节点时 Lens 无处定位，只有 Room 新节点也不会增加 Lens 跳转。

## Alternatives considered

**把 `task` 当消息 id。** 那会跳到原始任务，不是本次续跑；还会混淆任务身份与 dispatch 自己的消息身份。

**按续跑正文查找。** 这个会话里多条不同 dispatch 使用同一重启文案，记录的 dispatch seq 才是唯一锚点。

**把面板轮次号用作 `data-chat-turn`。** 房间第 140 轮是和宿主轮统一排序的序号，不是宿主第 140 轮；面板地址是 `-1001777`，任何一个数字当宿主轮次都会选错或找不到。

**补写一条用户消息或修改旧日志。** 把真实 dispatch 投影出来已经足够；新增模型可见事件或改写历史没有必要，还会改变记录。

## Consequences

自动续跑保留原有节点与标签。以前没有可见行的手动续跑现在显示为房间动作，并与自动行为明确区分；新旧日志使用同一投影。节点仍缺失时保持不滚动，不增加宿主 API，也不需要持久化迁移。

## Testing

配置真实宿主后，Context Lens 41 个测试文件、384 项通过；Room 62 个文件、737 项通过。新增覆盖两种续跑、准确节点与标签、重复选择当前轮不重置请求，以及翻页到续跑节点。

真实会话回放把第 140 轮重建到 dispatch seq 1777。Room 的真实 Definition 与宿主 `conversationContextKey` 生成 `18:room-auto-continue1777`，定位器在这个准确节点上返回 true。

真实 Web 组合中的 Chromium 用例也已通过：正式注册的 Session 里，手动续跑是第 140 轮。用例验证「Room · manual」行、首次选择、手动滚走后的重复选择；目标在末页可见时接受既定的底部钳位，且没有浏览器页面错误。这是隔离浏览器验收，不声称已在生产会话里实际点击。

## Related

- [重启恢复收敛](../feature/2026-11-09-restart-recovery-consolidation.zh.md) 负责续跑的生命周期与持久化语义。
- [走势图点击可靠落地](2026-11-02-context-lens-map-jump-and-scrollbar.zh.md) 负责共享的翻页与落地行为。
