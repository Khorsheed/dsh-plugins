# Agent Note:预设组合的工具行把核心服务改为声明式 inject(apply 时一次性探测输掉 rc.1 挂载顺序)

Status: implemented

## 问题

2026-09-27,用户在 3080 生产实例的能力目录里发现 `typesafe_judge` 不见了。排查(往线上安装里临时打进探针、受控重启后读启动日志)显示该行 apply 时 `typesafe: ABSENT`——同一份探针里 `credentials` 也 ABSENT,而宿主面服务(`tools`、`skills`、`systemPrompt`)都正常解析。

根因:rc.1 宿主线上,agent-preset registry 在**自身 apply 时**就激活预设的 standing scope,早于 profile 靠后 bundle 行的 apply。六个社区工具伴生包(typesafe-tool、worktrees-tool、room-tool、datasets-tool、eval-tool、mission-tool)各自在 apply 时用一次性 `ctx.get('<core>')` 探测核心服务:探测看到 ABSENT,apply 提前返回,而行已完成——再没有任何东西会重跑它。cordis 的服务可见性从来不是问题(临时写了个跨 scope 复现,root 提供的服务在 scope 里两种读法都能解析);一次性探测的时序才是。0.1.5 上 registry 的挂载顺序不同,同一探测能赢,所以这个潜伏竞态直到 rc.1 升级才浮现。3080 上六行在所有预设里全是死的;官方插件清单却仍显示「已启用」——行挂载了 ≠ 注册发生了。

## 决策

六个伴生包全部把核心服务改为**包级 `inject` 声明**(`typesafe`、`worktrees`、`room`、`datasets`、`dshEval`、`mission`):行在核心服务提供前 pending(preset registry 的审计容忍 pending 行——「waiting for \<core\>」——并在提供者出现时自行激活),然后整个 apply 体执行。这正是 local-agent 系 provider 早已在用的同族受支持模式;scripts/check-plugin-independence.ts 的 `COMMUNITY_SERVICE_INJECTORS` 补了这六对。apply 体内的 `ctx.get` 守卫保留为防御性直调路径(单测不经 loader 的 inject 机制直接调 apply),体内既有的 `ctx.inject(['tools'|...])` 延迟注册不动——那条教训(tools 注册表自身的挂载序竞态)依然成立。

## 否决的方案

**保留探测、核心出现时再探(用 apply 内的 ctx.inject 代替包级声明)。** 否决:行会显示「已启用」却什么都没注册——正是让这次事故隐身数天的「启用但惰死」误读。pending 才是诚实的行状态,而 registry 的审计面本来就会展示它。

**修上游挂载顺序(registry 等 profile 树落定后再激活预设)。** 宿主在上游,这里动不了;而且 registry 的成文契约本就预期「晚提供的服务激活 pending 行」,该修的是我们的一次性探测。没有可报的上游缺口。

**探测加轮询/重试。** 否决:定时器重探就是劣化版的 cordis inject。

## 后果

六个工具组(typesafe_judge、worktrees/room/datasets/eval/mission 各组)在下一次启动后回到预设会话,目录的开发模式面重新可见。组合里引用了工具行而没装 core 时,现在显示为诚实的 pending 行,而不是静默惰死。各包 `dsh.compat.notes` 与 README 已同步改写(基于探测的降级表述全部移除)。

## 测试

六包既有套件原样全绿(mock 直接调 apply,声明式 inject 对它们透明);`pnpm check:plugins` 接受六个新注入对。3080 活体验证:修复前探针打印 `typesafe: ABSENT`(临时打进已安装的 `typesafe-tool/lib/index.js`,由部署覆盖回滚),修复后开发模式目录面重新列出该工具。

## 相关

- 同一天的部署侧教训:[ankh-guard 自部署要走 reconfigure](../process/2026-09-26-ankh-guard-self-deploy-reconfigure.zh.md)。
