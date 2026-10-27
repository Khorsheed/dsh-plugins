# 变更记录

## 0.2.2（2026-10-27）

- **成员桥接等待时间放宽到 30 分钟**（和提问卡一样），不再 60 秒就超时。

## 0.2.1（2026-10-27）

- 随 local-agent 家族同版发布，无自身变更。

## 0.2.0（2026-10-26）

- **版本号去掉 rc**:社区包不再发 prerelease 版本(docs/publishing.md「版本号规则」),家族各包同版 0.2.0;本节原记为 0.2.0-rc.4。
- 随 local-agent 家族同版发布(家族七包必须同一版本线),本包无变更。
- **README 重写**：改为大白话说明，完整参考移到 `docs/`；去掉过时的验收说明、失效链接和并不存在的 `dsh preflight` 命令。

## 0.2.0-rc.3（2026-10-22）

（版本号说明：本包 0.2.0-rc.2 版本号已被 npm 发布流水线占用（重复利用被 409 拒绝：「Cannot stage previously published version」——曾发布后被撤回或曾被暂存，外部无法区分，结果相同：该号不可复用）；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

- **persona 行适配宿主 0.2.1**：子 dsh patch 的 system-prompt 行不再引用 `{{cwd}}`——0.2.1 删除了该 prompt 变量，严格引用直接让模型请求失败（prod 3080 切到 0.2.1-rc.1 后的轮次失败即此）；工作目录改由宿主 working-directory 服务作为必需用户上下文提供，该条款随之删除。合并的 `persona` 字段按 0.2.1 的拆分改写为 `personaPrefix`/`personaSuffix`。
- **适配宿主 0.2.1（host-021）**：`engines.dsh` 声明为 `>=0.1.5-rc.1 <0.3.0-0`（声明即独占兼容裁决，未验证的宿主线安装期 fail-closed）；invariant 伴随件随官方删除 invariants 体系退役。运行时与 peer 区间加宽——`@deepseek-ai/dsh-cmdline`、`@deepseek-ai/dsh-ptc-runtime-node` 等补齐 0.2.0 与 0.2.1 分支（semver 预发布只覆盖比较子点名的三元组，原 `^0.1.x-rc.x` 区间在严格 npm/pnpm 解析下不覆盖 0.2.x 宿主）。`dsh.compat.verifiedHost` 前移至 0.2.1-rc.1（host-021 波对 0.2.1-rc.1 树全量构建+测试绿）。

## 0.2.0-rc.1（2026-09-30）

家族同版联动：家族折叠（委派工具收进各 provider 的 `./tool` 入口，`local-agent-tool-subagent` 退役）随 0.2.0-rc.1 线发布。无功能变更。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过。README 按仓标准补齐双语。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布。
