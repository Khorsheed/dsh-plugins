# @khorsheed/dsh-local-files

[English](README.en.md) | 中文

在右栏翻本机任意目录，点开就能看、看完就能改。

想看一眼工作区旁边的素材目录、仓库外的一份数据，以前得切去系统的文件管理器，打开后还是一堆看不懂的源码。装上文件列表，右栏就能翻本机任何一个目录：默认是当前会话的工作目录，也能换到别处；点开一个文件，网页、文档、表格都是渲染好的样子。你得到的是不离开对话就能查、能改的本机文件。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-2.png" width="640" alt="「文件列表」页：左边是文件树，右边是渲染好的 Markdown 预览，带内容搜索和预览/源码切换">

## 能做什么

- **想翻哪就翻哪**：默认打开当前会话的工作目录；「选择工作区」换到别的目录，下次打开还记得，「退回原始工作区」一键回来。仓库外的、没被 git 管的、被忽略的文件都能看。
- **按名字找文件**：点文件树上方的放大镜，输入文件名或文件夹名，命中的结果连同它所在的目录一起展开。
- **点开就是看得懂的样子**：网页、Markdown、JSON、CSV 渲染成能读的样子，图片直接显示，文档里引用的本地图片和链接也能看、能点，还能在内容里搜索；磁盘上改了，点「重新加载」就是最新的。
- **看到不对，当场改**：点「编辑」直接改，「预览」里同步看效果，⌘S 或「保存」写回去。你改的时候 agent 也动了这个文件，会提醒你，选「仍然覆盖」或「放弃修改，重新载入」；切到别的文件再回来，没保存的草稿还在。
- **一键回到你的工具**：「打开此文件夹」「打开所在文件夹」「在 IDE 中打开」，在本机打开页面时就能用。
- **手机上也能翻**：面板窄的时候，列表和文件详情分两屏切换，路径缩成一条能点的面包屑。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-local-files
```

它也会跟着「基础体验」（`@khorsheed/dsh-basic`）一起装好。装完在开始页或右栏向导页点「文件列表」卡片就能用；它会替换掉 DSH 自带的「工作区文件」卡片，卸载后原来的卡片会回来。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-1.png" width="640" alt="开始页的入口卡片：文件列表，默认打开本会话的工作目录">

## 已知限制

- 不能新建、重命名或删除文件；手机上只能看不能改，图片、非 UTF-8 的文件和太大的文件也不能编辑。
- 文本一次最多显示 2 MB，更长的会截断；超过 2 MB 的图片不显示。
- 能翻到宿主电脑上当前用户读得到的所有文件，多人共用一台 DSH 时请留意。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（读写本地文件的宿主服务）、`src/client/index.ts`（右栏页面）。命令行安装：`dsh plugin --profile web add @khorsheed/dsh-local-files`。
- 服务方法、读取窗口、兼容细节和内部结构，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-files/docs/reference.md)里。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
