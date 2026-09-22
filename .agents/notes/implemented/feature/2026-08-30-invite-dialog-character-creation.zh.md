# Agent Note: room 邀请弹窗改为带实时预览与起名骰子的角色创建卡

Status: implemented

[English](2026-08-30-invite-dialog-character-creation.md) | 中文

本笔记记录 `@khorsheed/dsh-room` 邀请/编辑弹窗从垂直表单到角色创建卡的改造。

## 问题

邀请弹窗把 provider、显示名、cwd、角色指令、首个任务平铺成一个垂直表单。最有"游戏感"的两个决定——这个成员是谁、它在名册里长什么样——要邀请落地后才可见；平铺顺序还把主字段（首个任务）压在两个高级字段（角色指令、cwd）之下。

## 决策

**弹窗是带实时 `MemberCard` 预览的角色创建卡。** `MemberCard` 从 `MembersView.tsx` 提取为 `MemberCard.tsx` 并加 `preview` 标志（无操作行、固定空闲态）；弹窗每次击键都用当前表单值渲染它——称呼（空时回退到 新成员/new-member 占位）、provider 显示名、角色指令——头像色自动跟随，因为它是名字哈希（`member-color.ts`）。

**🎲 骰子从游戏风名字池（`name-pool.ts`，25 个名字）随机起名。** `rollName(taken, current)` 既不取名册已有名，也不重复当前显示名。名册经新增的 `existingNames` prop 进入弹窗；成员 tab 与新鲜 room 的 dock 胶囊传自己的 store 状态，会话头部 action（其 inject face 没有 store）走 `RoomInviteInjected` 上新增的 `listNames()`，调用时读 store 缓存。缓存未命中降级为空列表——主机的重名校验仍是兜底。

**字段按主从重排：** provider → 称呼(+🎲) → 首个任务 → ▸ 高级设置（原生 `<details>`，装角色指令与 cwd）。邀请默认折叠；编辑默认展开，因为编辑场景就是要改这些。邀请提交按钮文案为 邀请入队/Invite to the team。

**布局：宽（560px）两栏卡，左表单右预览。** 两个候选布局都在临时实例上实际搭建并截图（亮/暗、空/填）；窄卡堆叠变体在高级抽屉展开后把预览推出视口、卡片过高，而两栏分排让预览像角色卡一样陪在表单旁，纵向空间利用更好。640px 以下视口经媒体查询堆叠，预览在上。

## 被否决的方案

- **窄（380px）卡、预览堆在表单上方。** 并排截图后否决：高级抽屉展开时卡片超出视口开始滚动，预览读起来像横幅而非"正在创建的那张卡"。
- **为预览单写一个组件而不复用 `MemberCard`。** 否决："成员卡"的两份渲染会漂移；提取组件加 `preview` 标志保持一份渲染、一份样式表（`MembersView.module.css`）。

## 后果

- 全部既有行为保留：provider 未登录置灰与登录提示、门面缺失降级、名字预校验与主机结构化错误行、浏览… 选 cwd（只读展示、留空=继承）、编辑模式的 diff 提交（清空 cwd/指令以 null 清除）。176 个 client/host 测试保持绿（原 172 + 新增 4：实时预览、骰子避重名、折叠默认态、`rollName` 耗尽）。
- `tsconfig.client.json` 的显式文件清单新增 `MemberCard.tsx` 与 `name-pool.ts`。
- 既有怪癖，不在本次范围：卡片的 `onKeyDown` stopPropagation 使 Esc 只在焦点在卡片外时关闭弹窗；取消按钮始终可用。
- 已在临时实例（端口 3199，profile link 工作区包）验证：`scratch-screenshots/`（已 gitignore、未入库）下的截图覆盖两种布局与最终版的 亮/暗 × 初始/骰子/填写 矩阵。
