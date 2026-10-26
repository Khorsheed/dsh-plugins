# Agent Note: 共享内容面板就地编辑

Status: implemented

## Problem

local-files、file-preview、worktrees 这几个文件面板都通过共享内容面板展示文件，但任何修改都得交给 agent，哪怕只是 README 里的一个错字。读文档时自己看得见、敲得出的小改，绕模型走一圈太慢。

## Decision

面板负责编辑，各面板插件负责写入。

- **内核（`ui-content-preview`）**：新增可选的 `ContentPaneProps.onSave(request) => Promise<SaveOutcome>`。面板插件传了它，完整（未截断）的文本读取在标题行多一个「编辑」。进入编辑后，源码面（纯代码文件就是唯一的那一面）变成 `<textarea>`，渲染面显示草稿；编辑条显示状态，带「保存 / 放弃」，⌘S / Ctrl+S 保存。`SaveRequest` 是 `{ content, base }`：`base` 是开始编辑时的读取内容，在进入编辑时钉住（`edit.ts`），中途点重新载入也不会挪动冲突锚点。`base: null` 对应冲突条上的「仍然覆盖」。`SaveOutcome` 为 `ok`，或 `conflict | unsupported | missing | error` 之一。textarea 会把 CRLF 规范成 LF，保存时还原 CRLF。草稿像滚动位置一样按（会话，路径）存在模块级，切换文件既不丢也不串；有未保存修改时挂上 `beforeunload` 提醒。标题行的图标顺序是：编辑、复制路径（最常用，紧挨着编辑）、重新加载、打开所在文件夹；「在 IDE 中打开」一律放在 ⋯ 菜单里，每个找到的 IDE 各占一行。这样不管有没有「编辑」都放得进 4 个图标位，文件变成可编辑时其他按钮不会挪位。
- **各面板插件**：各自新增写入 Remote，并且只在 `browserOnHost()` 成立时传 `onSave`（2026-10-24 定：手机经隧道暂时只读）。
  - `localFiles/writeFile` 与 `worktrees/writeFile`（仓库相对路径，只写工作树，提交内容保持只读）和各自的读取一样直接用 `node:fs`。只写已存在的普通文件，且在读取上限内、字节能无损往返 UTF-8。先比对当前内容与 `base`，再写同目录临时文件、`chmod` 回原权限、`rename` 覆盖到 realpath 目标。
  - `filePreview/write` 和它的读取一样走 `ctx.fs`：先严格 UTF-8 无损读取、比对 `base`，再用 `stat` 拿到的版本号调 `writeText(..., { kind: 'replaceIfVersion', version })`。`FS_STALE_VERSION` 映射为 `conflict`。沙箱后端会像围栏 agent 的写入一样围栏这次写入。读取的解码器会去掉开头的 BOM，保存时补回。
  - 写入成功后，面板插件先重读再返回，面板退出编辑时显示的是磁盘上真实的内容。worktrees 另外触发 `refresh`，让改动列表带上这次修改。

## Alternatives considered

**富编辑器（CodeMirror 6 / Monaco）**：第一版不选。内核会内联进三个插件的客户端包，而这里针对的是阅读时的小改。textarea 不增加包体积，各种输入法都稳。以后要升级就上 CodeMirror，进入编辑时再懒加载。

**所见即所得 Markdown（tiptap / milkdown）**：否决。文档里有原生 HTML（README 里的 `<img …>`），解析再序列化一圈会改掉用户没碰过的格式。

**宿主侧共享一个写入工具函数**：目前做不到。仅有的私有共享包都是客户端源码平面的包，宿主侧 import 它们在 tarball 安装里会找不到。写入核心很小，local-files 和 worktrees 各留一份；file-preview 改用 `ctx.fs`。

**在读取协议里加版本号（mtime/哈希）**：不需要。随保存送上 `base`（不超过读取上限），服务端直接比对它实际读到的内容，三个插件的读取载荷都不用改，只动了 mtime 的 touch 也不会误报冲突。file-preview 另外用 fs 自带的版本条件写，堵住比对与写入之间的空档。

**在服务端强制只允许本机写**：这些 Remote 信任能访问到实例的任何人，和现有的任意绝对路径读取一样。「只在本机提供」是客户端的手势开关，不是安全边界。

## Consequences

- 用户可以边读边改文档，而且这次编辑不会悄悄覆盖期间落地的 agent 写入。agent 那一侧同样有保护：宿主的「先读后改」策略会拒绝 agent 对用户改过的文件的下一次修改，并要求它重读。
- local-files 与 worktrees 在比对和 rename 之间仍有极小的竞态（没有操作系统级的条件写）。单用户单机，可以接受。
- 非 UTF-8 文件、超过读取上限的文件和图片只读。Tab 不插入字符（照常移动键盘焦点）。不支持新建文件。
- `scripts/sync-icon-artwork.mts` 目前对着 harness 检出跑不通（上游图标模块多了它解析不了的写法，另有包在用上游已删的图标）。`IconEditOutlineMedium` 按生成器的输出格式加进内核的 `icons.tsx`，以后重新生成会得到同样的结果。
