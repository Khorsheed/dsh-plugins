# Agent Note:preset id 统一带 dsh- 前缀

Status: implemented

## 问题

`@khorsheed/dsh-presets` 声明的六个 agent preset 命名不一:rc 线上新建/重迁的四个带 `dsh-` 前缀(`dsh-eval`、`dsh-writing`、`dsh-gamedev`、`dsh-video`),最老的两个还是裸 id——`dev`(0.1.5 目录式 preset 迁移而来)与 `learning`(从退役的 bundle-learning 并入时特意保持 id 不变)。preset id 住在宿主一个全局注册表里,与官方 preset(`standard`、`minimal`)及任何第三方 bundle 共享;`dev` 这样的裸词是在共享命名空间里插旗,别的 bundle 随时可以撞名,而两种拼法并存看起来是事故而非选择(2026-10-18 维护者提出)。

## 决定

向前统一到新preset已在用的前缀约定:`dev` → `dsh-dev`、`learning` → `dsh-learning`,loader 行 id 同步为 `preset-dsh-dev` / `preset-dsh-learning`,`PRESET_IDS` 按行序更新。一个 presets 版本携带本次改名;组合内容零变化。

改名之「破坏性」来自机制而非拼写选择:注册表对未知 preset id 回硬错误 `agent-preset/not-found`(packages/preset/agent-preset-registry 的 `resolve`/`retain`)——会话存了已消失的 preset 时**没有**回退到默认的逻辑。按会话的选择是会话事件日志里的 `agent-preset/selected` 事件(`$DSH_HOME/sessions/<项目>/<会话>/session.v*.jsonl.zstd`),所以钉在 `dev`/`learning` 的旧会话会打不开 agent,直到用户在模式选择器里重选。随改动带两条缓解:

1. 部署默认值跟着改:`agent-preset-registry` 配置的 `selectedDefault: dev` → `dsh-dev`(3080 的 profile patch),新会话无感。
2. 3080 跑一次一次性迁移(`scripts/migrate-preset-selections.ts`):把两处留存 id 的地方都改写——`agent-preset/selected` 事件**与会话 header 行**(`agentPreset` 投影从 header 初始化,只有 header 的会话由第二趟补网;该趟顺带修了帧解析器对重压帧 FCS flag-1 字段宽度的错误)。值精确匹配、字符串级替换、先整份备份 `sessions/`、逐文件原子替换、幂等。从未存过选择的会话无需处理。

## 备选

**反向去前缀(eval/writing/gamedev/video 改裸词)。** 否决。要改四个而不是两个;在碰撞风险所在之处(注册表全局、官方就是裸词——社区的 `writing` 与未来的官方 preset 无法区分)丢掉命名空间护栏;而且炸的是维护者日常在用的会话(dsh-writing、dsh-video)而不是两个老 id。

**每个 preset 双 id 并存一个废弃窗口。** 否决:preset 行即其 id——`dev` 与 `dsh-dev` 并排挂载会在选择器里出现两次同一模式,机制上也没有 hidden/deprecated 开关来缓和。

## 影响

- 仓外组合、profile patch(`selectedDefault`)、skill frontmatter 的 scope(`presets: [dev]`)与文档里的裸 id 都要跟随;仓内引用随同一提交更新(presets 包、按 id 读真实 patch 的 datasets organizing spec、conversation-view-restore 上游提案)。
- capability-catalog 按 preset id 限定投递(如限定到 `learning` 的 skill)在改名后静默停投——部署清单里有一步 grep 受管 skill 根并改写 frontmatter scope。
- 对 npm 的交代是 0.3.2 下一条标记破坏性的 CHANGELOG;改名随同一发布波,不占额外版本号。
- `profiles/dev/presets/dev/`(dsh-dev 发行仓的 0.1.5 时代目录 preset)仍写裸 id,但自宿主不再扫描 `.agent-presets` 起那条安装分支就是死的——它的清理归按模式发行仓的工作,不归本次改名。

## 测试

`packages/presets` 16/16(行 id、config id、「评测行只在 dsh-eval」钉),`packages/datasets` 417/417(organizing spec 按 id 读真实 patch),`pnpm check:plugins` 42 包 0 发现,`pnpm test:scripts` 362 绿。3080 验收:部署后模式选择器出现 `dsh-dev`/`dsh-learning`;改名前的 dev 会话打开无 `agent-preset/not-found`;新会话默认开发模式。
