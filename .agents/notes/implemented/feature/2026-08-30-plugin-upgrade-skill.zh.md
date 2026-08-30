# Agent Note: the plugin-upgrade skill package — host-upgrade self-guidance distilled from the 0.1.2 wave

Status: implemented

[English](2026-08-30-plugin-upgrade-skill.md) | 中文

## Problem

0.1.2 适配波次沉淀出了一套把实例升过宿主大版本的方法:新宿主拉进独立检出、盘点断裂面(外化值导入、搬走的数据切片、删了仍能编译的命名导出)、双线修复、活体验收、带恢复地自我重启。这套方法此前只存在于 agent note 和提交历史里——全新实例里的 agent 听到"把这个实例升级一下"时无从发现它。上游对官方升级 skill 的征集把这个缺口摆到了台面上:任何要把部署升过宿主版本 bump 的人都会撞上它,不只是本仓库。

## Decision

新增 skill-only 包 `@khorsheed/dsh-plugin-upgrade`(`packages/plugin-upgrade`),把这套方法作为注册 skill 发布。形态决策:

- **skill-only,无 client 面。** host 侧只做一件事——从包内 `skills/plugin-upgrade/` 读取并注册 `plugin-upgrade` skill(`source: 'runtime'`、`provider: 'plugin-upgrade'`、`resourceBase: { kind: 'directory', path: skillDir }` 让 catalog 能列出 bundle,即 a6afaf6 落地的模式)。注册经 `ctx.inject(['skills'], …)` 等待 registry(inline-html-render 的修法);bundle 缺失/不可读降级为 warning——发现辅助绝不能拖垮启动。与 ankh-guard 不同,不落状态文件:本包不拥有任何状态。
- **SKILL.md 是产品本体。** 英文、祈使、分阶段:铁律(绝不改运行中的检出;特性探测而非版本号;typecheck 绿 ≠ 运行时干净)→ 基线 → 新宿主拉到旧宿主旁边(worktree/npm staging)→ 断裂面盘点 → 双线修复纪律 → 验证阶梯(包级 → 组合级 → 全新 HOME 活体验收且浏览器 console 零插件错误 → 按 README 从零交付)→ 自我重启(有 ankh-guard 走守卫路径,否则交接便签 + 分离 supervisor)→ 失败兜底。
- **深度放 bundle,不进正文。** `reference/breakage-checklist.md`(十二个检查面 + 编译期盲区)与 `reference/dual-host-fix-patterns.md`(命名空间导入探测、品牌类型锚定、自包含则内联、双 seat 读取器)承载 SKILL.md 概述的细节;`assets/restart-resume.sh` 是泛化后的分离 supervisor(等旧进程死 → 起新宿主 → 健康检查 → 失败回滚旧启动命令),全部由环境变量参数化,从 web-basic 的重启脚本泛化而来、剔除了一切 profile 专有逻辑。
- 全部内容已脱敏:无仓库路径、无机器路径、无实例专有信息——skill 假设读者对本 monorepo 一无所知。

## Alternatives considered

- **做成带工具的包**(注册模型可见的 `upgrade_*` 工具而非 skill)——否决:这套方法是以判断为主的散文(读 release notes、建迁移映射表),不是可调用的操作;skill 才是正确的粒度,也正是上游征集所要的形态。
- **并入 ankh-guard**——否决:ankh-guard 是重启门禁,只在有 watchdog 意义的地方安装;升级 runbook 在无守卫的实例上同样有用(Path B 正是为它们而存在),绝不能要求先装守卫。
- **全部塞进 SKILL.md**(不要 reference/ 与 assets/)——否决:清单与修复模式会把常驻加载的正文撑爆;bundle 目录注册机制的存在正是为了让细节按需加载。

## Consequences

- 社区实例获得一句话升级路径("把这个实例升级到 X"),无需任何宿主改动;tarball 自挂载、skill 自注册。
- pack-smoke 测试看守 bundle 在 tarball 中的存在(SKILL.md + reference/ + assets/);注册 spec 钉死 `source`、`provider`、`resourceBase` 与 description 的触发词。
- supervisor 脚本是 agent 按实例参数化的模板——它刻意不认识 ankh-guard、端口与 profile;守卫在场时 skill 会改走守卫路径。
- 维护:清单与模式描述的是断裂的类别而非 0.1.2 波次的具体清单,skill 应当缓慢老化;具体波次结论留在 architecture note 里,各归其位。
