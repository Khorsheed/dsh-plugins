# 开发流程：worktree 纪律、mainline 职责与协作规则

本仓库多人/多 agent 并发开发。本文定义三个角色、三条路径和一组冲突规则。发布与机器操作细节见 [ops.md](ops.md);本文管"人和分支怎么协作"。

## 角色

| 角色 | 谁 | 职责 |
|---|---|---|
| **插件开发者** | 各 agent(每人拥有自己的包) | 在**自己的 worktree** 开发;自测;合并回 main 后自助上 3080 验收;配合基线迁移确认自己的包 |
| **mainline 维护者** | kimi-code(实例守护者) | main 与官方线的兼容性:devDeps/lockfile/overrides/供应链排除列表;harness 检出与 vanilla 跟进;CI 健康;**整合验证**(全量 build+test);npm 与整合包发布;冲突裁决与共享状态(profile、凭证)健康 |
| **human(协调者)** | 用户 | push 节奏、发布波次拍板、跨 owner 争议的最终决定 |

mainline 不是审批者:开发者自己跑流程上线,mainline 不逐包审批;mainline 的写控制只在三处——**main 的基线文件**(lockfile/pnpm-workspace.yaml/共享脚本)、**npm 发布**、**整合包**。

## 三条路径

### 1) 开发路径(默认):worktree → main → 3080

1. **worktree-only 开发**:功能代码只允许在各自 worktree(worktree/分支)里写;主工作区不做功能开发。mainline 维护者同样遵守——基线/发布类工作可以在 main 直接做(那本就是 mainline 的职责),插件功能绝不在主工作区写。
2. worktree 内自测:包级 build+test 全绿(邻居的在制品红色状态不影响你:`GEN_TYPERT_ONLY=<你的包>`)。
3. 合并回 main:PR 或直接合并,CI 必须绿(14 步门禁,含 build/test/hygiene/check:plugins/文档门禁)。
4. 上 3080:`pnpm deploy:3080 --package packages/<你的包>` 自助完成(构建→打包→刷新→凭证→preflight→按闸重启→canary)。**只有这条流程能写 profile。**
5. 验收观察期(默认 3 天无相关事故)后进入 npm 波次。

### 2) mainline 路径(持续):跟踪官方线

官方每发一版,按 playbook 推进(以 rc.8/0.1.1 两次实战固化):

1. API diff(子代理逐包对比 .d.ts,分类 breaking/additive)→ 命中面排查
2. 基线文件:devDeps 升线、lockfile 重生成、供应链排除列表按 lockfile 实解重写、prerelease 合并冲突用 overrides 钉版
3. 全量 build+test 绿 → 更新标注(minHost 地板不动的原则、verifiedHost 推进、README Compatibility)
4. harness 检出与 vanilla 升线 → preflight → 按闸重启 3080
5. 落 Agent Note(含 playbook 增量)并通报

### 3) 发布路径(波次):3080 → npm → 整合包

- npm 由 mainline 按波次统一发布(独立包成熟一波发一波;local-agent 家族按依赖序同发;整合包最后)。发布动作照 [publishing.md](publishing.md) 自查清单。
- **整合包由 mainline 拥有**:成员增删与版本 bump 由 mainline 管理,因为每个包既要单独验证也要在整合里一起验证,单点 ownership 才落得动。
- push 到 GitHub 由 human 协调(现状不变)。

## 冲突规则

1. **共享 index 是公共区**:暂存(git add)只放自己路径;提交只带自己路径(`git commit -- <paths>`);发现别人暂存的文件,不提交、不回滚、不清理——那不是你的。
2. **基线迁移期的合并窗口**:mainline 推进官方新版本时,开发者**继续在 worktree 干活、暂缓合并**;基线落地(mainline 通报"基线绿")后再合并、再上 3080。这样基线迁移与新功能开发天然不冲突——就像本次 0.1.1 期间各包照常推进。
3. **repo 级安装收敛**:主工作区的 repo 根 `pnpm install` 容易因并发把官方包解析出多个 peer 变体(模块增强身份错位,报 `constraint 'never'`)。遇到先 `pnpm dedupe`,不行删 lockfile+node_modules 重装;频发时由 mainline 统一收敛一次并提交。
4. **deploy 互斥**:`deploy:3080` 自带 pid 锁,两个部署不会撞车;profile/凭证/preflight 状态由 mainline 定期巡检。
5. **基线变更的通知义务**:基线迁移导致某插件源码被改(如 rc.8 的 4 个包)时,mainline 必须在 Agent Note 里点名该包,owner 拉取后确认并基于新基线开发;未触及源码的包由 mainline 用全量 build+test 机械证明,不逐个打扰。
