# Agent Note:部署检出实时提供 client 产物——钉住它,审计去别处

Status: implemented

## Problem

2026-09-10,部署检出(`~/code/deepseek-harness`)被从钉住的 `dsh-v0.1.2-rc.1` 拉到 master(比 `dsh-v0.1.5-rc.1` 还多 7 个提交)并重建,供一个 agent 审计 0.1.5 源码。运行中的 3080 服务端进程内存里仍是 rc.1 代码,看起来健康——但 web client bundle 是**按浏览器请求、从检出磁盘上实时发的**。12:23 重建之后每个加载 3080 的浏览器都拿到了 0.1.5 的 client,用它去 boot rc.1 的服务端,直接失败:32 个官方 client 插件全部 `pending`,等的是 rc.1 连线上根本不提供的服务(`sessions`、`fileUpload`、`uiWorkspace`……)。零次进程重启,prod 的浏览器半边就挂了;watchdog 的 canary 也没机会发现——它在 01:10 就已经 settled,早于重建。

此前检出被当作"启动时状态"("重建够不到运行中的实例")。这次事故证明它是**实时服务状态**:任何重写 `lib/` 或已记录 client 产物的操作,都会立刻改写 prod 实际发出的内容,中间没有任何门禁。

## Decision

- **部署检出保持钉在 prod 实际运行的 tag 上**(本笔记落笔时为 `dsh-v0.1.2-rc.1`)。它永远不用作开发、审计或类型解析工作区。re-pin 只发生在部署窗口内:fetch tags → 检出目标 tag → `pnpm run clean` → `pnpm install && pnpm run build` → build+test 转绿,让 ankh-guard 凭证(绑定 git HEAD)通过 → `pnpm deploy:3080` 部署波 → 受控重启录下新的 proven deployment。`clean` 这一步是强制的:`git reset` 不会清除被 gitignore 的 `lib/` 产物,新线留下的陈旧产物会弄坏旧线的构建(rc.1 重建就死在残留的 0.1.5 `ui-dockkit` 产物上,`clean` 清掉才好)。
- **源码审计和 0.1.5 线的工作走专用检出。** `~/code/deepseek-harness-0.1.5-alpha` 已钉 `dsh-v0.1.5-rc.1`、install+build 完成;预研 worktree `~/code/dsh-plugins-wt-pre-0.1.5` 的 `DSH_HARNESS` 指向它。未来每条新宿主线按需各建各的检出——磁盘便宜,prod 事故贵。
- **重建部署检出视同 prod 变更操作**,按重启同等级对待:先公告、在钉住的 tag 上做、完成后用浏览器验证 3080。
- watchdog 现有保障是兜底而不是方案:绑定 HEAD 的重启凭证挡住未证实的 HEAD 启动;反复启动失败会把检出回滚到 proven commit——这正是"受守护检出里的未提交状态视为可抛弃"的原因。

## Alternatives considered

- **检出一动就立刻把 prod 重启到新宿主线**——否决:插件舰队当时未适配 0.1.5(SurfaceOp / `assistant/chunk` / 格式 V3),且 V3 会话日志是不可回退点。跨过这条线唯一可接受的方式是计划内的升级波。
- **把 client 产物移到检出之外的不可变目录提供服务**——长期正确形态,但这是上游宿主改动,要走 upstream-change 管道,不做本地分叉。在那之前,纪律加专用检出足够覆盖。
- **纯靠口头约定("别碰它就行")**——在最需要它的当天早上就失效了:审计的 agent 手头没有现成的 0.1.5 检出,部署检出是阻力最小的路。因此本决定包含"常备一个构建好、钉住的分线检出",让守规则比破规则更省事。

## Consequences

- 代价:每条审计中的宿主线多一个构建好的检出(各几 GB);宿主换线从随手 reset 变成一次明确的 re-pin 仪式。
- 收益:重建任何非部署检出都不可能再悄悄改写 3080 发出的内容;watchdog 的回滚永远毁不掉在途开发,因为它守护的检出里根本没有在途开发。
- 事故诊断经验沉淀:`curl` 通但浏览器显示插件 pending,第一反应改为"核对检出发出的产物是否和运行中服务端同线",再查别的。
