# @khorsheed/dsh-client-session-title-edit

[English](README.en.md) | 中文

会话标题想改就改：点标题旁的小铅笔，回车就存。

自动起的会话标题常常词不达意，过两天想找回某个会话全靠运气。这个插件在聊天区顶部的标题旁放了一支铅笔：点一下，标题就地变成输入框，预填好当前名字并全选；Enter 保存、Escape 取消，名字起得太长会先被警告拦下，绝不悄悄截断。改名走的是官方 `session.rename` 接口，标题永远不会进入模型上下文，模型对此一无所知。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit1.png" width="640" alt="聊天区头部标题旁的铅笔按钮，悬停显示「重命名会话」">

## 特性

- **头部铅笔**——会话标题右侧的条目切换出内联编辑器，预填当前标题并全选。
- **可预期的按键**——Enter 提交、Escape 取消、空草稿禁用保存、宿主拒绝时内联提示。
- **宽度自适应**——输入框随草稿变宽，上限为官方 220px。
- **预算把关**——超过宿主 80 UTF-8 字节标题预算的草稿被警告拦下，绝不静默截断。
- **零足迹**——走官方 `session.rename` RPC；标题永远不会进入模型上下文（无 token 或 KV 缓存影响）。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit2.png" width="640" alt="点击铅笔后标题就地变成输入框，直接修改后回车保存">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

安装后重启 web 实例；卸载即移除本插件添加的全部界面。

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

**版本线对照**：0.2.0 起支持宿主 `0.1.2-rc.1` 及以后；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。

## 已知限制

- **原位编辑是 DOM 层过渡方案**——官方 header 没有暴露标题槽位，编辑器通过隐藏官方标题 crumb 并原位覆盖实现；官方 DOM 变化时退回 actions 行内编辑器。
- **无乐观更新**——header 标题只在宿主投影结算重命名后刷新。
- **字节预算归宿主所有，由客户端把关**——客户端镜像宿主的 80 字节上限；宿主提高上限后，需常量同步跟进编辑器才会放宽。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

```
src/index.ts            导出（apply/inject + TitleEditActionProps）
src/client/index.ts     插件主体；贡献 header-actions 条目
src/client/TitleEditAction.tsx  铅笔条目、内联编辑器、覆盖与宽度适配
src/client/title-length.ts      MAX_TITLE_BYTES 镜像 + 宿主归一化
src/client/locales.ts   本地化警告与错误
src/client/slots.ts     槽位声明
```

纯浏览器侧插件：重命名走官方 `session.rename` RPC（`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`），因此无需宿主半边、无需新增 RPC、无需改动任何官方包。

编辑是原位的：点击铅笔后，通过 `data-ste-inplace` 隐藏官方标题 crumb，并在其测量矩形上覆盖本插件的输入框。输入框宽度借助隐藏的、与输入框同字体的镜像 span 按草稿适配，下限为 crumb 原宽度、上限为 crumb 的 220px 上限。

对模型没有任何变化：标题是仅投影的会话属性，永不进入模型上下文；重命名只是追加一条带用户来源的 `session/title` 事件——无 token 或 KV 缓存影响，投影落地后 header 标题随之刷新。另外，`@deepseek-ai/dsh-session-title` 限制接受的标题长度（`maxTitleBytes`，生产默认 80 UTF-8 字节）；编辑器镜像该上限以及宿主截断前的归一化（剥离转义/控制/方向序列、折叠空白、去首尾空白），把关恰好在宿主会截断时触发。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/session-title-edit`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
