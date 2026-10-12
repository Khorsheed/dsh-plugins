# Agent Note: presets 分支追平 main——恢复游戏开发模式，剪辑模式上 3080

Status: implemented

## Problem

用户报「3080 看不到剪辑模式」。排查剥出两层问题：

1. **分支落后 main 造成的线上回退（本 note 修的主问题）**：feat/video-studio 分支从 main 分叉早于 76ea67d7（游戏开发 preset，2026-10-09）合入。从这个分支打包部署 presets 0.3.0 时，tarball 里没有 `preset-dsh-gamedev` 行——3080 的组合被换成「有剪辑、没游戏开发」。换言之游戏开发模式是被这次部署顶掉的，剪辑模式反而是正常上线了。
2. **一次启动读到旧行集（未实锤，记录备查）**：20:06 那次实例启动后，名册与插件清单仍是更早的行（gamedev 在、video 无），而磁盘上 profile 里的 patch 文件、mtime 全部先于启动已是新内容；逐字节复制 profile 起的对照实例（3397）却是新行。21:48 另一次部署重启后线上名册恢复为新行。疑似安装与启动的竞态或同版本 file: tarball 的某个跳过路径，未找到持久化组合快照，机制未证实。

排查走弯两次，都被用户截图证伪：先判「浏览器缓存，强刷即可」，再判「截图来自 3098 的冻结名册实例」（3098 磁盘已同步、进程名册停在 10-11，方向对但对象错）。教训：先信用户的实证再建模；用户说「就是 3080」时，先去证明线上进程名册，而不是找别的实例。

## Decision

- 先 cherry-pick 76ea67d7（gamedev preset）回分支，再整体 `git merge main`——分支彻底追平，game 包随之入仓（check:plugins 硬性要求 `dsh.references` 的名字都在仓内），也消除下一次「旧分支部署顶掉别人新行」的同类风险。合并冲突集中在 presets 五个文件（取分支侧并集，已含 gamedev）与 check-plugin-independence.ts 的放行表（两边各加了两条，取并集）。
- presets 升 0.3.1：npm 已发 0.3.0；同版本号换内容的 tarball 正是这次「线上行集与磁盘不一致」难以排查的温床。
- 包描述与 locale 从「三种」更正为「五种」（dev / dsh-eval / dsh-writing / dsh-gamedev / dsh-video），README 与 spec 同步；dsh-video 的工具组合描述更正为独立后的真实组成（无 shell 无 web）。

## Alternatives considered

- **只 cherry-pick gamedev preset，不带 game 包**：presets 的 `dsh.references` 必须写 `@khorsheed/dsh-game`（spec 钉住），而 check:plugins 要求 references 的名字都在仓内——不带 game 包过不了门禁。
- **只 cherry-pick game 包、不合 main 其余**：game 的构建依赖 main 上较新的包面（capability-catalog 等），半追平状态构建风险更大；全量 merge 反而干净。
- **presets 保持 0.3.0**：见上，同版本换内容是事故温床；且 npm 0.3.0 已发，内容演进本就该升号。

## Consequences

- 分支现在包含 main 至 1c9780a0 的全部工作（game 包、capability-catalog 批次等）；下次从该分支部署 presets / video-studio 不会再顶掉别人的行。
- 3080 在部署 presets 0.3.1 后应同时出现剪辑模式与游戏开发模式；剪辑 tab 的自隐判据（组合里有没有 `@khorsheed/dsh-video-studio/tool` 行）不受影响。
- 操作习惯补一条：部署涉及「删行/换行」的包后，验证名册/组件清单再宣布完成——本次两轮部署都只看 canary PASS 就放行了。

## Testing

presets 包构建绿、`tests/presets.spec.ts` 14 项全绿（含 gamedev 组成钉住、五个 preset 行序、video 不点名评测行）；`pnpm check:plugins` 绿；全仓 `pnpm run build` / `pnpm run test`（合并后）见提交记录。对照实例验证：profile 逐字节复制的 3397 实例模式选择器含剪辑模式；3080 实证待部署后用户确认。
