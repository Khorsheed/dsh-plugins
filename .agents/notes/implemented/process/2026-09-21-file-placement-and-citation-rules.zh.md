# Agent Note：提案附件与证据的文件归置与引用规则

Status: implemented

## Problem

仓库四周攒下了「没有归属」的内容：工作树根目录躺着一份页面快照 dump，HTML 原型没有
约定位置，最要命的是**跟踪文档引用了 gitignored 的 `scratch-*/` 路径——共 25 份跟踪
markdown 文件**。于是已实施记录背后的证据（审查者裁定、验收截图）只在一台机器上看得
见，而 AGENTS.md 本就禁止把 scratch 当工作区。

提案总账以同样的方式漂移：三份提案在 `verified` 上躺过了 7 天期限，四份提案没有总表
行，四行的状态与文件头部不一致，三份头部用了 ASCII 冒号而模板定的是 `：`。
`.agents/notes/README.md` 更是描述了一套本仓从未存在的机制：归档树、skill、校验脚本，
以及四份 `2026-06/07` 的 Agent Note。

## Decision

现在确立四条归置规则。

1. **提案的 HTML 附件有固定归属。** `proposals/` 侧：`proposals/prototypes/<slug>.html`
   （第一个住户是 canvas-space 故事板，从 `scratch-storyboard/` 搬来）。上游提案侧：原型
   与提案文档**同放**在 `docs/upstream-proposals/` 并互指（`reader-prototype.html` ↔
   `2026-09-17-reader-prototype-notes.md`）——这是刻意的共存，不是杂乱。两种情形下 HTML
   都只是可视化附件：决策、验收结果与事实一律写在提案正文里。两条规则都写进了
   [proposals/README.md](../../../../proposals/README.md)。
2. **跟踪文件引用 scratch 必须自证身份。** 证据还在的导入仓库——评审报告进
   `docs/acceptance/`，已实施记录所依赖的截图进 `docs/screenshots/`（`git add -f`，
   AGENTS.md 写明的那个例外）。证据本就不入库的，保留 scratch 路径但标注
   `gitignored, never committed` / 本机 scratch、未入库。证据已被删掉的，改成陈述「当时
   只在本机、已清掉」，而不是继续充当可打开的引用。
3. **总表与文件头部是同一个事实。** 状态变更 = 移动文件 + 改头部 + 改总表行，同一
   commit；盘上每份文件都有行；头部键统一用 `：`。
4. **notes README 自陈漂移。** 归档规格保留（它仍是打算落地的机制），但该节开头写明
   本仓现状：没有 `archived/` 树、没有 `verify-archived-agent-notes.ts`、没有
   `dsh-archive-agent-notes` skill、链接的四份 2026-08 之前的 note 一份都不在，
   `implemented/AGENTS.md` 与 `docs/AGENTS.md` 也不是本仓文件——它们的约束由
   `verify-agent-note-format` 与 `verify-agent-note-classification` 机械执行。
   `scripts/agent-note-tree.ts` 已经认得 `archived/` 目录，所以缺的是树和它的校验脚本，
   不是分类器。

## Alternatives considered

**把归档那节从 notes README 删掉。** 否决：那是一份将来要照着实现的规格，而且分类脚本
已经预留了目录名。错处不在正文，在于它对「尚未存在」保持沉默——所以取规则 4 而非删除。

**scratch 引用原样留着，理由是它们记录了当天的事实。** 否决：已实施记录的价值在于后人
可复核，而一条指向 gitignored 目录的裸路径读起来就是「这儿有东西」。无法复核的地方，
现在明说，而不是装。

**整棵 `scratch-screenshots/` 都导入，好让任何引用都不再失效。** 否决：那是 ~17MB 调试
截图，而本仓跟踪的截图总共 8.2MB，且绝大部分无人引用。最终只进了被跟踪文档点名提到的
十张（~1.1MB）。

**重跑当年的验收、换一批新截图上去。** 否决：2026-09 的截图证明的是 2026-09，不是那份
note 描述的 2026-08-22 构建。

**上游提案的原型也一并挪进 `proposals/prototypes/`。** 查证后否决：原型与提案同目录互指
是本仓既有的约定（约定就写在原型自己的注释里），两条规则一面一棵树。

## Consequences

- 跟踪文档里残留的每个 `scratch-*` 路径现在都明确标注「仅本机」，并发 agent 能自己分清
  「这里没有」和「放错地方」，不必问一句。
- 仓库为此背上 ~1.2MB 证据与一个只装了一个文件的新目录；目录本身就是目的——下一个附件
  有地方落。
- 总账重新可核：42 行，盘上与头部一致。三份关闭提案的 46 处入站链接跨 30 份文件全部
  改指——10 份 Agent Note 的中英两版（sidecar 重记）、两份总表、`docs/roadmap.md`、一份
  评测任务简报、一份同级提案，以及三处源码注释；`proposals/active/…delegation-api…`
  这类路径在仓里已不复存在。
- `docs/roadmap.md` 不再把 member-channel 标成发布卡点；仍然成立的事实直接写明——
  local-agent 家族整体尚未上 npm。
- `proposals/README.en.md` 的总表比中文版少 28 行（它停在 2026-08-28 前后）。本次只同步
  了被移动的那两行的路径与状态，没有补齐行数——那是同步工作，不属于归置问题。
- 相对链接层级是另一笔欠账：全仓扫描跟踪 markdown 有 284 处死链、涉及 161 份文件，其中
  186 处是同一类——note 引用提案时少写一层（在四层深的目录里写 `../../../proposals/…`）。
  这个缺陷早于本次变更，本次既没制造它也没修它；清理是机械活。
- 将来落地归档的人会改规则 4，而不是重新发现这个缺口；本次变更既不实现它，也不阻塞它。
