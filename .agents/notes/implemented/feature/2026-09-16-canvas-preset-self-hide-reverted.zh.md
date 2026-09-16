# Agent Note: 撤回画布 preset 自隐 —— preset 绑定会话创建，画布是跨会话空间

Status: implemented

[English](2026-09-16-canvas-preset-self-hide-reverted.md) | 中文

## Problem

M2 给画布空间做了 preset 组合自隐（[M2 note](2026-09-16-canvas-space-m2.md)）：导轨图标、main 面板、tab 类型、详情 tab 体只在当前会话的 preset 组点名 `@khorsheed/dsh-canvas` 时注册——room preset-visibility 先例，一切读不到的路径 fail-open。用户在 3080 上报画布入口**整个消失了**。

根因是结构性的，不是判据写错了。preset 在**会话创建时**绑定——3080 上所有会话都是旧的 `dsh-writing` 组合创建的，它早于本包存在，自然不含画布行。画布空间是**跨会话**的：不存在任何一个会话能让判据通过，「自隐」于是等于「永隐」。fail-open 设计完全按规格工作；错的是判据用在了这块面上。room 的判据不能推广：room 的 chrome 是会话 chrome（那个 preset 把 room 授予*这个*会话是有意义的），而画布面板是部署级工作台，先于任何会话的组合存在、也比它活得久。

## Decision

**自隐整体移除，不做修补。** 删除 `packages/canvas/src/client/preset-visibility.ts`（`CanvasPresetVisibility` + `RegistrationToggle` + `CANVAS_ROW_MODULE`）与 `tests/preset-visibility.spec.ts`；四个注册（导轨行、main 面板、tab 类型、详情 tab 体）恢复 M1.5 的无条件形态——每个仍走 `ctx.slots.inject`（宿主无座位静默降级），详情 tab 的 `openTab` 激活不变。client `inject` 去掉 `sessions`（只有可见性控制器用它），devDependency `@deepseek-ai/dsh-api-session-controller` 一并移除。包版本 0.3.0 → 0.3.1（行为线动、API 不动）。

**模式可见性归安装层，双语 README 写明白。** 画布不按会话 preset 自隐；部署是否看见空间由 profile / 整合包安装哪些包决定——那是唯一真正知道部署意图的层。

**刻意保留的**：M2 的其余全部机制（side-chat 接缝、两个工具、透镜条/「追问」/「问 Agent」入口与 `chatStatus` 门、回合监听，以及 room 自己的自隐——它的面**是**会话绑定的，判据对它成立）。

## Alternatives considered

### 为什么不修判据而是删掉？

每种修补都指向同一个缺陷。「任一会话的 preset 含画布即显示」是每部署一个常量 true/false——是安装层穿了个查询的马甲。「当前 preset 组存在且未 broken 即显示」什么也藏不住。「照抄 room 但宽免老会话」是用额外步骤重新实现「可见」。判据对一块跨会话的面没有正确的按会话形态，所以诚实的改法是停止按会话问这个问题。

### 为什么不留着 toggle 机制、默认常开？

带配置开关的死机制两头最差：代码路径照付成本（四个 toggle、一个会话订阅、一次 inventory 拉取）和故障模式，去实现一个常量。若未来本包某个面**真是**会话绑定的（比如某种按会话的画布 affordance），room 那两百行模式就在 git 历史与 `packages/room/src/client/preset-visibility.ts` 里，一次检出即回。

### 为什么不只在 profile 是 headless / 无 web 消费者时隐藏？

那道门本来就有且与此无关：画布是 web 面，headless profile 根本不加载客户端半（`dsh.client.platform: web`）。被撤的代码回答的是「哪些会话看见入口」；诚实的层是「哪些部署安装本插件」（profile 组合）与「哪些平台渲染得了」（platform 字段）。

## Consequences

- 删除：`packages/canvas/src/client/preset-visibility.ts`、`packages/canvas/tests/preset-visibility.spec.ts`（8 例）。测试数 166 → 158。
- `packages/canvas/src/client/index.ts`：四个注册恢复无条件（M1.5 形态：tab 类型经 `ctx.sidebarRightTabs.register`，三个 slot 座位经 `ctx.effect(() => ctx.slots.inject(...))`）；M2 的回合监听与聊天面未动；`inject` 回到 `['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs']`。
- `packages/canvas/package.json`：0.3.0 → 0.3.1；移除 devDependency `@deepseek-ai/dsh-api-session-controller`。
- 双语 README：自隐段改为「画布不做会话 preset 自隐」/ "No per-session preset self-hide"，附一句根因与安装层规则。
- [M2 note](2026-09-16-canvas-space-m2.md) 保留其当时的决策记录；本篇是取代篇，两篇交叉链接（notes README 的 supersession 规则）。
- 无 Remote、服务、线上变更；未触碰其他包。

## Testing

- `packages/canvas`：**158 个测试全绿**（166 − 移除的 8 个可见性用例）。`rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`（pack-dist 的 stale-types 检查从干净产物开始）、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts`（191）全绿。
- 3080 上入口恢复为无条件注册——导轨图标 / main 面板 / 详情 tab 对每个会话可见，即验收投诉所求。

## Related

- [M2 note](2026-09-16-canvas-space-m2.md)（自隐当时的样子与理由）。
- [M1 note](2026-09-16-canvas-space-m1.md)（空间的挂载与其跨会话本质）。
