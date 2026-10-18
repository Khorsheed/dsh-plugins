# Agent Note:按模式的安装包——六个 `dsh-<mode>` 模式包与 `@khorsheed/dsh-basic` 家族包

Status: implemented

## 问题

社区模式(开发/写作/学习/剪辑/游戏开发/评测)此前拆成互不相干的两半:`@khorsheed/dsh-presets`(preset-declarations 包,只带六条 `preset-dsh-*` 行)与模式的 preset 授予工具所在的各成员插件(要逐包自装)。装一个模式得背名单;只装 presets 则得到一个 `xxx-tool` 行全部落空的模式。家族整合包形态([2026-09-24-family-bundle-meta-packages](2026-09-24-family-bundle-meta-packages.md))已在 local-agent 与评测家族上验证了「一张卡、多行」,但模式包比家族包多一行:把家族变成模式的那条 preset 行。

## 决定

`dsh.bundle.kind: 'mode'`(checker 机制同日落地,提交 `99b7183b`)迎来它的舰队:六个模式包,每个都是 patch 末尾恰好带一条 `@deepseek-ai/dsh-agent-preset` 行(id `preset-<mode>`、`dsh.bundle.mode` 声明 `<mode>`、全树唯一)的家族包:

- `packages/dev`(`@khorsheed/dsh-dev`):local-agent 核 + kimi/codex/claude-code/dsh 四个委派 provider、worktrees、room、typesafe;`local-agent-dsh-headless` 以 deps-only 随行(与 bundle-local-agent 同一处理,在 `ALLOWED_EDGES` 登记)。
- `packages/writing`(`@khorsheed/dsh-writing`):canvas + canvas-novel。
- `packages/learning`(`@khorsheed/dsh-learning`):library。
- `packages/video`(`@khorsheed/dsh-video`):video-studio。
- `packages/gamedev`(`@khorsheed/dsh-gamedev`):game。
- `packages/bundle-eval`(`@khorsheed/dsh-bundle-eval`):family 升级为 mode `dsh-eval`;成员与「评测套件」卡面不变,版本线不动(仍未发布的 0.1.0)。

`packages/basic`(`@khorsheed/dsh-basic`)保持 `kind: 'family'`:十八个成员,无 preset 行——没有「基础模式」。

preset 行逐字镜像自 `@khorsheed/dsh-presets` 的同名行,接在同一个 `- insert:` 列表的成员行之后。漂移即红测:`scripts/preset-mode-parity.spec.ts` 把每个模式包的行与 presets 副本比对(解析后的 `plugins:` 组合 + `name`/`description`/`order`——与 web-eval parity 不同,`order` 也必须一致,两个副本跑的是同一个部署的 chip 列表),`scripts/eval-preset-parity.spec.ts` 升级为三方比对(web-eval 正本 ↔ presets ↔ bundle-eval)。两个 spec 共享 `scripts/preset-row-blocks.ts`(`rowLines`/`unquote`/`composition`/`field`)。presets 包退役(计划下一发布波)后,模式包的 patch 升为正本——每个 patch 头注释已写明——parity spec 届时删除。

伴生行此后已改为只活在组合里——见 [2026-10-19-composition-only-companion-rows](2026-10-19-composition-only-companion-rows.zh.md):模式包 patch 只 insert 成员**根行**,`./tool` / `./agent` 入口由内联 preset 按会话授予,成员 patch 的 agent 行出厂**使能**让单装开箱可用(同 id 的 profile 行与 preset 行在宿主 0.2.x 下是遮蔽而非崩 boot)。本舰队起步时的 `canvas-agent` 裸覆盖与 `game-agent` / `canvas-novel-agent` 停用手柄行都已删除。

每个包用 `tests/bundle.spec.ts` 钉住组合(行 = 成员规范行经 `parseTopLevelPatchRows` 逐字比对 + 恰好一条 preset 行 + 每成员至少贡献一行),并带齐常规范式:locale 卡面元数据、双语 README、CHANGELOG、只导常量的 `src/index.ts`(`MODE` / `FAMILY_MEMBERS`,有 deps-only 或 override 名册的也一并导出)。

`dsh.compat.minHost` 取「成员最高地板」与「preset 行机制地板」的较高者:`@deepseek-ai/dsh-agent-preset` 声明行只在宿主 0.1.7-rc.1 起存在。这一刀落在 dev(成员地板 0.1.5-rc.1 → 包地板 0.1.7-rc.1)与 video(同理)上;learning(library 0.1.7-rc.1)、gamedev(0.2.0-rc.1)、writing(canvas-novel 0.2.0-rc.2)、bundle-eval(0.2.0-rc.2)本就在其上。

## 备选

**模式继续只住 @khorsheed/dsh-presets,文档写明「再装这些包」。** 否决:那是现状——模式与家族分两次装,且没有任何机制阻止 preset 点名一个 profile 解析不了的 tool 入口。模式包让模式成为一次安装,家族由硬依赖保证在场。

**preset 行并入家族核包(如 canvas 自带 preset-dsh-writing)。** 否决:自挂载包的 patch 不得挂别家行(家族 sanction 之外),而核包带模式 = 把模式强塞给只想装核的人。bundle 保持「装插件」与「装模式」是两个独立选择。

**bundle-local-agent 直接加 preset 行,不新开 dsh-dev。** 否决:它的卡与名写的是「local-agent 家族」;开发模式更宽(worktrees/room/typesafe 不是 local-agent 成员)。模式包的成员恰是它的 preset 所授予的那个家族。

## 影响

- `scripts/check-profile-bundles.ts` 学会为 `kind: 'mode'` 也读 `dsh.bundle.members`(此前只认 `'family'`——mode kind 的提交改了 check:plugins 与 deploy:3080,漏了它;bundle-eval 一翻 kind,web-eval profile 立刻红)。现在它从 check-plugin-independence import `FAMILY_LIKE_KINDS`,两处不再可能漂移。
- 模式包与 presets 包并存期间按设计重叠(两个 family-like patch 里同一个 `preset-<mode>` 行 id——豁免 row-id 台账;同装时塌缩为同一条声明)。presets 包的退役即清理点。
- `docs/packages.md` 重生成(48 包、45 自挂载);七个新增/变更的 i18n sidecar 已记录。
- npm:六条新 0.1.0 线(`@khorsheed/dsh-basic`、`-dev`、`-writing`、`-learning`、`-video`、`-gamedev`)待下一发布波;bundle-eval 的模式升级随其首次发布出门。

## 测试

逐包:对 0.2.1-rc.1 宿主树(DSH_HARNESS=deepseek-harness-021)build + test 全绿——basic 6、dev 6、writing 7、learning 6、video 6、gamedev 6、bundle-eval 8。仓级闸:`pnpm check:plugins` 48 包 0 发现;`pnpm test:scripts` 388 绿(preset-mode-parity 18、eval-preset-parity 3、check-profile-bundles 18);`pnpm check:profiles` / `check:release-groups` / `check:packages` / `check:hygiene --all` 全净;七个包 `pack-all-dist` 打包并校验通过。
