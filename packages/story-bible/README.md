# story-bible（长篇小说写作模式 · 记忆核心）

让 dsh 成为连载长篇小说的写作工作台：一部作品跨数十个会话、上百章，模型要「记得住设定、知道上次写到哪、不欠下死伏笔、不把人物写串」。这个包是作品级记忆系统——全文注入做不到的四件事，靠它做到（方案：repo 内 `proposals/active/2026-10-04-story-bible.md`，该目录刻意 gitignored）。

**当前版本（M1+M3）**：记忆核心 + 注入面 + 右栏两个页型 tab（灵感碎片五视图 / 章节阅读）+ 工具调用定制行。对账的 subagent 委派闭环（M2）与沉睡榜台账会 / 考古图层（M4）在后。

## 它提供什么

- **作品注册表 + per-work 记忆 store**（`ctx.storyBible`）：`$DSH_HOME/state/story/` 下 `index.json` 与每部作品一目录（`work.json` / `memories.json` / `characters.json` / `experiences.jsonl` / `mentions.jsonl` / `chapters.json` / `pending.json`）。正文唯一正本是工作区里的 `<工作区>/<作品标题>/第{n}章.md`，state 目录只存派生物。
- **Remote 服务 `story`**：UI 数据面动词（listWorks / createWork / readWork / listMemories / listCharacters / listExperiences / listChapters / readChapter / ledger / listPending / listMentions / focusWork / getFocus / reviewChapter / confirmChapterPlan / writeMemory / writeCharacter / decideMemory / decidePending / patchMemory / foreshadowExit / retractExperience / extractImport）。
- **右栏两 tab（M3）**：灵感碎片（灵感墙 / 设定集 / 角色记忆 / 世界记忆 / 信息 + 钉底待审队列）与章节阅读（plan 卡 ✓确认 / 数字格换章 / 阶段灯 ✓审过 / 正文经共享内容面板渲染 / 规划中章显示大纲草案）；作品条共享（下拉切换 = focusWork、计数、新建入口）；`tool.call.toolview` 两行（story_write → plan 摘要卡「去确认」、story_extract → 对账汇总卡「去处理」）。模式可见性按跨会话规则：无运行时开关，安装层控制。
- **三个模型工具**（`./agent` 组合入口注册，origin 打标）：`story_read`（brief 三变体 / memories / character / chapters / ledger / pending / chapter）、`story_write`（work / memory 幽灵卡 / character / chapter 自动编号 / review 采纳·丢弃·归档·撤销）、`story_extract`（prepare 素材包 / import 五条校验闸落库）。
- **focus 轻指引函数段**（`story:pointer`，order 9500）：per-session focus 映射驱动——有 focus 渲染一行指引，无 focus 渲染空串；闲聊零成本。
- **`story` skill**：操作手册一份常驻、按需加载，不含任何作品内容。

## 关键设计

- **focus 作用域**：`{sessionId → workId}` 进程内映射（story 服务自带）。所有工具与注入以此为键；无 focus 的会话零注入，工具返回引导性提示而非报错。
- **不满意的正文不进记忆**：`story_extract` 的 prepare/import 都以用户「✓审过」为硬闸门。
- **落库校验永远在插件代码里**：import 五闸——evidence grep 防编造、伏笔 id 白名单、new_* 必待审、high 自动+可撤销 / medium/low 进 pending、计划落空单独进待审。判卷委派给宿主原生 subagent 是主 agent 的事，插件不委派。
- **brief 有 token 预算**：write ~2k / plan ~2.5k / extract 随正文；任何变体都不注入全部前章或全部伏笔。

## 安装

```sh
dsh plugin add @khorsheed/dsh-story-bible
```

patch 挂两行：`story-bible`（核心：store + Remote）与 `story-bible-agent`（三工具 + 轻指引 + skill，canvas 同款 `./agent` 组合入口）。把工具限定进某个 preset：在 profile 的 `cordis.patch.yml` 禁用 `story-bible-agent` 行，并在该 preset 的 `agent.cordis.yml` 加一行 `name: "@khorsheed/dsh-story-bible/agent"`——两处绝不能同时生效（工具会重名注册）。

## 快速开始

1. 右栏「灵感碎片」或「章节阅读」tab 顶部的作品条：＋ 新建作品（起名 + 选挂载工作区）或下拉选中一部——选中即本会话 focus。
2. 聊设定 → 幽灵卡落灵感墙；✓ 采纳后按 kind 路由归档（归档 → 下台进设定集）。
3. 规划 → plan 卡钉在「章节阅读」顶部，✓ 确认计划后开写；正文写工作区文件。
4. 读完点「✓ 审过本章」（人工闸门）→ 对账：`story_extract(prepare)` → 委派 subagent → `story_extract(import)`，待审项进钉底队列 ✓/✗ 处理。
5. 多作品切换 = 作品条下拉（focus 随之切换，工具与轻指引跟随）。工具调用也可全程驱动同一流程（story_write(work) focus/新建）。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm release 0.2.0-rc.2 | ✅ 开发基线（verifiedHost）：全量 build+test 在此线完成 |
| deepseek-harness master | 跟随验证；函数型 prompt 段、Typert Remote、ctx.fs 版本守卫、右栏页型 tab 均为长期 seam |

机器可读标注见 package.json `dsh.compat`（minHost `0.2.0-rc.2`）：state 写入经 ctx.fs 围栏重定界到插件自身 state 目录（只读部署仍然拒绝）；focus 映射进程内，重启即「未 focus」，轻指引、工具与作品条如实降级；headless profile 无浏览器消费者，agent 行（工具/轻指引/skill）照常可用。

English: [README.en.md](README.en.md)
