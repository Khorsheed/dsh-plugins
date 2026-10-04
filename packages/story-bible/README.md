# story-bible（长篇小说写作模式 · 记忆核心）

让 dsh 成为连载长篇小说的写作工作台：一部作品跨数十个会话、上百章，模型要「记得住设定、知道上次写到哪、不欠下死伏笔、不把人物写串」。这个包是作品级记忆系统——全文注入做不到的四件事，靠它做到（方案：repo 内 `proposals/active/2026-10-04-story-bible.md`，该目录刻意 gitignored）。

**当前版本（M1+M3）**：记忆核心 + 注入面 + 右栏两个页型 tab（灵感碎片五视图 / 章节阅读）+ 工具调用定制行。对账的 subagent 委派闭环（M2）与沉睡榜台账会 / 考古图层（M4）在后。

## 它提供什么

- **作品注册表 + per-work 记忆 store**（`ctx.storyBible`）：`$DSH_HOME/state/story/` 下 `index.json` 与每部作品一目录（`work.json` / `memories.json` / `characters.json` / `experiences.jsonl` / `mentions.jsonl` / `chapters.json` / `pending.json`）。正文唯一正本是工作区里的 `<工作区>/<作品标题>/第{n}章.md`，state 目录只存派生物。
- **Remote 服务 `story`**：UI 数据面动词（listWorks / createWork / readWork / listMemories / listCharacters / listExperiences / listChapters / readChapter / ledger / listPending / listMentions / focusWork / getFocus / reviewChapter / confirmChapterPlan / writeMemory / writeCharacter / decideMemory / decidePending / patchMemory / foreshadowExit / retractExperience / extractImport）。
- **右栏一个「写作」tab（F1-4）**：内部切换 灵感碎片（五视图 + 钉底待审队列）/ 章节阅读（plan 卡 ✓确认 / 数字格换章 / 阶段灯 / 正文经共享内容面板渲染 / 规划中章显示大纲草案）；作品条共享（下拉切换 = focusWork、计数、新建入口——默认本会话工作区、可更换、跨区有警示）；`tool.call.toolview` 两行（story_write → plan 摘要卡「去确认」、story_extract → 对账汇总卡「去处理」）；会话头常驻闸门 chip（plan 待确认 / 待确认计数，按 preset 判据显隐、fail-open）。模式可见性按跨会话规则：tab 无运行时开关，安装层控制。M3 的两个旧 kind（story-fragments/story-reader）已退役：已打开的旧 tab 命中宿主 tab.unavailable 回退，关掉重开即可。
- **三个模型工具**（`./agent` 组合入口注册，origin 打标）：`story_read`（brief 三变体 / memories / character / chapters / ledger / pending / chapter）、`story_write`（work / memory 幽灵卡 / character / chapter 自动编号 / review 采纳·丢弃·归档·撤销）、`story_extract`（prepare 素材包 / import 五条校验闸落库）。
- **focus 轻指引函数段**（`story:pointer`，order 9500）：per-session focus 映射驱动——有 focus 渲染一行指引，无 focus 渲染空串；闲聊零成本。
- **`story` skill**：操作手册一份常驻、按需加载，不含任何作品内容。

## 关键设计

- **focus 作用域**：`{sessionId → workId}` 进程内映射（story 服务自带）。所有工具与注入以此为键；无 focus 的会话零注入，工具返回引导性提示而非报错。
- **审过收章，永远最后**：写完 → 对账（五闸过滤：evidence 防编造 / 伏笔白名单 / new_* 必待审 / 置信度分流 / 计划落空人答）→ 待审处理 → 用户「✓审过」收章。正文不满意就先改，别对账。
- **落库校验永远在插件代码里**：import 五闸——evidence grep 防编造、伏笔 id 白名单、new_* 必待审、high 自动+可撤销 / medium/low 进 pending、计划落空单独进待审。判卷委派给宿主原生 subagent 是主 agent 的事，插件不委派。
- **brief 有 token 预算**：write ~2k / plan ~2.5k / extract 随正文；任何变体都不注入全部前章或全部伏笔。

## 安装

```sh
dsh plugin add @khorsheed/dsh-story-bible
```

patch 挂两行：`story-bible`（核心：store + Remote，**全局可用**——任何会话都能看和改作品数据）与 `story-bible-agent`（三工具 + 轻指引 + skill，**出厂即在 profile 根禁用**）。agent 能力属于写作场景，不属于每个会话——根挂载会把三个小说工具塞进每场对话的工具单。

**启用 agent 能力的唯一正确姿势——preset 授予**：

```sh
dsh plugin add @khorsheed/dsh-bundle-writing
```

它的 `preset-writing` 声明在写作 preset 作用域内挂载同一入口（`@khorsheed/dsh-story-bible/agent`）：切到「写作」preset 的会话才有三工具、轻指引与 story skill，普通会话完全没有 story 痕迹。用自建 preset 也一样：在该 preset 的 `agent.cordis.yml` 加一行 `name: "@khorsheed/dsh-story-bible/agent"`（`@khorsheed/dsh-presets` 的 preset-dsh-writing 授予 `@khorsheed/dsh-canvas/agent` 的同款写法）。

手工打开根行（删掉 `disabled: true`）会恢复全会话生效——**只能在没有任何 preset 授予时这么做**：两处同时生效会重名注册、启动失败（canvas 的 cordis.patch.yml 写着同一条规则）。

## 快速开始

1. 右栏「灵感碎片」或「章节阅读」tab 顶部的作品条：＋ 新建作品（起名 + 选挂载工作区）或下拉选中一部——选中即本会话 focus。
2. 聊设定 → 幽灵卡落灵感墙；✓ 采纳后按 kind 路由归档（归档 → 下台进设定集）。
3. 规划 → plan 卡钉在「章节阅读」顶部，✓ 确认计划后开写；正文由 `story_write(chapter, content=…)` 经会话围栏落盘（落不进挂载工作区就拒绝登记，绝不出现空槽章）。
4. 写完对账（`story_extract(prepare)` → 委派 subagent → `story_extract(import)`），待审项进钉底队列 ✓/✗ 处理；然后「✓ 审过本章」收章——审过是人工闸门，永远最后（阶段灯：规划中 → 写作中 → 已抽取 → 已审过）。
5. 多作品切换 = 作品条下拉（focus 随之切换，工具与轻指引跟随）。工具调用也可全程驱动同一流程（story_write(work) focus/新建）。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm release 0.2.0-rc.2 | ✅ 开发基线（verifiedHost）：全量 build+test 在此线完成 |
| deepseek-harness master | 跟随验证；函数型 prompt 段、Typert Remote、ctx.fs 版本守卫、右栏页型 tab 均为长期 seam |

机器可读标注见 package.json `dsh.compat`（minHost `0.2.0-rc.2`）：state 写入经 ctx.fs 围栏重定界到插件自身 state 目录（只读部署仍然拒绝）；focus 映射进程内，重启即「未 focus」，轻指引、工具与作品条如实降级；headless profile 无浏览器消费者，agent 行（工具/轻指引/skill）照常可用。

English: [README.en.md](README.en.md)
