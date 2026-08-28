# 本地文件浏览器（local-files-browser）

- **分类**: plugin
- **状态**: shipped（已拆分为独立包 `@khorsheed/dsh-local-files`，见下方「更新：拆分为独立包」）
- **最后更新**: 2026-08-26（拆分方向 2026-08-28 更新）
- **查重结果**: 已搜 `proposals/active/` + `.agents/notes/`——「本地文件/文件浏览器/目录树」命中：[file-view-html-rendering](2026-08-21-file-view-html-rendering.md)（worktrees 抽屉里的 HTML 渲染，非浏览器）、[withdraw-file-rollback](2026-08-21-withdraw-file-rollback.md)（git 操作，无关）。**无「浏览任意本地文件系统」的同意图提案**。关联：本包 worktrees（宿主半面、`openExternal` 复用）、[mode-switcher](2026-08-26-mode-switcher.md)（同 profile 无关，仅登记避免入口混淆）。
- **官方依赖**: 纯插件。全部机制基于现有能力：`conversation.view` 槽位（工作区 tab，与 chat/产物平行）、`shell.overlay` 槽位、`conversation.session.header.utilities` 槽位、Typert Remote（独立 `localFiles` 命名空间）、`ctx.workspaces`（workspace 枚举 + 当前 session workspace）、官方 `openExternal`/`canOpenPath` 宿主手势（`ui-file-preview` 同款）。**零 harness 改动**。

## 目标

在 dsh web 里提供一个**与 git 完全无关的本地文件浏览器**：浏览任意 workspace 的实际本地文件系统（含未跟踪、未提交、git 外的文件），只读浏览 + 内容预览 + 打开本地文件夹/IDE。入口是会话头部的 LEFT 胶囊（文件夹图标），独立面板承载（样式继承现有 drawer 设计语言，但交互形态是文件管理器而非 git 改动树）。

**与现有 worktrees 的边界（用户明确澄清）**：仓库文件跟分支走，只看已提交到 git 的文件（现 `repoFiles` = `git ls-files`，保持不动，并入分支侧）；本地文件是本地文件，两者没有关联。

**明确不做**（见「风险/放弃」）：文件编辑（增删改）；git 联动（本地浏览器不感知 git）；非本地文件系统（远程/S3）。

## 现状（已实测 / 源码核实的事实）

- 现有 badge（`packages/worktrees/src/client/Badge.tsx`）：两个胶囊——LEFT（`IconFolderOpenOutline16` + repo 名）点击开 `repo` 模式（仓库文件，`git ls-files` tracked-only）；RIGHT（`IconBranchOutline16` + 分支名 + `+N −M` 计数）点击开 `worktree` 模式（改动）。`data === null || !data.isRepo` 时整个 badge 不渲染。
- 现有 drawer（`Drawer.tsx`）：`shell.overlay` 单实例，三个 mode tab（worktree / commits / repo），`WorktreesController` 持有根 store。
- `readFile(cwd, path)` 现实现为 `join(repo, path)`——**只在 git repo 内**，本地浏览器不能复用（要浏览任意绝对路径）。
- `openExternal(path)` / `canOpenPath` 宿主手势已在 `WorktreesDrawer` 接线（`isLoopback && hostDescription.canOpenPath`），可复用。
- `ctx.workspaces` 是官方 client 服务（`sessions`/`workspaces` 已 inject），可枚举 workspace 并取当前 session 的 cwd。
- localStorage 持久化先例：drawer 宽度（`dsh-worktrees-drawer-w`）、树列宽（`dsh-worktrees-tree-w`）——记住上次目录沿用同款。

## 方案

**形态**: 拆分为独立包 `@khorsheed/dsh-local-files`（host 数据面 `listLocalDirectory`/`readLocalFile`/`readLocalImage` + client 工作区 tab），不再并入 worktrees。worktrees 只保留纯 git 徽标。零官方改动。详见下方「更新：拆分为独立包」。

### 1) 双胶囊拆分（badge）

