# Agent Note: 图书馆项目资源——架子上的轻链接条目（project-paths M1）

Status: implemented

## Problem

图书馆过去只收登记的书：为了指给学习者一篇文章、一个仓库，就要联网核对一整份目录。project-paths 提案（`proposals/active/2026-10-13-library-project-paths.md`）回答的场景——「从 0 到 1 教我 LLM + 具身智能」——没有一本教材：材料是仓库、仿真平台、教程、硬件。这些需要的是架子上的一个条目，不是一本书。

## Decision

resource 是项目架子上的轻链接条目，与书并列：`{ id, title, url, kind: article|video|repo|tool|course|hardware, note?, addedBy: coach|learner, createdAt }`——无目录、无路线、不进出题轴（教练按**章节**引用的仍然登记成书）。同一项目内同一 url 只收一条。

- **store**（`packages/library/src/store.ts`）：`projects/<id>/resources.jsonl`，添加即追加；删除重写整个文件去掉该行——resource 没有状态机，没有墓碑可留（对比卡片的 `deleted`）。`normalizeResource` 要求 id/title/url 齐备，漂移的 kind 默认落 `article`、addedBy 默认落 `coach`（normalizeBook 先例），新版本写入的行旧构建也读得出。
- **service**（`service.ts`）：`addResource` / `removeResource` / `listResources`，沿用 assertAlive + readProjectOrRefusal + mutate 形状。add 校验 url（`^https?://`）、kind 枚举、非空标题，同 url 重复拒为 `exists`（拒收信息教「先删再加」）。添加落账 `resource.added`，只带条目 id——`LibraryEvent` 现有字段够用，行的 `at` 正是侧栏 latestActivity 轮询刷新所需。
- **remote**（`remote.ts`）：`library` 命名空间下三个 verb，一行转发。
- **工具**（`tool-definition.ts`）：`library_read · resources` 列出架子；`library_write · resource` 带 `op: add|remove`（add：`{ title, url, kind, note? }`，addedBy 默认 coach；remove：`{ id }`）。拒收信息继续自带正确用法。
- **侧栏**（`client/views/home.tsx`）：项目页书架下方新增「资源 · N」区——紧凑行（kind 图标块、标题经 window.open 打开 url、一行 note）、空态，加号拆成 加书 / 加链接（头部第二个动作 + 区块自己的按钮）。加链接与加书同法填会话输入框：学习者粘贴 url，教练联网打开并补标题 / kind / note。

## Alternatives considered

- **什么都登记成书**：提案已否决——仓库、机械臂套件没有目录可核对；登记的分量（联网核对目录）对整体参考买不到任何东西。
- **resource 带已读/未读状态机**：M1 刻意只做账本，不做第二条出题轴；路线节点引用 resource 是 M2 的 covers。
- **getProject 返回 resources**：否决——项目摘要保持廉价；资源区读自己的 verb，与 pages / cards 相同。
- **侧栏删除手势**：删除留在会话里由教练执行，侧栏只消费 `listResources`，不提供删除入口。

## Consequences

- 项目现在能装下无教材场景的材料；书继续独占章节级引用。
- `resources.jsonl` 加入项目目录；无需迁移（文件缺席即空架）。
- `resource.added` 增量扩展事件词表；旧构建读新账本时跳过未知类型（normalizeEvent 丢弃）。

## Testing

`store.spec.ts`（追加 / 读回 / 删除、坏行容忍、normalize 下限）、`service.spec.ts`（url / kind / title 校验、重复拒收、事件落账、not-found）、`tool.spec.ts`（绑定会话的往返、载荷教学错误、更新后的 what 列表断言）、`capabilities-dispose.spec.ts`（三个 verb 加入 dispose 枚举）。`pnpm --filter @khorsheed/dsh-library build && test` 绿；`pnpm check:panels --package packages/library` 干净。
