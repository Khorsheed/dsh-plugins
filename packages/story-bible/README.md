# story-bible（长篇小说写作模式 · 记忆核心）

让 dsh 成为连载长篇小说的写作工作台：一部作品跨数十个会话、上百章，模型要「记得住设定、知道上次写到哪、不欠下死伏笔、不把人物写串」。这个包是作品级记忆系统——全文注入做不到的四件事，靠它做到（方案：repo 内 `proposals/active/2026-10-04-story-bible.md`，该目录刻意 gitignored）。

**M1 范围（当前版本）**：记忆核心 + 注入面，**纯 host 面、无浏览器面**。右栏两个 tab（章节阅读 / 灵感碎片）在 M3 落地，消费本版本已经挂上的 Remote 数据面 `story`。

## 它提供什么

- **作品注册表 + per-work 记忆 store**（`ctx.storyBible`）：`$DSH_HOME/state/story/` 下 `index.json` 与每部作品一目录（`work.json` / `memories.json` / `characters.json` / `experiences.jsonl` / `mentions.jsonl` / `chapters.json` / `pending.json`）。正文唯一正本是工作区里的 `<工作区>/<作品标题>/第{n}章.md`，state 目录只存派生物。
- **Remote 服务 `story`**：UI 数据面动词（listWorks / createWork / readWork / listMemories / listCharacters / listExperiences / listChapters / readChapter / ledger / listPending / focusWork / getFocus / reviewChapter / writeMemory / writeCharacter / decideMemory / decidePending / extractImport）。
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

## 快速开始（M1 无 UI 的用法）

1. `story_write(what=work, title=…, workspace=…)` 新建并 focus 作品（已有作品同名即 focus）。
2. 聊设定 → `story_write(what=memory, kind=…)` 落幽灵卡；用户 ✓ 采纳（`story_write(what=review, target=memory, …)`）后按 kind 路由归档。
3. `story_read(what=brief, for=plan)` 规划 → `story_write(what=chapter, plan=…)` 建章（n 自动 max+1）。
4. `story_read(what=brief, for=write)` 写作，正文写工作区文件。
5. 用户审过 → `story_extract(chapter, phase=prepare)` → 委派 subagent → `story_extract(phase=import, payload=…)` 对账落库。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm release 0.2.0-rc.2 | ✅ 开发基线（verifiedHost）：全量 build+test 在此线完成 |
| deepseek-harness master | 跟随验证；函数型 prompt 段、Typert Remote、ctx.fs 版本守卫均为长期 seam |

机器可读标注见 package.json `dsh.compat`（minHost `0.2.0-rc.2`）：M1 无 `dsh.client` 浏览器面；state 写入经 ctx.fs 围栏重定界到插件自身 state 目录（只读部署仍然拒绝）；focus 映射进程内，重启即「未 focus」，轻指引与工具如实降级。

English: [README.en.md](README.en.md)