| 胶囊 | 现在 | 改成 |
|---|---|---|
| LEFT（文件夹图标） | repo 模式（仓库文件） | **本地文件浏览器**（独立面板），**常显**（非 repo 会话也显示——本地浏览器与 git 无关） |
| RIGHT（分支图标 + 计数） | worktree 模式（改动） | 保留现状；drawer 里的「仓库文件」tab 并入分支侧（跟分支走，`git ls-files`） |

- LEFT 胶囊不再要求 `isRepo`：非 repo 会话显示「文件夹 + 本地文件」入口（点击直接开浏览器，起步于当前 workspace）；repo 会话同时显示两个胶囊。
- badge 结构：LEFT 常显；RIGHT 仅 repo 会话显示。

### 2) 本地文件浏览器（独立 overlay）

- **注册**：`shell.overlay` 再注册一个条目 `worktrees-local-files`（独立于现有 `worktrees-drawer` 实例）——用户明确要求「样式继承但不在同一个抽屉里，两者交互模式应该有差别」。
- **布局**（用户选定）：顶部路径栏（当前绝对路径 + 面包屑，可编辑跳转）+ 左侧目录树 + 右侧内容预览（复用现有 `DetailPane`/内容查看的样式语言）。
- **浏览范围**：默认进入当前 session 的 workspace 根；可在路径栏编辑/跨目录浏览任意本地路径（含隐藏/忽略/未跟踪文件，纯文件系统视图）。
- **workspace 切换器**：面板顶部可切换 workspace（枚举 `ctx.workspaces`），当前 session workspace 为默认；切换后浏览根随之改变。
- **能力**：只读浏览 + 内容预览（文本/已知类型；二进制/超大文件给出占位）+ 「在文件夹中显示 / 在 IDE 打开」（复用 `openExternal`，loopback + `canOpenPath` 门控）。
- **记住上次目录**：localStorage 存上次浏览的绝对路径（key 如 `dsh-worktrees-local-files-root`），下次打开回到那里而非重置回 workspace 根；目录失效（不存在/不可读）时回退 workspace 根。

### 3) 宿主数据面（service + Remote）

新增两个方法（`src/service.ts` + `src/remote.ts`，wire 命名空间沿用 `worktrees`）：

- `listDirectory(agent, { path })` → `{ path, parent, entries: [{ name, isDir, size?, mtime? }] }`：读任意本地目录（`node:fs/promises` `readdir` + `stat`，失败 fail-closed 返回错误）。路径校验：必须是绝对路径、拒绝 `..` 逃逸/畸形路径、目标必须存在且是目录。
- `readLocalFile(agent, { path })` → `{ content, truncated?, isText? }`：读任意本地文件预览（带大小上限，二进制探测，超限截断/占位）。

> 安全边界：浏览器经 loopback 连宿主，本地浏览器数据面接受**任意绝对路径**——与 `openExternal` 同属「用户在自己的机器上操作文件系统」的信任模型（file-preview 先例），但实现上做严格校验（绝对路径、禁 `..`、存在性、目录/文件类型匹配）。

### 4) 客户端（store + contract + locales）

- 独立 store（或复用现有 store 扩展 `localRoot`/`localEntries`/`localPreview` 状态），独立 `WorktreesLocalFilesDrawer` 组件。
- `contract.ts` 扩展 injected face：`listDirectory` / `readLocalFile` / `listWorkspaces` / `currentWorkspace`。
- locales 新增本地浏览器文案（zh/en 成对）：面板标题、路径栏占位、空目录、二进制/超大占位等。

## 里程碑

按「最小闭环 → 验证 → 铺满」推进（遵守 `AGENTS.md` 构建/安装/验证纪律）。

- **M1 — 数据面 + 最小面板**：host `listDirectory`/`readLocalFile` + Remote + 单测；独立 overlay 骨架（路径栏 + 目录树 + 预览占位），LEFT 胶囊接入。验证：`dsh plugin add` 装上、浏览器打开能看到本地目录树、console 零错。
- **M2 — 完整交互**：workspace 切换器、面包屑/路径跳转、内容预览（文本/二进制/超大）、打开本地文件夹/IDE 动作、记住上次目录。验证：浏览器实测全流程，localStorage 持久化生效。
- **M3 — badge 双胶囊收尾**：LEFT 常显（非 repo 会话也显示）、RIGHT 仅 repo 显示、「仓库文件」tab 确认并入分支侧语义（`git ls-files` 已是 tracked-only，无需改数据面）。验证：非 repo 会话 badge 仍可用本地浏览器。

