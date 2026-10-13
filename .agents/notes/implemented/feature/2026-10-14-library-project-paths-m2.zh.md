# Agent Note: 图书馆项目级路线——covers 混合引用、practice 动手站、引用级证据闸（project-paths M2，state v3）

Status: implemented

## Problem

此前的图书馆路线只能挂在一本书上：`chapterRanges` 数它的目录行，出题证据闸也是书级规则（材料型书不收凭记忆的内容题）。project-paths 提案（`proposals/active/2026-10-13-library-project-paths.md`）回答的是「没有一本教材」的场景：项目级路线，每一站混合取材——某书的若干章、架子上的资源、一条裸链接、或纯教练讲授——外加动手站（按验收标准过关，不出选择题）。3080 上有真实的 v2 数据（书级路线、卡片、考卷），所以形状变更需要一次真实迁移，而不是把旧根读成空。

## Decision

state v3（`packages/library/src/types.ts`）：`RoadmapNode.chapterRanges` 废除，换成 `covers: LibraryNodeCover[]`——`{ kind: 'book', bookId, ranges } | { kind: 'resource', resourceId } | { kind: 'url', url, title? } | { kind: 'topic', text }`，每条可带 provenance（`by: web|model|user`、`verifiedAt`）。`LibraryRoadmap.bookId` 变可选：缺席 = 项目自己的路线（`projects/<id>/roadmap.json`）；书级路线是特例，其每个节点只覆盖那一本书（起草时强制）。节点 kind 加 `'practice'`，带 `acceptance: string[]`（practice 必填、其他 kind 禁带）。`LibraryQuiz.scope.bookId` 变可选（缺席 + nodeId = 项目路线的站；都缺席 = 自由练习考）。`LibraryAttempt` 的 `quizId?` / `nodeId?` 二选一。

- **迁移**（`store.ts` `migrateState`）：v2 索引可读（`normalizeLibraryIndex` 接受 2 与 3；`normalizeRoadmap` 把旧节点的 `chapterRanges` 现场包成那一条 book cover），插件 `apply` 触发 `migrateState()`——在索引锁下逐项目（项目锁）重写每个 `books/<bid>/roadmap.json` / `roadmap.draft.json`（按原始 JSON 改节点：`chapterRanges` → `covers`，其余字节原样），最后写版本号。幂等、崩溃安全（版本号最后落）、v1 不动（仍读作空）。
- **动词**：`getRoadmap` / `draftRoadmap` / `adoptRoadmap` / `discardDraft` / `markNodeRead` 的 `bookId` 全部可选（缺席 = 项目级）。`validateRoadmapShape` 泛化：covers 必须可解析（书存在且 ranges 在目录内、资源在架子上、url 合法、topic 非空）、practice 必须有 acceptance、quiz/practice 依旧不得依赖 read 节点。
- **证据闸**（`putQuiz`）：scope 指到节点时按节点 covers 判定——只有知识型书 / 讲授允许凭记忆出内容题；含材料型书 / 资源 / url 必须逐字引用（`coversVerbatimBlocker`）。scope 只有 bookId 时旧规则逐字节不变；自由练习考允许 knowledge。photo 证据的页池：scope 书的页面、否则节点覆盖的书、否则全项目。
- **practice 验收**（`putAttempt`）：请求在 `quizId` / `nodeId` 中恰取其一。node 路径把每条 `verdict.criterion` 逐字对照该站 acceptance 行，ratio 沿用同一公式（部分过按 passRatio 线——提案的默认拍板），`missedCard` 建卡或加重，级联复用（完成 → `unlockReady` → 事件）。不落 quiz 实体；attempt 账本行带 `nodeId`。
- **读面**：`listAttempts({ projectId, nodeId? })`（新在前）供验收 tab 的历史。`bindingSummary` 在绑定不带书时注入项目路线的当前站，教练每轮都看得见。
- **工具**：`library_write · roadmap` 节点带 `covers`；`book` 缺省取绑定的书，`book: null` 表示项目路线；`chapterRanges` 作为书级特例的语法糖保留（包成那条唯一的 book cover）。`library_assess` 收 `node`（站挂在书级路线时加 `book`）。工具描述与 prompt 段都教 provenance 纪律。
- **侧栏**：项目页顶部加路线卡（已采用：逐站的状态点、kind 签、covers 摘要，点进节点页；草稿：共用 DraftCard，节点行带 covers 摘要与 provenance 徽章）。NodeView 通吃两种 scope：头部下的 covers 芯片行、「我的记录」仅当节点覆盖了书（多本时先选书）、第三 tab 按 kind（quiz → 章节考，带「凭什么」政策卡——按 covers 构成的客户端镜像判定；practice → 验收：标准清单 + 提交填会话 + 历史；read → 无）。

## Alternatives considered

- **硬切换（v2 根在迁移前读作空）**：否决——只读部署下数据会永远消失；容忍读 + 幂等重写兼得正确与落盘诚实。
- **practice attempt 伪造一个 quiz 实体（保住 quizId 必填）**：否决——假 quiz 会污染 listQuizzes 和节点的章节考 tab；attempt 上加可选 `nodeId` 是更小的妥协（两键恰一，由 normalizeAttempt 钉住）。
- **practice verdict 移动既有卡片**（教练点名的卡片升降格）：verdict 形状不带 cardIds，所以通过不动卡、失败只对 `missedCard` 建卡——这正是验收流实际知道的信息。
- **卡片来源加 practice 类型**：`LibraryCardSourceType` 保持四类；验收失误记作 `quiz`（「我答错的」过滤器本就表示「在关卡上没过」）。

## Consequences

- 项目可以端到端跑一门没有教材的课；书保留自己的页面（照片仍挂书）和自己的路线（两条路线共存，各算各账）。
- 旧书流程对学习者是逐字节不变的：同样的工具调用（chapterRanges 语法糖）、同样的闸门判定、同样的级联。
- 3080 上的 dsh-library 状态在这版首次启动时迁移；迁移落地前，每条读路径都现场包装 v2 节点。

## Testing

`store.spec.ts`（+5）：项目根路线往返、normalizeNodeCover、v2 夹具（已采用 + 草稿 + 卡片 + 考卷）无损迁移、幂等、v1/新根不动。`service.spec.ts`（+13）：无 bookId 的路线动词、covers 校验、书级特例、covers 驱动的闸门（材料型 / 纯知识 / url / 自由考 / 书级节点回归）、practice 验收（逐字 criterion、2/3 不过线后 5/6 过线、missedCard、历史、事件）、纯项目绑定的 bindingSummary。`tool.spec.ts`（+2）：`book: null` 的项目草稿、chapterRanges 语法糖、按 node 的 assess。全部既有测试行为不变地通过（夹具机械改写为 covers）。`pnpm --filter @khorsheed/dsh-library build && test` 绿；`pnpm check:panels --package packages/library` 干净。
