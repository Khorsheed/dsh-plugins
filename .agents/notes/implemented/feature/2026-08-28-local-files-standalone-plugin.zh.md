# Agent Note：local-files 浏览器从 worktrees 拆分为独立插件 + 工作区 tab

Status: implemented

English | [中文](../feature/2026-08-28-local-files-standalone-plugin.md)

本条记录把 **local-files 浏览器**从 `@khorsheed/dsh-worktrees` 拆分到独立包 `@khorsheed/dsh-local-files` 的决定。对应 [local-files-browser 提案](../../../../proposals/active/2026-08-26-local-files-browser.md)——原方案把浏览器留在 worktrees 内，用户后续选了不同形态。

## 问题

早前迭代已把本地文件浏览器**混在 worktrees 插件内部**：会话头部徽标的左胶囊（文件夹图标）点击打开 `worktrees-local-files` overlay 浏览任意本地路径。它工作正常，但把两个语义不同的能力塞进同一个包：

- **worktrees = git 事实**：分支、ahead/behind、diff 行数、提交、仓库内相对文件。
- **local-files = 文件系统浏览**：任意绝对路径、未跟踪/被 ignore/仓库外文件、纯内容预览。

仓库约定是「一个包=一个能力」（`@khorsheed/dsh-*`），worktrees 长成了同时承载二者的样子。另外，用户希望该浏览器的内容预览实现（HTML/Markdown/JSON/CSV/图片）能被 file-preview 复用——只有当代码独立成包、而非埋在 git 插件里时这件事才干净。

## 决定

**1. local-files 独立成包 `@khorsheed/dsh-local-files`。** 新的 host 数据面 + client 工作区 tab：

- **Host**：`LocalFilesService`（`listLocalDirectory` / `readLocalFile` / `readLocalImage`）和 `LocalFilesRemoteService`，以纯 `@Remote` 方法暴露在新的 `localFiles` typert 命名空间下——**全局、无 agent 参数**（无会话文件系统调用，镜像 file-preview 数据面）。路径校验 `assertSafeLocalPath`（仅绝对路径、禁 `..` 逃逸）——file-preview 信任模型（用户本机），只读。
- **Client**：`conversation.view` 列表项 `id: local-files`，order 25，与 chat/产物平行。视图为左侧懒加载文件树 + 右侧 `DetailPane`/`ImagePreview`。

**2. 浏览器以工作区 tab 呈现，不是徽标胶囊。** 用户最终形态是**与产物 tab 平行的独立 tab**（file-preview），不是头部胶囊。徽标保持纯 git（分支 + 计数）；浏览器进视图环。用户明确 local-files 必须保持**干净的独立插件**、不并入 file-preview，因为语义不同：file-preview = 当前会话产物；local-files = 浏览任意本地目录。

**3. worktrees 收窄为纯 git。** 删除 `LocalFilesDrawer.tsx`/`store-local.ts`/`local-root.ts`；`service.ts`/`remote.ts` 去掉本地文件方法（保留 git 的 `readRepoImage`/`LocalImageResult`）；徽标去掉文件夹胶囊；`panel-service.ts` 去掉 `attachLocalFiles`/`#localFiles`；过时的本地文件测试移入新包。

**4. 内容预览组件先复制、未共享。** `language.ts`/`html-src-doc.ts`/`structured.tsx`/`HtmlPreview`/`ImagePreview`/`FileTree`/`DetailPane` 迁入 local-files 并做成 git 无关（去掉 changed-file/diff/detail-view 机制）。共享预览层抽提是可能的后续优化，本批次刻意不做——每个包保持自包含、无跨包依赖（仓库默认）。

**5. 会话内不做 workspace 切换器。** dsh 在创建时绑定会话 cwd，之后不可改（`SessionCwdConflict`）；`insertSessionBefore` 只做记账再分组、不动 cwd。所以「切换工作区」按钮在没有 host 改动时不可能，用户接受（"先不提供切换按钮"）。工作区 tab 因此只开当前会话工作区内容与产物文件；按会话记住根目录（`dsh-local-files-root:<sessionId>`）让每个会话回到自己上次浏览的位置。

## 备选

- **留在 worktrees 内（早前已交付的迭代）。** 拒绝：违反一包一能力，worktrees 是 git 插件，放进文件浏览器是用户要纠正的语义错配。
- **并入 file-preview 作为产物 tab。** 用户拒绝：file-preview 是会话产物；local-files 浏览任意目录。语义不同，故两个独立包。
- **现在就抽共享预览层。** 推迟：它新增跨包契约与依赖，而本批次目标是拆分本身。内容组件先复制（自包含），后续再抽。

## 后果

- `pnpm check:plugins` 保持 0 findings；`check:hygiene` 与 `verify-translation-pairing` 通过；新包经共享 `clientBundle` tsdown 预设同时产出 `lib/index.js` 与 `lib/client.js`。
- local-files 测试现位于 `packages/local-files/tests/service.spec.ts`（已从 worktrees 移除——其 service 不再有这些方法）。
- 组合出的 profile 需同时加载 `@khorsheed/dsh-local-files`（工作区 tab）与收窄后的 worktrees（git 徽标）才有完整体验；单独 worktrees 现在是纯 git。
- 部署：3080 上当前线上版 worktrees 内嵌的本地文件浏览器由本拆分替换。
