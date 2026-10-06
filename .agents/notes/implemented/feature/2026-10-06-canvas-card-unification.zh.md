# Agent Note：卡片只有一套工具——canvas_read / canvas_write 加体裁钩子，novel_* 只留小说独有的部分

Status: implemented

接续[写作预设合一](2026-10-06-writing-preset-fold.zh.md)，那次合并后留下了两个写卡工具。用户问 `canvas_write` 和 `novel_write` 会不会一直打架，并且认为直接调用 `canvas_write` 比另起一套写卡工具更合适。已获同意：卡片统一走画布工具；在小说画布上，成稿指向章节流程。

## Problem

- 在「长篇小说」画布上，模型有两个写卡工具。`canvas_write op=card` 会被拒绝并提示改用 novel_write（体裁的 `agentCardTool`），`novel_write(what=card)` 则把卡直接落成正式卡。
- 模型先学会的是画布工具（canvas 技能、写作 persona），所以在小说画布上，第一次写卡总是被拒、再重试。
- `novel_read` 有自己的 `cards` / `card` 读取，`novel_write(review)` 有自己的归档，小说技能还为同一批卡教了另一套说法（role、id）。

## Decision

**画布（`@khorsheed/dsh-canvas`）**

- `CanvasGenreDefinition.agentCardTool` 换成可选的 `agent` 钩子（`CanvasGenreAgent`）：
  - `cardLines`、`cardDetail`、`writeCard`、`resolveCard`；
  - 可选的 `manuscripts`、`manuscriptGuide`。
- 会话参数用结构类型 `object`。在 `types.ts` 里引入宿主的 `Session` 会让客户端 tsc 报错。
- **`canvas_read`**
  - 在挂了钩子的体裁画布上，带 role 的分类由体裁来列，其余分类照通用方式列。
  - 新增 `cardId`，读一张卡的全文：有体裁详情用体裁的，否则用通用渲染。
  - `kind` 也接受分类的显示名。
  - 体裁自管成稿时，成稿一栏换成体裁的列表。
- **`canvas_write op=card`**
  - 先问体裁。返回 `undefined` 表示「不归我管」，于是走通用的提议路径。
  - 带 `cardId` 和 fields 时修改体裁卡。普通卡上则回答「这张卡由用户来改」，请模型改用留言或另提一张。
- **新增 `op=archive`**：用画布自己的状态归档（`patchCard` archived）。`#12` 这类编号由体裁解析成卡 id。评论的卡片解析也走体裁。
- **`op=manuscript`**：体裁自管成稿时，不写成稿，返回体裁的指引。

**小说（`@khorsheed/dsh-canvas-novel`）**

- 新建 `src/genre-agent.ts`，导出 `novelGenreAgent(store)`。原来在 `tools.ts` 里的卡片辅助函数挪到这里。
  - 每个钩子都先给新卡补上编号。
  - `kind` 先按分类 id、再按名称对应到 role。
  - 新卡直接生效，回答里带编号和 ✦ 标记。
  - 同名卡会被拒绝，并指向 `canvas_write(op=card, cardId=编号, …)`。
  - 找不到的编号会被拒绝；但如果它是角色分类以外的一张真实卡，就交还给画布处理。
  - `manuscripts` 返回「章节（N 章，按顺序）」，按 seq 排序。
- `index.ts` 注册 `{ ...NOVEL_GENRE, agent: novelGenreAgent(store) }`。
- 工具收窄为：
  - `novel_read`：brief、chapters、ledger、pending、chapter；
  - `novel_write`：chapter，以及只处理待审项的 review（`id`、`action` = accept|discard）；
  - `novel_extract`：不变。
- `ReviewAction` 去掉 `archive`。`NovelService.archiveCard` 已经没有调用方，删除。
- 以下文案改为指向画布工具：技能、指引段、brief 里关系太多时的提示、对账报告、README、写作预设的 persona 与注释。

**章节顺序**：`novel_write(what=chapter)` 新建章节时编号取已有最大值加一，章节列表和 `canvas_read` 的成稿一栏都按 seq 排序。模型从两个工具看到的都是按顺序排好的章节。

## Alternatives considered

- **保留 `novel_write(card)`，让 `canvas_write` 转给它。** 不采纳：同一件事仍然有两个工具，技能里也仍有两套说法。
- **去掉小说卡的特殊行为（编号、直接生效、查重名），改用通用提议。** 不采纳：brief 和台账都依赖「直接生效」和编号。
- **在小说画布上让 `op=manuscript` 写章节。** 不采纳：写章节需要已确认的计划和走围栏的落盘，这些 `novel_write(chapter)` 已经做了。画布的回答改为指向它。

## Consequences

- 所有画布共用一套卡片说法。体裁包要定制卡片行为，就实现钩子，不再另加工具。
- 小说卡的行为只能通过画布工具使用。凡是授予了小说工具的地方，也必须授予画布的 `./agent` 行（写作预设两行都带）。
- **测试**：
  - 画布 `tools.spec`：普通卡拒绝修改、`cardId` 读取、归档、归档不存在的卡、带钩子的假体裁、`kind` 按名称读。
  - canvas-novel：新增 `genre-agent.spec`，覆盖直接落卡、按编号修改、同名拒绝、用 `patchCard` 归档、非角色分类交还画布、卡片列表与详情、章节顺序、普通画布。`tools.spec` 断言收窄后的枚举。store 与 import 两个 spec 改为通过假画布归档。
