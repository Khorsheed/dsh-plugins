# Agent Note: 图书馆 v5 —— 六层模型（Resource 合并、单轨路线、单 gate、统一 cover、Assessment 实体）

Status: implemented

## 问题

v3/v4 两条线攒出了双轨结构，而实盘错误率指向概念本身而非传输形状：书和资源是两个实体、两套规则（谁能被 cover、谁能挂路线、谁能被考）；路线住两个作用域（书级、项目级），还要一条镜像校验把它们隔开；节点的 `kind` 要组合另外三个字段才说得出怎么算完成；cover 是四元联合；practice 站的验收根本没有实体——attempt 挂的是节点本身，重排路线改一句验收文案，这站的历史就孤儿化了。模型（和维护者）在为每一对冗余买单。

## 决定

按提案（[proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)）把存储布局和所有面一次改完：

- **书就是资源**。`LibraryResource.kind` 增加 `'book'`（`'course'` 也能带 toc）；`toc` 是厚薄开关——有目录的资源可建路线、按章节被 cover、可考、可拍照，薄链接只能整体进路线。书的字段（bookKind、extras、short、author、edition、isbn）住进 `meta`。`LibraryBook` 类型删除。
- **每个作用域一条路线**，键为 `primaryResourceId?`（空 = 项目自己的路线）。存 `roadmaps/<key>.json`——不再有 `books/<b>/roadmap.json` 与项目根 `roadmap.json` 的双轨。已由 [library-book-paths](2026-10-19-library-book-paths.md) 取代：路线只属于教材，项目不带路线（只有 `roadmaps/<resourceId>.json`）。
- **节点的 `gate`**（`quiz | acceptance | read`）一个字段说完怎么完成；旧的 `kind` × `acceptance` × 侧站组合校验收进它。
- **cover 统一一个形状**：`{ ref, locator? }`，ref 自描述——书架 id、裸 url、或 `topic:…`；locator 数目录行（"1-5,7"）。工具层另收字符串简写（`"r_…#1-5"`），`normalizeCoverArg` 照读全部 v3/v4 联合成员。
- **Assessment 成为实体**（`assessments/<id>.json`）：`type: "quiz"` 带题；`type: "practice"` 带验收站物化的 rubric。采用路线时物化每个验收站的 rubric——内容没变就复用现有 assessment（attempt 留在原地），变了就 supersede 旧的。节点的新卷子 supersede 该站的现役卷。**attempt 只认 `assessmentId`**（verdict 的 `task` 是题目 id 或 rubric 行 id）。
- 外键随合并改名：pages、cards（含 contexts）、bindings、events 的 `bookId` → `resourceId`。

**读旧写新，无离线迁移。** 每个 normalize* 都读旧形状（`books/<id>/book.json`、`resources.jsonl` 行、`quizzes/<id>.json`、节点 `kind`、cover 联合、attempt 的 `quizId`/`nodeId` 键），每个写动作只落 v5 布局；旧文件原地保留，回滚不丢东西。`LIBRARY_STATE_VERSION` 为 5；索引读 v2–v5。v2 的 `migrateState` 不动。

工具面随模型折叠：`library_book` 没了——`library_resource` 覆盖两个分支（厚：kind book/course + toc；薄：title + url），`from: { project, resource }` 支持跨项目克隆注册。每个作用域参数都叫 `resource`（`book` 拼写在非类型化面仍可解析）；节点字段叫 `gate`（`kind: "practice"` 仍解析）；工具现在十个。

## 已否决方案

- **离线迁移把所有文件重写成 v5 布局**：否决——提案的规则是读旧写新、零停机；每个 normalize* 已读旧形状，旧文件原地保留让回滚无损。
- **NodeRef 独立成表**（用户初稿）：提案讨论中否决——路线图本来就整路单文件一次读入，每个 cover 多一次 join 是纯损失。
- **Resource 全局 workspace 化 + 项目关联表**：暂缓——所有读路径多一层 join，只换"每项目重复验目"一个痛点；`from` 克隆注册更轻。
- **保留 `library_book` 与 `library_resource` 并存**：否决——一个实体两条写路径正是本刀要拆的双轨冗余；模型记住的 `book` 拼写在参数层仍可解析。

## UI —— 一种站页，四个 tab

节点页不再按 gate 分形：每个站都有 导读 / 我的记录 / 讲义 / 章节考。章节考 tab 读本站的 Assessment——quiz/read 站是考卷（现役卷 + superseded 历史 + 同作用域的书级/自由卷），验收站是验收单（恢复：带稳定行 id 的标准、机检 ref 行直开引用卷、提交验收进会话的手势、历史记录）。这撤掉了 `050039be` 里 practice 站无章节考的状态——统一的 gate tab 正是提案的设计（客户端还变简单：一条读取路径）。

## 后果

- **实体 id**：新资源 mint `r_…`（存量 `b_…` / `res_…` 继续可用——判别靠查书架，从不靠前缀）；assessment mint `q_…`（practice 的也一样）。v5 前的 attempt 保留旧 `nodeId` 键作为读兼容字段；`listAttempts(nodeId)` 同时 join 节点的 assessment 和旧键。
- **Remote 面随模型改名**（`getResource`/`putResource`/`removeResource`、`listAssessments`/`getAssessment`、到处是 `resourceId`）——客户端与宿主一起发布，线上不留别名窗口。
- 畸形 cover ref（无 scheme 的 url 之类）现在在形状闸拿教学拒绝，不再穿透成 store 层断言（shelf 查询前 `isLibraryId` 兜底）。
- 验收站的历史在首次采用/判分时落到物化 assessment 上；v5 前的 attempt 仍挂其节点，照常列出。
- read 站的章节考 tab 给书级/自由卷和出题入口——read 站挂站级卷仍在写闸被拒（没有可 gate 的东西）。

## 测试

142/142 绿。store.spec.ts 用手写 v3 布局经 v5 store 读回来钉住迁移契约（旧书、带撕裂行的薄链接账本、带 `kind: "practice"` 和 cover 联合的路线图、带 `scope.bookId` 的卷子），外加写新遮蔽规则。service.spec.ts 和 tool.spec.ts 整体迁到新面，保留 v4 拼写别名测试（`book` 参数、`bookId`、`kind: "practice"`、`what: "books"`），新增 cover 字符串简写测试。`check:panels` 干净。
