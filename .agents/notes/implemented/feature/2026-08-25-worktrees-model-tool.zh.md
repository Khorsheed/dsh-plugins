# Agent Note: worktrees 模型工具(list/switch/create/remove)与会话跟随

Status: implemented

English | [中文](2026-08-25-worktrees-model-tool.zh.md)

## Problem

worktrees 插件只展示会话静态 `header.cwd` 所在仓库,所以一个会话无法在多个 git worktree 之间切换工作,除非为每个 worktree 另开会话。也没有收尾清理习惯:worktree 越攒越多,只能手动清理。

## Decision

新增一个模型可调 `worktrees` 工具(`src/tool.ts`,经 `ctx.tools.register(defineTool(…))` 注册),四个动作,并在 `WorktreesService` 里加一个会话级 active-worktree override:

- `list` — 枚举仓库的 worktree(路径/分支/isMain/dirty/stale),`stale` = 干净且分支已合并进 base。
- `switch <path>` — 把会话的 active worktree 设成该路径,徽标/抽屉跟随。
- `create <path> [-b <branch>]` — `git worktree add`,然后 switch 过去,模型无需新建会话/cwd 即可开一个 worktree。
- `remove <path>`(`confirm: true`)— 门控删除:要求 `confirm === true`,拒删 main,拒删有未提交改动的 worktree;当删除的正是 active worktree 时清空 override(视图回落到会话 cwd = main)。

override 按 `agent.id` 用内存存储。`WorktreesRemoteService.cwd(agent)` 改为返回 `activeWorktreeOf(agent.id) ?? agent.session.header.cwd`,于是徽标/抽屉跟随。工具通过 `ctx.get?.('tools')` 探测工具注册表(属性访问 `ctx.tools` 需要 `inject: ['tools']`,那会让整个插件依赖 tools bundle 才能加载),tools 缺席时降级为仅徽标/抽屉。`remove` 采用对话确认(工具描述要求先确认;`ask_user_question` 不一定在 profile 里)。

## Verification

`tests/service.spec.ts` 新增四个用例(list isMain、create 设置 active override、switch 改指向、remove 门控 confirm/main/dirty 并清空 override)。32 个测试通过,`pnpm run build` 绿,`check:plugins` 0 finding。并在预览实例(端口 3096)上确认插件带工具启动、徽标/抽屉仍挂载。

## Alternatives considered

- **上游 live-cwd 流。** 否决——bash 的 workdir 是每次调用独立的,不是可变会话状态;harness 没有可读的"模型当前 worktree",且本插件对上游改动是规避的。工具驱动的 override 是插件侧等价物。
- **`-z` NUL 路径输出**(用于别处的路径引用问题)——与工具无关。
- **插件硬 `inject: ['tools']`。** 更简单,但会让整个插件(徽标/抽屉)依赖 tools bundle;探测方式只降级工具本身。

## Consequences

会话的徽标/抽屉跟随模型上次 switch 到的 worktree,否则默认 main。override 是内存态、按会话,宿主重启后重置(持久化暂缓)。删除 worktree 永远以用户确认为门槛,绝不删 main 或有改动的 worktree。