> 每条进入宿主修改 / 可能重启实例的批次，先 `checkpoint` → `build` → 测试 → `record build+test` → `verify` → `schedule-exit`。

## 实现记录

（随实施追加：Agent Note / PR / 包名。）

## 验收标准（done 判定，绑定可插拔交付）

- `dsh plugin add` 装上、`remove` 卸下，**零官方改动**（`check:plugins` 0 findings、`check:hygiene` 通过）。
- LEFT 胶囊（常显）打开本地文件浏览器：目录树 + 内容预览 + 顶部路径栏；可在任意本地路径跨目录浏览。
- workspace 切换器枚举所有 workspace，当前 session workspace 为默认；切换后浏览根随之改变。
- 只读浏览 + 内容预览（文本/二进制/超大均有明确呈现）；「在文件夹中显示 / 在 IDE 打开」在 loopback + `canOpenPath` 下可用。
- 记住上次目录：关闭浏览器再打开回到上次位置；目录失效回退 workspace 根。
- 非 repo 会话：LEFT 胶囊仍显示、本地浏览器可用；repo 会话双胶囊并存，RIGHT 行为不变。
- 仓库文件语义不变（跟分支走，`git ls-files` tracked-only）。

## 风险 / 放弃的东西

- **任意路径安全**：浏览器→宿主任意绝对路径读取。信任模型同 file-preview（用户本机操作），但严格校验（绝对路径、禁 `..`、存在性、类型匹配）；写入面（新建/重命名/删除）**明确不做**，把风险面压到只读。
- **超大/二进制文件**：预览截断 + 二进制探测 + 占位，不整读进内存。
- **非 repo 会话的 badge 语义**：LEFT 常显会让 badge 出现在原本不渲染的会话——这是刻意的（本地浏览器与 git 无关），但需确认不干扰其他插件对 header 槽位的布局（`order` 调优）。
- **放弃**：文件编辑（增删改）；git 联动（本地浏览器不感知 git）；远程文件系统；把本地浏览器并进现有 drawer 的 tab（用户明确要求独立面板 + 差异交互）。

## 更新：拆分为独立包（2026-08-28 shipped）

用户后续明确：本地文件浏览器**不并入 worktrees**，而是拆成**独立插件 + 独立工作区 tab**。落地为：

- **新包 `@khorsheed/dsh-local-files`**：host 数据面（`listLocalDirectory` / `readLocalFile` / `readLocalImage`，独立 `localFiles` typert 命名空间，纯 `@Remote` 无 agent 参数）+ client 工作区 tab（`conversation.view` 列表项 `id: local-files`，与 chat/产物平行）。浏览任意绝对本地路径，git 无关。内容预览组件（HTML/Markdown/JSON/CSV/图片）从 worktrees 复制进包内（自包含，不跨包依赖；共享预览层抽提是后续可能的优化，不在本批次）。
- **worktrees 只留纯 git 徽标**：删除 `LocalFilesDrawer`/`store-local`/`local-root`，badge 去掉本地文件胶囊，`service.ts`/`remote.ts` 去掉本地文件方法（保留 git 的 `readRepoImage`）。
- **file-preview 不动**（产物 tab）。语义边界：file-preview = 当前会话产物；local-files = 任意本地目录浏览。二者不同，故独立成两个包。
- 会话工作区不可在会话内切换（dsh session cwd 创建后不可变），故**不提供切换按钮**；工作区 tab 默认进入当前会话 workspace 内容。

详见 Agent Note：[.agents/notes/implemented/feature/2026-08-28-local-files-standalone-plugin.md](../.agents/notes/implemented/feature/2026-08-28-local-files-standalone-plugin.md)。
