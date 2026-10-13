# Agent Note: 素材导入走宿主原生目录选择器——选文件夹，勾选其中的媒体文件

Status: implemented

## Problem

导入素材此前要在文本框里手敲宿主机路径、一行一个——这是面板流程里最容易出错的一步（打错字要到 ffprobe 探测时才暴露，而且大多数导入其实就是"这个录制文件夹里的所有文件"）。用户问能否复用宿主的文件对话框能力。

## Decision

宿主的选择器 seam（`remote.directoryPicker`，宿主 ≥ 0.1.2）**只能选目录**——`pickNativeDirectory` 是 `choose folder` / zenity `--directory` / kdialog `--getexistingdirectory` / 目录模式的 Win32 `IFileOpenDialog`，单选，没有文件模式。所以流程是选目录 + 面板内选文件：

1. 素材 tab 新增「选择文件夹…」按钮，只在 `browserOnHost()` 时渲染（对话框开在宿主的屏幕上；按面板规范，远程访问的页面要隐藏这类只在宿主有意义的手势）。
2. 按钮调用面板 face 的 `pickDirectory`，点击时才 `ctx.get('remote.directoryPicker')`——local-files 同款模式：用 `ctx.get` 而不是 inject，组合里没有选择器时得到 undefined，点击按"取消"降级，而不是把整个插件挂起。
3. 新增 `listMedia` Remote 动词（`VideoStudioService.listMediaFiles`），列出所选文件夹内直接包含的音视频文件（用导入同款的 AUDIO_EXT/VIDEO_EXT 扩展名集合过滤、按名称排序、不进子目录、stat 取大小——不调 ffprobe，列表保持秒出）。列表动词属于本包：宿主 browse 后端只列目录，而 local-files 的列表 remote 是别的插件的 face，跨插件规则不允许依赖。
4. 面板把文件显示为默认全选的勾选清单（类型圆点、文件名、大小）；「导入所选」走现有 `importSources` 导入勾中的路径（「连续录制」开关同样生效）。文本框保留给远程页面和从会话粘贴路径的流程。

素材 tab 本身也按旅程重排。空工程是一张居中的引导卡（虚线描边）：选文件夹是唯一的大主按钮，手动输入路径折叠进「手动输入路径」链接，"文件留在原处"只在副标题说一次，不再常驻一行提示。已有素材后引导卡收起为一行紧凑按钮（选择文件夹… / 手动输入路径），两个导入面（手写文本框、勾选清单）各自带「连续录制」开关，挨着自己的导入按钮。选文件夹成功会收起手写框，同一时刻只有一个导入面展开。常驻的等宽文本框取消了——它传达的是"这个面板是给会敲路径的人用的"，与期望的旅程正好相反。

## Alternatives considered

- **给选择器加上游文件模式**（`pick({ kind: 'file', multiple, filters })`）：体验更好的手势（原生多选 + 类型过滤），但那是走上游流程的 harness 改动；选文件夹 + 勾选清单今天就能用，且覆盖了"一次录制一个文件夹"的主流布局。重新引入条件记录在此：seam 若长出文件模式，勾选清单这一步就折叠进原生对话框。
- **浏览器 `<input type="file">`**：只给没有宿主机路径的 File 对象；导入设计刻意基于路径（"文件留在原处，不复制、不上传"），因为 ffmpeg 直接读原文件。为选择器把几个 GB 的录音上传一遍是本末倒置。
- **只选目录、不给清单**：文件夹里很少恰好全是要的文件；清单只多花一次点击，避免把同目录的草稿和导出成品也导进去。

## Consequences

- 主流导入路径变为：选录制文件夹 → 取消勾选多余文件 → 导入所选。不用打字，不再有路径笔误。
- 远程页面（按钮隐藏）和没有选择器的宿主（按取消降级）行为不变；文本框流程原样保留。
- `listMedia` 只读、只看一层目录；不是通用的文件系统浏览能力。

## Testing

`core.spec.ts` 新增 `folder-pick import` 用例（扩展名过滤、按名称排序、不进子目录、文件夹不可读时报错）。`pnpm --filter @khorsheed/dsh-video-studio build && test` 全绿；`pnpm check:panels --package packages/video-studio` 无错误。
