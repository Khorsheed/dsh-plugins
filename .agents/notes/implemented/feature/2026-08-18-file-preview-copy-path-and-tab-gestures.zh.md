# Agent Note：文件预览的复制路径与 tab 宿主手势

Status: implemented

[English](2026-08-18-file-preview-copy-path-and-tab-gestures.md) | 中文

## 问题

[文件预览各表面](2026-08-14-file-preview-side-drawer.md)只以紧凑的相对路径行展示文件（文件名 + 目录 + 轮次/步骤），想拿到真实路径粘到终端或其他应用里，得去会话日志里翻。抽屉头部已有"在文件夹中打开"/"在 IDE 打开"，但"产物"tab——列表更宽裕的浏览表面——完全没有路径动词，从 tab 直接打开或定位文件根本做不到，只能先回对话里点一遍。

## 决策

新增一个手势 **复制路径**，两个表面都加；同时把抽屉的两个宿主打开手势搬上 tab。

**复制路径** 是浏览器剪贴板动作：apply 闭包用与打开手势相同的 `resolveWorkspacePath(cwd, path)` 拼写，把记录的展示路径按所属会话的 cwd 解析成宿主可用的绝对路径，再用 ui-primitives 的 `writeClipboard` 写入（异步 Clipboard API，`execCommand('copy')` 兜底；只在宿主接受写入时 resolve `true`）。两个表面都通过注入的 `copyPath: (path) => Promise<boolean>` 动词拿到它——与 `openExternal`/`revealFolder` 相同的 inject-face 模式——cwd 解析留在同一处，组件测试只需一个普通 mock。共享的 `useCopyPathFeedback` hook（插件本地实现；primitives 的 `useCopyFeedback` 只写死字符串、无法解析 cwd）负责瞬时反馈：写入成功把按钮切成对勾图标 + "已复制/Copied" 标签一秒；被拒绝的写入绝不显示成功；选择变化时标志复位。复制**永不设门禁**——剪贴板写入任何浏览器环境都可用——而文件夹/IDE 按钮仍留在原有的 loopback + `canOpenPath` 门禁之后。图标用现成的 ui-primitives 集（`IconCopyOutline16`、`IconCheckOutline16`；文件夹/IDE 沿用 `IconFolderOpenOutline16`/`IconCodeOutline16`）。

**tab 手势**：`conversation.view` 条目的 inject 新增 `isLoopback` + `hooks.hostDescription`（与给抽屉提供 `useHostDescription` 选择器的 hooks 舱位相同）以及 `openExternal`/`revealFolder` 动词。有一处不对称是刻意的：抽屉按**当前**会话解析（它只预览当前会话），而 tab 按**自己的** `sessionId` 解析——tab 是逐会话表面，记录的路径可能相对的是该会话的 cwd 而非当前会话。tab 在预览区上方渲染一个手势行（复制，以及部署可打开路径时的文件夹/IDE），仅在选中文件时出现，与抽屉头部对齐。两个头部的左侧都优先展示文件在宿主侧解析后的绝对路径（与复制/打开/reveal 同一拼写）——抽屉左侧槽在选中文件时用路径取代通用标题（无选中时标题作为兜底，对话框 aria-label 不变），tab 的预览头部把路径放左边、手势按钮放右边，任一表面上用户都能一眼看到真实路径。

**"在文件夹中打开"现在会选中文件。** 宿主打开器（`host.openPath`）只会用默认应用打开路径——没有"在文件夹中选中"的语义——所以宿主半边新增了 `filePreview.reveal` Remote 方法独占 reveal：它通过 `ctx.fs` 以会话 cwd 为基准解析展示路径，把规范化路径交给无 shell 的原生派发（`@deepseek-ai/dsh-native-command`）：macOS `open -R`（Finder 选中）、Windows `explorer /select,<path>`（Explorer 选中）、WSL 先用 `wslpath` 转 Windows 路径、桌面 Linux 依次尝试 `nautilus` / `dolphin` / `nemo` `--select`。客户端的 `revealFolder` 动词现在调用 `remote.reveal(sessionId, path)`；宿主回答 `revealed: false`（文件缺失、没有可选中的文件管理器）或调用失败时，回退为通过既有 `openOnHost` 打开父文件夹——reveal 之前的行为——手势总能落在可见处。宿主方法只是尽力而为的能力，不是门禁：客户端对整组文件夹/IDE 手势仍用 loopback + `canOpenPath` 门禁。reveal 派发携带可注入的平台事实以支持确定性测试，服务构造函数也为原生 runner 留了 seam。

## 备选方案

- **文件列表里每行一个复制按钮。** 否决：行是紧凑的 名称/目录/轮次 网格，每行一个按钮会污染可能触顶服务上限的列表；选中文件的手势行与抽屉头部一致，复制目标也更明确。
- **组件内部解析路径**（视图里用 `useSessions` + `resolveWorkspacePath`）。否决：会重复打开动词已有的 cwd 逻辑，组件测试还得 stub 剪贴板模块而不是断言一个注入 mock。
- **复用 primitives 的 `useCopyFeedback`。** 否决：它捕获固定字符串并自行写入，无法挂在与打开手势共享的、需要解析 cwd 的注入动词后面。
- **把父文件夹回退放进宿主**（在 `reveal` 方法里重复实现普通打开派发——`open` / `Invoke-Item` / `xdg-open` / `wslpath`）。否决：客户端已经拥有普通打开动词（`workspaces.openPath`），回退在客户端复用它即可；宿主方法保持纯粹的"选中或报告"。

## 影响

`filePreview` 命名空间新增两个 locale 键（`drawer.copyPath`、`drawer.copied`），双语同步。抽屉的复制按钮在选中任意文件时都渲染——包括不能打开路径的部署，那里它成了唯一的路径动词。tab 的手势行让"产物"表面在路径动作上自给自足。视图的注入面扩大（listFiles/readFile + 能力事实 + 三个路径动词）；既有组件测试按新 props 更新，并新增复制成功/拒绝、手势路由、能力门禁、无选中状态等覆盖。剪贴板写入仍是尽力而为的浏览器能力：权限被拒时 `writeClipboard` 返回 `false`，UI 只是停在空闲标签上。宿主半边新增第三个 Remote 方法（`reveal`）和一个新依赖（`@deepseek-ai/dsh-native-command`，官方无 shell 的 `execFile` runner）；reveal 结果是尽力而为的能力——无法选中的桌面仍会得到父文件夹打开，绝不会失败。
