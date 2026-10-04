# canvas-novel（画布的「长篇小说」创作体裁）

让 dsh 成为连载长篇小说的写作工作台。一部作品跨几十个会话、上百章，模型要做到四件事：记得住设定，知道上次写到哪，不欠下死伏笔，不把人物写串。全文注入做不到这些，这个包做到了。

**一部作品就是一张体裁为「长篇小说」的画布**。画布上的卡片是设定的唯一正本，按四个分类组织：人物、世界、原则、伏笔。这个包向画布注册体裁，并提供作品记忆引擎：编号、对账、台账和 brief。它没有自己的浏览器端，界面全部长在画布里。

它取代了已退役的 `@khorsheed/dsh-story-bible`。旧的 `$DSH_HOME/state/story/` 数据**不迁移**。

## 它提供什么

- **体裁注册**（经 `ctx.canvasBoard` 延迟注入，没有画布就没有体裁）：
  - 新建或切换到「长篇小说」的画布会预置四个分类。
  - 每个分类都带卡片字段定义，例如人物有名字、身份、想要、缺失、旧伤，伏笔有悬念、状态、埋于第几章、答案。
- **引擎服务 `ctx.canvasNovel`**：引擎自己的状态放在 `$DSH_HOME/state/novel/<画布 id>/`，共五个文件：

  | 文件 | 内容 |
  |---|---|
  | `annotations.json` | 卡片的显示编号和引擎注记：张力、当前态、置信度、自动入库标记 |
  | `experiences.jsonl` | 人物经历流水，按人物卡 id 记 |
  | `mentions.jsonl` | 伏笔提及流水，按伏笔卡 id 记 |
  | `chapters.json` | 章节索引与 plan |
  | `pending.json` | 待审队列 |

  正文的唯一正本是画布挂载工作区里的 `<工作区>/<画布标题>/第{n}章.md`。
- **三个模型工具**由 `./agent` 组合入口注册，并打 origin 标：
  - `novel_read`：brief 三个变体、cards、card、chapters、ledger、pending、chapter；
  - `novel_write`：card 落幽灵卡或按编号改卡，chapter 自动编号，review 采纳、丢弃、归档、撤销；
  - `novel_extract`：prepare 产出素材包，import 过五道校验闸后落库。
- **轻指引函数段 `novel:pointer`**（order 9500）：会话绑定了长篇小说画布时渲染一行指引，否则渲染空串，闲聊零成本。
- **`novel` skill**：一份按需加载的操作手册，不含任何作品内容。

## 关键设计

- **会话绑定决定作用域**：会话头的画布 chip 把会话绑到一张画布。
  - 绑到长篇小说画布的会话才拿得到三个工具；工具在会话自己的 scope 上按需授予、按需撤回。
  - 解绑或画布改掉体裁时，工具即时撤回。
  - 没绑定的会话里，工具不存在，而不是被拒绝。
- **卡片是唯一正本**：
  - 模型新建的设定一律是**幽灵卡**（画布的 proposed 状态），用户 ✓ 采纳之前不进 brief；✗ 丢弃即归档。
  - 卡片从不删除，归档后留在画布上隐藏。
  - 改卡就地合并字段，不另起一张。
- **编号**：
  - 人物用 `c<n>`。
  - 世界和原则用 `w<n>`，伏笔用 `#<n>`。这三类共用一个号段，所以 `w19` 和 `#19` 不会并存。
  - 新卡取同号段的最大值加一。工具、plan 和对账都可以用编号、卡 id 或人物名字指代卡片。
- **审过收章，永远最后**：
  - 一章的流程是：写完 → 对账 → 处理待审 → 用户「✓ 审过」收章。
  - 正文不满意就先改，不要对账。
  - 对账的五道闸都在插件代码里：
    1. evidence 原文检索，防止编造；
    2. 伏笔白名单；
    3. 新设定、新伏笔、新人物一律落幽灵卡；
    4. 高置信度自动入库且可撤销，中低置信度进待审；
    5. 计划落空单独进待审。
  - 把判卷委派给宿主原生 subagent 是主 agent 的事，插件本身不委派。
- **brief 有 token 预算**：write 约 2k，plan 约 2.5k，extract 随正文长短。任何变体都不注入全部前章或全部伏笔。

## 安装

```sh
dsh plugin add @khorsheed/dsh-canvas-novel
```

这个包需要画布（`@khorsheed/dsh-canvas`）同在。没有画布时没有作品，每个引擎动词都回答 `missing`，不会抛错。

patch 挂两行：

| 行 | 内容 | 出厂状态 |
|---|---|---|
| `canvas-novel` | 核心：体裁加引擎 | 全局可用 |
| `canvas-novel-agent` | 三工具、轻指引和 skill | 在 profile 根**禁用** |

agent 能力属于写作场景，不属于每个会话。

**启用 agent 能力的唯一正确姿势是 preset 授予**：

```sh
dsh plugin add @khorsheed/dsh-bundle-writing
```

它的 `preset-writing` 在写作 preset 的作用域内挂载 `@khorsheed/dsh-canvas-novel/agent`。用自建 preset 也一样：在该 preset 的 `agent.cordis.yml` 里加一行 `name: "@khorsheed/dsh-canvas-novel/agent"`。

手工打开根行（删掉 `disabled: true`）会让所有会话都生效。**只能在没有任何 preset 授予时这么做**：两处同时生效会重名注册，导致启动失败。

## 快速开始

1. 新建一张画布，体裁选「长篇小说」，再挂一个工作区。在会话头的画布 chip 里把会话绑到它。
2. 聊设定。模型把设定落成幽灵卡，你在画布上 ✓ 采纳或 ✗ 丢弃。
3. 规划。`novel_write(what=chapter, plan=…)` 登记 plan，确认后开写。
   - 正文经会话围栏落进画布工作区。
   - 落不进去就拒绝登记，绝不出现空槽章。
4. 写完对账：先 `novel_extract(prepare)`，委派给 subagent，再 `novel_extract(import)`。
   - 处理待审项，然后「✓ 审过」收章。
   - 阶段灯依次是：规划中 → 写作中 → 已抽取 → 已审过。

**界面现状**：卡面、卡页、看板条子和会话头绑定 chip 由画布的体裁接缝承载。章节阅读页、伏笔台账页和待审条还没有界面，这一段先走工具。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm release 0.2.0-rc.2 | ✅ 开发基线（verifiedHost），全量 build 和 test 都在这条线上完成 |
| deepseek-harness master | 跟随验证。函数型 prompt 段、ctx.fs 版本守卫和 per-scope 工具注册都是长期 seam |

机器可读标注见 package.json 的 `dsh.compat`（minHost `0.2.0-rc.2`）：

- state 写入经 ctx.fs 围栏，重定界到插件自身的 state 目录；只读部署仍然拒绝。
- 章节正文按会话的沙箱模式写进画布工作区。
- headless profile 没有浏览器，agent 行照常可用。

English: [README.en.md](README.en.md)
