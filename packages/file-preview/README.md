# @khorsheed/dsh-file-preview

[English](README.en.md) | 中文

agent 碰过的文件一页看全：改了什么、现在长什么样，看完还能顺手改一笔。

agent 干了半天活，到底动了哪些文件、改成了什么样，以前得自己去翻目录、对 diff。装上会话产物，这个会话读过、写过、改过的文件都排在右栏一页里；点开一个，看到的是渲染好的文档，也能一次次往回翻 agent 的每一次修改。你得到的是一份随会话长出来的清单，哪里不对，当场改掉保存。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview1.png" width="640" alt="「会话产物」页的文件预览：文件列表与渲染好的 Markdown 预览">

## 能做什么

- **动过的文件都在一页**：右栏向导页里点「会话产物」，这个会话碰过的文件按最近活动排好，可以搜索；agent 用命令行顺手写出来的文件也算在内。
- **点开就是看得懂的样子**：Markdown 显示成文档，JSON 是可折叠的树，CSV 是表格，代码带高亮，图片直接显示，文档里引用的本地图片和链接也能看、能点；带脚本的网页先问你，再放进隔离环境里运行。
- **每一次修改都能翻回去看**：切到「改动」，一次次往前翻 agent 对这个文件的每一次写入和修改。
- **每轮结束一张小卡**：对话里每一轮末尾有一张「N 个产物」卡片，列出这一轮改了哪些文件、各增删多少行，点一下就打开。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview2.png" width="640" alt="一个文件的改动记录：逐次的 diff 可以前后翻看">

- **看到不对，当场改**：点「编辑」直接改，「预览」里同步看效果，⌘S 或「保存」写回去。你改的时候 agent 也动了这个文件，会提醒你，选「仍然覆盖」或「放弃修改，重新载入」；切到别的文件再回来，没保存的草稿还在。
- **一键回到你的工具**：「复制路径」「打开所在文件夹」「在 IDE 中打开」，在本机打开页面时就能用。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview3.png" width="640" alt="「会话产物」页：会话写过的全部文件一览">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-file-preview
```

它也会跟着「基础体验」（`@khorsheed/dsh-basic`）一起装好。装完在任意会话里打开右栏向导页的「会话产物」，或者点对话里的「N 个产物」卡片。

## 已知限制

- 只列当前会话碰过的文件；想随便翻本机目录，用「文件列表」插件。
- 手机上只能看不能改；图片、非 UTF-8 的文件和太大的文件也不能编辑。
- PDF、压缩包这类显示不了的文件，交给 DSH 自带的预览打开。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（读写文件的宿主服务）、`src/client/index.ts`（右栏页面与回合卡片）。命令行安装：`dsh plugin --profile web add @khorsheed/dsh-file-preview`。
- 服务方法、配置项、给服务端调用方的只读接口、兼容细节和内部结构，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/file-preview/docs/reference.md)里。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
