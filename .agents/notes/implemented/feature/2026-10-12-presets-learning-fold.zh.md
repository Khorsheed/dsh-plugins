# Agent Note：学习模式并入 dsh-presets；bundle-learning 退役；插件卡片外显信息成为规范

状态：已实现

承接[写作 preset 归并](2026-10-06-writing-preset-fold.zh.md)。

## 问题

一次插件列表 review 暴露出三处漂移：

1. 学习模式以单行包 `@khorsheed/dsh-bundle-learning` 单独存在，没有进 presets bundle；且 bundle 的卡片文案跟不上模式增长——locale 描述仍写「三种预设模式」，而 patch 里已有四个（gamedev 落地时没同步文案）。
2. 两个自挂载包（canvas-novel、game）完全没有 `locale/`，插件卡片直接显示原始包名；bundle-eval 的 zh 卡片「评测」与 eval 成员包重名；context-lens 的 zh 卡片未翻译。
3. 已有规范钉了身份三角、自挂载与面板，唯独没提外显元数据——这个缺口直到有人看插件列表才显形。

## 决策

- **场景 preset 归一个 bundle。** `preset-learning` 逐字迁入 `@khorsheed/dsh-presets`——行 id 与 preset id 不变，已装部署的组合状态不受影响——`dsh.references` 增加 `@khorsheed/dsh-library`。bundle 卡片文案不再枚举清单（「……按会话授予人设与工具；模式随版本增加」）；逐 preset 的枚举放在 README 的来源表。
- **bundle-learning 整包退役**，登记进 `scripts/retired-packages.ts`。与 bundle-writing 不同，它已发布（npm 0.1.0），npm deprecate 随下一发布波。3080 顺序要紧：先从 profile 摘掉 bundle-learning，再上新 presets tarball——两个都装会把 `preset-learning` 挂两次。
- **卡片元数据是承重件，因此纳入检查。** 宿主经 `locale/en.json` 锚点发现卡片文案（app-boot `package-meta.ts`），缺了它就回退到原始包名。canvas-novel 与 game 补齐 locale 对（及 `./locale/*.json` export 与 files 条目）；bundle-eval 改为「评测套件」/ Evaluation Suite；context-lens 的 zh 卡片译为「上下文透镜」。`pnpm check:plugins` 现在钉：locale 存在性、两个 meta 字段、export/files 条目、自挂载包跨包按语言标题唯一；成文规范在 AGENTS.md → Package conventions → Display metadata（package.json `description` 一律英文——它是宿主的最终 en 回退与 npm 门面；五个中文为主的描述已改写）。

## 考虑过

- **每个模式一个单行 bundle。** 否决：bundle 自身描述已经证明这个形态不扩展，且 preset-declarations 包是纯数据——五行进一个 patch 比五个包好审。
- **单开一份外显规范文档。** 否决，走仓库既有形态：Package conventions 一条 + 机械检查，与 check:panels 同一路。

## 影响

- 已发布的 `@khorsheed/dsh-bundle-learning@0.1.0` 永久可装（npm 不复用名字）；retired 注册表让仓库内任何组合无法再次引用它，并让 `deploy:3080` 在 prod 仍携带时告警。
- `docs/packages.md` 已重生成（42 包，38 自挂载）；五个退役包的构建残留（`packages/{datasets,eval,mission}-tool`、`request-inspector`、`story-bible`——只有 gitignore 的 `lib/`+`node_modules/`）已本地删除。
- 测试：presets `presets.spec.ts`（learning 行的授予、精简与静音清单，移植自 bundle-learning 的 spec；评测行隔离循环纳入 learning），check-plugin-independence 新增 display-metadata describe。
