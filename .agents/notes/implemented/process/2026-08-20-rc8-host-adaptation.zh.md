# Agent Note: rc.8 宿主适配——commands/execute images 参数 + renderMessageImages

Status: implemented

[English](2026-08-20-rc8-host-adaptation.md) | 中文

## Problem

`deepseek-harness` 发布了 `0.1.0-rc.8`(2026-08-19)。与纯增量的 rc.7 线不同,rc.8 带了两个正中本仓库插件的破坏性变更:

1. **`commands/execute` 新增必填 `images` 参数**——宿主服务签名从 `execute(agent, line, signal?)` 变为 `execute(agent, line, images, signal?)`,typert remote 同步变化,因此每个 `ctx.remote.commands.execute(sessionId, line)` 调用在 rc.8 宿主上都会传错位的参数。
2. **chat-node owner props 移除 `loadImage`，改为必填 `renderMessageImages`**——附件渲染移到 `conversation.message.images` 槽位之后;`conversation.chat.node` 键的占用者（message-tools 遮蔽官方 `user`/`steering` 渲染器）必须改调 owner-prop 渲染器，不能再直接 import `dsh-client-ui-attachment`。

本仓库消费的其余面均无变化或纯增量（cordis 4.0.1 完全一致;slot 名只新增 `conversation.message.images` / `conversation.input.attachments` / `conversation.hero.brand.mark`;`ctx.subagents.start` 与 descriptor 契约未动;`dsh-session` 在 `assistant/message` 上新增可选 `interrupted?: true`;`dsh-subagent` 的 report-delivery `'wakeup'` 改名 `'next-step'`，本仓库未使用）。

## Decision

- **四个包适配，六处调用/渲染点**:context-guard(/compact 动作）、local-agent（设置的登录/登出/preset 命令）、taskpilot(stop/interrupt 动词）为新 `images` 参数传 `[]`;message-tools 的 `UserMessageView` 改用 owner-prop `renderMessageImages({ images, align: 'end' })` 渲染历史图片，移除对 `dsh-client-ui-attachment` 的 import（及其 peer/dev 依赖）和旧 gallery 消费的本插件 `image.*` 语言键。测试同步更新到新契约。
- **这四个包的 `dsh.compat.minHost` 提到 `0.1.0-rc.8`**——minHost 是经验证的地板（依 rc.7 同步笔记的语义），而这四个包的地板真的移动了：当前构建在 rc.6/rc.7 宿主上会出错。其余包保持 `0.1.0-rc.6`(rc.7→rc.8 审计显示它们消费的面无变化或纯增量）。
- **开发基线迁到 rc.8**：所有包的 `@deepseek-ai/dsh-*` devDependencies 解析 `^0.1.0-rc.8`(`dsh-client-web-react` 除外——它没有 rc.8);peer 范围按约定保持宽线 `^0.1.0-rc.6`;lockfile 已刷新（151 个 rc.8 包，零旧线第二副本）。**`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 必须随宿主线一起换**：本次适配最初只升了 lockfile、没重写 rc.7 时代的排除列表，导致全部 rc.8 包都落在供应链策略的发布时间窗口内——主 checkout 彻底无法 `pnpm install`，直到按 lockfile 里实际的 75 条 rc.8 记录重写排除列表才恢复（`3a5e07d`，与 rc.7 时 `3743226` 的处理相同）。今后每次升宿主线都必须带这一步。
- **部署检出**(`~/code/deepseek-harness`)：沿用 rc.7 程序——guard 检查点、备份分支 `deploy-pre-rc8`、硬重置到上游 rc.8 发布合并、经 preflight 门禁由 `schedule-exit` 触发看门狗重启。taskpilot 的类型解析自该检出（`scripts/sync-harness-paths.mjs`)，所以它的构建在重置后才转绿。
- **纯净实例**(`~/.dsh-vanilla/toolchain`):npm 安装 `@deepseek-ai/dsh@0.1.0-rc.8`，在 3081 提供零插件的 rc.8 基线。
- **README Compatibility 段**在全部 17 个既有包中重新标注到 rc.8 线（中英双语，sidecar 重录）;local-agent 家族三个缺该段的 README 补齐了。其他 agent 新增的包（datasets、mission、lab）留给各自负责人。

## Alternatives considered

- **单一构建横跨 rc.7 与 rc.8**——否决：新 `images` 参数是位置参数且必填，`renderMessageImages` 又替代了被删除的 prop，不存在在两条线上都正确的调用形状；本仓库跟随宿主线并如实标注地板。
- **peer 范围提到 `^0.1.0-rc.8`**——依 rc.7 笔记否决：peer 范围是兼容包络而非当前线；地板由 `dsh.compat.minHost` 承载。
- **保留 `image.*` 语言键 / ui-attachment 依赖以备将来 gallery**——否决：迁移后即死重；rc.8 的附件槽占用者拥有图片呈现（含标签）。

## Consequences

- rc.8 成为开发基线：全新安装解析 rc.8 类型，四个适配包声明它为地板，本地两个实例（3080 prod、3081 vanilla）均服务 rc.8。
- message-tools 的 prod `file:` tarball 已用适配后的构建重新打包（同 0.4.9 线，profile 引用不变）。
- gen-typert 在新类型环境下因陈旧 overlay 崩过一次（file-preview 报 `Remote boundary contains non-JSON type undefined`)；首次干净重生成刷新 overlay 后未再复发——记录在此，因为升级中途遇到它会显得吓人，但它是自愈的。
- ankh-guard 的降级 preflight 项维持降级：rc.8 仍未导出 `composeProfile`。
- 官方的 `@deepseek-ai/dsh-subagent-codex` / `dsh-subagent-claude-code`（可选 bundle,dsh-base 默认不挂载）与 local-agent 家族只在一次性委派上重叠；家族的作用域 home、跨轮 resume、会话记录与设置 UI 仍是差异化，且 provider/工具命名不冲突。
- **老 harness 检出升宿主线的残留坑**:`git reset --hard` 只清跟踪文件，新线里被删除或迁出的包的目录会以 `node_modules`/`lib` 残留存活。tsdown 的 workspace 枚举是目录 glob(`packages/*/*`)，每个残骸目录都变成一个幻影"包"（名字经配置回落取自根包）；若残骸没有构建好的 `lib/types`，整个构建以 `Cannot find entry` 中止。部署检出带了 13 个幻影（迁出的社区插件、退役的 `web-react`/`schema-form`)，镜像 2 个——均已清理。今后更新检出时，构建前应先扫掉没有 `package.json` 的 `packages/*/*` 目录。
- 跟进（2026-08-20）：适配改了 local-agent 的源码但漏了测试——`local-agent.spec.ts` 仍以 rc.7 的实参个数调用 `commands.execute`（17 个失败），客户端 locale 用例仍假设默认语言是 zh，而 rc.8 的初始语言跟随浏览器（jsdom 报 en-US）。修复：测试为 images 传 `[]`，locale 用例显式 `setLocale('zh')` 固定。教训：升宿主线后要逐包跑全量测试，而不只是跑源码改过的包。
