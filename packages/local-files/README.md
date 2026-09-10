# @khorsheed/dsh-local-files

[English](README.en.md) | 中文

独立的工作区文件浏览器插件：新增一个**文件列表 tab**（会话视图环，与 chat / 产物平行），并在带右栏的宿主（0.1.5+）上注册为右栏 tab（guide 页「文件列表」卡片）——git 无关地浏览任何本地目录（懒加载文件树 + 结构化 HTML/Markdown/JSON/CSV/图片预览），不限于当前会话工作区。数据面走独立的 Typert Remote，和 worktrees 的 git 徽标解耦——worktrees 只做 git 状态，本插件只做纯粹的本地文件浏览。

## 特性

- **文件列表 tab**（`conversation.view` 列表项，与 chat / 产物 / worktrees 平行）+ **右栏入口**（0.1.5+：`sidebar.right.pane.tab` 页型 tab，guide 页卡片标题「文件列表」）：左侧文件树（按层懒加载、隐藏/显示点文件、隐藏切换、可拖拽调宽），右侧详情区（结构化 HTML/Markdown/JSON/CSV 预览 + 图片预览）。
- **面包屑顶栏 + 动作行**：面包屑逐级导航；动作按钮为「选择目录」（系统目录选择器）、「打开目录」（宿主 open-in-app 解析出文件管理器时显示）、「刷新」。
- **git 无关**：浏览的是任意绝对本地路径（含未跟踪、被 ignore、仓库外的文件），不做 repo 判定。
- **按会话记忆**：每个会话记住自己最后一次浏览的根目录（localStorage `dsh-local-files-root:<sessionId>`），切会话自动恢复，不串台。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files      # 安装
dsh plugin --profile web remove @khorsheed/dsh-local-files   # 卸载
```

## 数据面

Host 提供 `listLocalDirectory` / `readLocalFile` / `readLocalImage` 三个纯 `@Remote` 方法（namespace `localFiles`,全局无 agent 参数），由客户端经官方 `ctx.remote.$mount` 通道挂载。路径必须是绝对路径（`assertSafeLocalPath` 拒绝空、相对、`..` 穿越的形状）。

## Config

无需配置。可作为插件单独安装，组合进 cordis.yml 时即插即用。

## Compatibility

| Host 行 | 结论 |
| --- | --- |
| npm release (`>= 0.1.5-rc.1`) | ✅ 完整 |
| npm release (`0.1.2-rc.1` … `0.1.4.x`) | ⚠️ 降级——external-open 手势隐藏（宿主无 open-in-app 路由） |
| deepseek-harness master | ✅ 完整（open-in-app 随 0.1.5 落地；`verifiedHost: 0.1.2-rc.1`） |

- 文件列表 tab 与右栏入口都是 web 表面；headless 无浏览器消费者时本插件零贡献。右栏注册挂在 pending 于 `sidebarRightTabs` 的嵌套插件上，0.1.2–0.1.4 宿主不激活它，只剩 conversation.view tab 一个入口。
- 「打开目录 / 在 IDE 打开」手势经官方 open-in-app 恢复：浏览器每页探测一次 `GET /open-in-app/apps`，宿主解析出对应应用（文件管理器，或编辑器/IDE）才显示该手势；官方 open 路由只收目录路径，文件上的手势打开其所在目录。无 open-in-app 的宿主（< 0.1.5）探测失败，手势保持隐藏——静默降级，minHost 不动。
- minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。

> 细分：本插件是「任意本地目录浏览」；file-preview 是「当前会话产物」。二者语义不同，故做成两个独立包，不合并。
