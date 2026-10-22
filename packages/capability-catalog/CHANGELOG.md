# 变更记录

## 0.1.99（2026-10-22）

适配宿主 0.2.1 线：verifiedHost 前移至 0.2.1-rc.1，`@deepseek-ai/dsh-*` peer 区间加宽覆盖 0.2.1 并声明 `engines.dsh`（`>=0.1.5-rc.1 <0.3.0-0`）；退役 load 期 invariant 伴生探针（本包为空仪式，无行为变化）。

- **preset 生效范围编辑并为一次「保存」**：技能详情里「哪些 preset 生效」的棋盘就是全部界面——空选即所有 preset 生效；一次保存按状态自动路由：未受管技能勾了子集则纳入受管投递、已受管则改范围、把已受管技能的勾选清空再保存则释放回用户技能目录。「移入受管目录」「释放回用户技能目录」两个机制味按钮与文案退场，受管目录概念退出主流程（提示文案写明空选语义与释放去向）。见 [Agent Note](../../.agents/notes/implemented/feature/2026-10-12-preset-scope-single-save.md)
- **新增只读工具 `read_skill_file`**：限定 preset 投递的技能随投递向对应 preset 注册一个 bundle 文件只读工具——刻意不挂文件系统的模式（如学习模式的白名单技能面）也能读到被投递技能拆出去的参考文档（`search.md`/`notes.md` 等）。省略 `path` 列出 bundle 文件；读取拒绝绝对路径与 `..`，穿越符号链接后仍须留在 bundle 目录内，单文件上限 10 万字符；只对本 preset 可见的技能应答，不扩大任何磁盘可达面。组合里没有工具服务时只缺该工具，技能投递不受影响。见 [Agent Note](../../.agents/notes/implemented/feature/2026-10-12-scoped-skill-bundle-reader.md)
- **限定 preset 的技能拿得到凭证提示与注入了**：`skill` 加载后的凭证提示改按调用方作用域读取，shellEnv 注入直接扫描受管根——限定到非默认 preset 的技能此前两处都读不到它（3080 实测：已配置、已投递、可加载的技能，模型却答「密钥未设置」）；现在提示在 load 时出现、`DSH_<KEY>` 全实例注入。见 [Agent Note](../../.agents/notes/implemented/bug-fix/2026-10-12-scoped-skill-credential-scope.md)
- **受管投递不再弄丢 frontmatter `metadata:` 块**：技能纳入受管投递后，详情弹窗的凭证表单一度消失——内存投影只保留 `presetScope`，丢掉了 `metadata.credentials` 等声明。现在整个 metadata 块（js-yaml 解析，块损坏退化为无 metadata 而非拒绝投递）随投递保留，仅叠加规范化后的 presetScope。见 [Agent Note](../../.agents/notes/implemented/bug-fix/2026-10-12-managed-skill-metadata-preservation.md)
- **详情弹窗的环境变量展示修正**：已在 `metadata.credentials` 声明的变量不再同时出现在只读「引用到的环境变量」区；该区提示现在写明配置路径——在 SKILL.md frontmatter 里声明后即出现凭证表单（两份 README 同步到这一现行行为）
- **详情弹窗按打开时所在模式读 bundle 文件**：preset 对比视图（及任何非默认模式）下打开的技能详情，此前 bundle 文件按默认模式读取而误报缺失（受管技能靠兜底定义幸存，plugin/runtime 来源的直接读丢）；现在记录打开时的模式并沿用到底
- **限定投递 reconcile 串行化**：文件监听、agent-preset 事件与管理 Remote 的并发触发合并为「一趟在途 + 至多一次补跑」，不再为同一 preset 重复注册 provider；等待中的调用方等到的是自己触发的那趟结果
- **新增纯数据证据面 `produceCapabilityEvidence`**：包根导出的纯函数（不取 cordis Context、不可能挂载 standing scope），供无组合的裸进程产出可验证的 preset 组合证据——与 `snapshotFor` 同算法的摘要 sha、四个分节各带 `complete`/`partial`/`unavailable` 完整度描述（「确认为空」与「未安装/读取失败」从此可区分）、measurement/coverage 元数据；完整度不进入摘要，Remote 动词线格式字节不变。消费契约：摘要只能比不能重算，任何 partial/unavailable 节即「未验证」。见 [Agent Note](../../.agents/notes/implemented/architecture/2026-10-13-capability-catalog-completeness-evidence.md)

## 0.1.98（2026-09-30）

- **修复跨实例串读**：受管 skill 根目录的 home 解析兜底从硬编码的 `~/.dsh-official` 改为对齐官方 `resolveDshHome` 优先级（settings 服务的 home → 非空白 `$DSH_HOME` → `~/.dsh`）。旧兜底在桌面 app（settings 不报 home、环境无 `DSH_HOME`）上会把桌面实例指到另一实例的 home——桌面设置页因此列出 3080 的三个受管写作 skill 并挂出「未在任何模式生效」横幅

## 0.1.97（2026-09-30）

- **设置面直接调用 schemastery 的类型化 `.volatile()`**：0.2.0 开发线解析到 schemastery 3.18.4，其 `Schema` 已声明 `volatile()`——手写的 `VolatileCapable` 强转探测不再类型重叠（TS2352）。运行期双线行为不变：探测在 0.1.5 的 schemastery 3.18.2（无 `volatile` 方法）上仍回落到普通字段
- 加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0

## 0.1.96（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2——3080 生产实证线随宿主基线切到 rc.2；rc.1→rc.2 对本包无破坏性变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)），全量构建+测试双绿。

- **默认模式的 chip 不再加高亮**：技能详情「生效的 preset」区块与对比卡片的 chip 行回答的是「哪些模式加载它」，而默认 preset 的 chip 此前带主色底，读起来像「仅该模式可用」。现在所有 chip 同一权重；默认性移到 chip 悬停提示（新增 `modeChipDefaultHint`），并保留在模式下拉的「（默认）」后缀
- README 中英统一为中文主版；截图整理——详情弹窗与 MCP 两张从未存在的引用删除、MCP server 管理弹窗实拍落地，全部图片引用可解析

## 0.1.95（2026-09-26）

首个公开发布。
