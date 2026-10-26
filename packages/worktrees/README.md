# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

这个会话在哪个分支上干活、还有多少没提交——抬头看一眼就知道。

几个工作树并行开发时，想知道当前会话对着哪个分支、改了多少，以前得切去终端敲 git。装上工作树，会话头部多一个分支小标签，写着分支名和改动行数，有没提交的改动就变色；点一下，右栏打开改动、提交记录和整个仓库的文件。你得到的是不离开对话就能看清的 git 现状，看到要改的地方，顺手改掉。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/pilot-badge-standard.png" width="560" alt="会话头部右上角的分支标签：分支名加改动行数 +175 −34，旁边是仓库名">

## 能做什么

- **抬头就知道在哪干活**：会话头部的标签写着分支名和改动行数，有改动时变成提醒色，鼠标停上去能看到明细。
- **点一下看改动**：点标签打开右栏的「工作树」页，「工作树待提交」列出所有没提交的文件，点一个看它的 diff 或现在的内容。
- **提交记录和整个仓库也在**：「仓库提交记录」里点一条提交，看它改了哪些文件、每个文件改成什么样；「仓库文件」能翻遍仓库里的文件，图片直接显示；文档里引用的本地图片和链接也能看、能点。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/worktrees-tab.png" width="560" alt="右栏「工作树」页的「工作树待提交」：左边是改动文件树，右边是选中文件的彩色 diff">

- **看到不对，当场改**：「内容」视图里点「编辑」直接改，⌘S 或「保存」写回工作树，左边的改动列表跟着更新；你改的时候 agent 也动了这个文件，会提醒你选覆盖还是放弃。
- **换个工作树接着干**：页面顶部「切换工作树」换到另一个，再点「切换到此工作树」，agent 下一轮就在新目录里干活，不打断它手上的事。
- **agent 也能替你管工作树**：在对话里让它列出、新建、切换或删除工作树；删除一定先问你，主检出和还有未提交改动的工作树它删不了。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-worktrees
```

它也会跟着「开发套件」（`@khorsheed/dsh-dev-suite`）一起装好。装完在一个 git 仓库里开「开发模式」的会话，分支标签就出现在会话头部右上角。在其它模式里看不到标签是正常的。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/pilot-badge-other-preset.png" width="560" alt="其它模式（极简模式）的会话里没有分支标签和工作树页，会话头部只剩 DSH 自带的按钮">

## 已知限制

- 标签不是时时刷新：一轮结束、你发消息、切回窗口时才更新，在终端里刚改的要等一下才显示。
- 超过 2 MB 的文件不预览；手机上只能看不能改，历史提交里的内容也只读。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（git 服务）、`src/tool.ts`（agent 用的工作树工具）、`src/client/index.ts`（标签与右栏页面）。单独安装（`dsh plugin --profile web add @khorsheed/dsh-worktrees`）时，工作树工具要由某个模式授予，标签和页面只在那些模式的会话里出现；已经挂过本插件的配置不要重复添加。
- 配置项、给服务端调用方的按路径查询与切换接口、兼容细节和内部结构，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/worktrees/docs/reference.md)里。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
