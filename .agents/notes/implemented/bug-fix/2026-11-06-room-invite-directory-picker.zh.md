# Agent Note: Room 邀请保留弹窗并支持两种目录后端

Status: implemented

## Problem

会话头部的邀请 chip 在点击后遇到 preset 组合可见性答案落地时，可能连已打开的弹窗一起消失，因为自隐分支会移除持有弹窗状态的组件。工作目录输入框是只读的，而「浏览」只调用 `uiWorkspace.pickDirectory`；使用 browse 目录后端的宿主会拒绝这个原生选窗调用，结果既无法浏览，也无法手填路径。

## Decision

头部自隐规则现在只控制 chip。已经打开的邀请弹窗不再受后续可见性通知影响，关闭后才重新应用当前规则。三个邀请入口——头部动作、成员页和新房间胶囊——共用同一套目录行为。

cwd 输入框允许直接输入。原生选窗仍使用 `uiWorkspace.pickDirectory`，`null` 只表示用户取消。调用拒绝且宿主提供 `uiWorkspace.listDirectory` 时，弹窗改为打开 Room 自己的目录浏览器。浏览器逐层读取宿主目录，支持面包屑、进入子目录和输入路径，最终只返回选中的绝对路径；不会创建 Workspace，也不会改变房间会话的 cwd。两种能力都没有时，仍显示原来的行内失败提示，并保留已输入的值。

移动端 Room 表单识别不再依赖 cwd 输入框的只读标记。

## Alternatives considered

**保留只调原生选窗的实现，仅让输入框可编辑。** 没选：手填只能掩盖后端不匹配，browse 后端用户仍然不能选择文件夹。

**总是用 Room 浏览器替换原生/手机选窗。** 没选：这会丢掉已经可用的宿主原生选窗和手机目录流程。回退只在原生选窗拒绝时发生，取消不会打开第二个选择器。

**复用 ui-workspace 的 Workspace 采纳界面。** 没选：邀请需要的是纯路径覆盖，不是新建 Workspace 或改变房间 cwd。公开的目录列表原语正好提供所需的宿主边界，没有这些副作用。

## Consequences

修复增加一个小型嵌套 Modal 和中英文目录文案，不新增包依赖，也不修改宿主。`RoomInviteInjected.listDirectory` 是可选字段，旧组合仍按原来的行内提示降级。被后续导航取代的目录读取会中止，避免旧结果覆盖新位置。

回归覆盖位于 `packages/room/tests/preset-visibility.client.spec.tsx`（可见性翻转时的弹窗生命周期）、`packages/room/tests/members.client.spec.tsx`（手填 cwd、原生取消、回退导航与选择）、`packages/room/tests/slots.client.spec.tsx`（uiWorkspace 接线与能力缺失语义）和 `packages/mobile/tests/surface.client.spec.ts`（可编辑 cwd 的表单识别）。
