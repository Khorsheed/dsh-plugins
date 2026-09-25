# Agent Note: 社区 agent preset 以一个声明式 bundle 发布（宿主 0.1.7-rc.1）

Status: implemented

## Problem

宿主 0.1.7-rc.1 把目录式 agent preset（`$DSH_HOME/.agent-presets/<id>/`，内含
`preset.yml` + `agent.cordis.yml`）换成了声明行：一个 preset = 一行
`@deepseek-ai/dsh-agent-preset`，由普通 bundle patch 携带，组合嵌在
`config.plugins` 下。本仓的三个社区 preset——dev（活在 3080 home）、dsh-eval 与
dsh-writing（web-eval / web profile 的场景包）——只有 0.1.5 目录形态，且 0.1.5
复制的官方组合已相对 rc.1 漂移（`workflow-worker-thread` 现为 `workflow-ptc`、
`tool-ralph` 上游默认停用、新增停用的 `tool-plugin-manager` 行）。preset 声明
bundle 也不符合 check-plugin-independence 此前的任何约定：它自挂载却没有自己的
运行时行（身份三角），且嵌套组合合法复用 profile 根的行 id（`persona`、
`tool-subagent-kimi`、`canvas-agent`……），会被全树重复 id 扫描误报。

## Decision

三个 preset 收进**一个新包 `packages/presets`（`@khorsheed/dsh-presets`，0.1.0）**，
其 `cordis.patch.yml` 是一个 `- insert:` 列表携带三行
`@deepseek-ai/dsh-agent-preset` 声明：

1. **dev（开发模式，order 10）**——官方部分**逐字采用** rc.1 的
   `standard.patch.yml` plugins 块（重基而非沿用：0.1.5 复制件的漂移以上游现状
   为准），然后逐字追加现行 dev 文件的社区节：三条
   `@khorsheed/dsh-local-agent-tool-subagent` 行（kimi-cli / codex-local /
   claude-local 配置）、`worktrees-tool`、`room-tool`、`typesafe-tool`，中文注释
   一并保留。
2. **dsh-eval（评测模式，order 0）**——`profiles/web-eval/presets/eval` 逐行迁移
   （无 Shell、无工作流的只读+委派组合，外加 `datasets-tool`/`eval-tool` 伴生行及
   其 `tools:` 档位）。官方包名逐行对照 rc.1 名册：**零改名**。
3. **dsh-writing（写作模式）**——`profiles/web/presets/dsh-writing` 逐行迁移（保留
   自己的决定：`tool-ralph` 保持启用、无 `tool-plugin-manager` 行、带
   `canvas/agent` 行）。整个迁移的**唯一**改名：`workflow-worker-thread` →
   `workflow-ptc`（id 与 name），`provider: spawn` 配置不变。

展示字段（`name`/`description`/`order`）来自各旧 `preset.yml`，中文原文保留。
patch 里每个 `name:` 值都加引号——包括展示名与 `cordis:group`，这是对源文件唯一
有意的偏离（仓规：`@` 是 YAML 保留字；两种写法 YAML 等价）。

检查器得到的是清单声明的 sanction，而不是例外清单：

- **`dsh.bundle.kind: 'preset-declarations'`**（封闭 `BUNDLE_KINDS` 词表，沿用
  `dsh.composition.component` 先例）把身份三角的「自有行」规则替换为机械钉死的
  preset 行约定：每个顶层行必须名为 `@deepseek-ai/dsh-agent-preset`、行 id 必须是
  `preset-<id>`。
- **行 id 唯一性、patch 行归属、自有行身份现在只读 patch 的顶层行**（`- insert:`
  的直接项加上裸顶层覆盖项），由新的零依赖 `parseTopLevelPatchRows` 提供。嵌在行
  `config` 下的内容组合在该行自己的作用域里，不在 profile 根——扫描要防的「重复
  id 启动失败」不可能跨这条边界，所以这一改动不会放过任何真阳性（已验证：改动前
  的树根本没有嵌套 id，扫描结果同为零 findings）。
- 本包把引用的社区工具行包名写进 `dsh.references`（数据，永不进依赖字段——与旧
  目录式 preset 同为部署层解析），并由一个 `PRESET_IDS` 常量构建最小 `lib/`
  （pack-dist 要求 `lib/` 存在）；spec 把 patch ↔ 常量 ↔ 清单与上述迁移事实钉在
  一起。

旧目录（`profiles/*/presets/`、`sync-presets.sh`）本次**有意不退役**，切换是后续
步骤。

## Alternatives considered

- **逐字沿用 0.1.5 的 dev 组合。**官方部分否决：复制件已相对 rc.1
  `standard.patch.yml` 漂移，钉着昨天的上游默认（启用的 `tool-ralph`、已改名的
  `workflow-worker-thread`）要么激活失败，要么悄悄偏离它声称扩展的 standard 线。
  社区行则是我们自己的，逐字迁移。
- **把 `presets` 加进 `NO_OWN_PATCH` 并配 `dsh.composition.component`。**这两件
  机制在构造上就否定自挂载（component 声明的是「谁挂载本包」，而本包自己挂载），
  且 bundle 必须自挂载，`dsh plugin add` 才能工作。bundle 侧的 `kind` 词表不颠倒
  语义地复刻了已有 sanction。
- **保留任意深度的朴素扫描、把 findings 压掉。**那是绕过而不是 sanction：扫描对
  未来每个 preset bundle 依然是错的，而作用域语义（嵌套 id 不可能在 profile 根
  冲突）仍然得不到表达。
- **一个 preset 一个 bundle。**一份社区模式名册复制三个几乎相同的包没有收益；
  三个 preset 同源、同宿主下限、同发布节奏，一起版本化。将来要拆，成本只是照同
  一个行形建新包。

## Consequences

- 在 0.1.7-rc.1 宿主上 `dsh plugin add @khorsheed/dsh-presets` 会把三个 preset 挂进
  会话模式名册；某 preset 引用的社区工具行包未装时，该 preset 带诊断留在名册上
  （官方机制），其余两个不受影响。0.1.5 上这个行类型不存在——README 的
  Compatibility 节与 `dsh.compat`（`minHost: 0.1.7-rc.1`）记为不可用（非
  degraded）。
- 检查器的顶层行语义从此是每个未来声明式 bundle 的契约：preset 内的 id 活在各
  preset 自己的命名空间里，只有 profile 根的行参与 id 唯一性与归属检查。spec
  覆盖了新解析器、kind 词表与嵌套 id 不冲突用例。
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 新增
  `@deepseek-ai/dsh-agent-preset@0.1.7-rc.1`（optional peer 解析时安装器自动登记）；
  peer 区间是 `^0.1.7-rc.1`——该包首次发布就在这条线，仓里惯用的 `^0.1.0-rc.6`
  下限定不到任何已发布版本。
- `docs/packages.md` 已重新生成；顺带修正了本分支上既有的 canvas 版本漂移
  （0.4.6 → 0.4.3）——它在我动手前就让 `test:scripts` 红着。
- 后续（本次不做）：3080/web-eval 切到 bundle 后退役 `sync-presets.sh` 与
  `profiles/*/presets/` 目录；生产实例采用声明行后删除旧的
  `~/.dsh-official/.agent-presets/dev` 目录。
