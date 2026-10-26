# @khorsheed/dsh-capability-catalog

[English](README.en.md) | 中文

一页看清 agent 会什么、每个工具是谁装的，新技能和 MCP 服务器也在这一页装。

装的插件、技能一多，「这个 agent 现在到底能干什么」「这个工具是哪来的」就说不清了，以前只能翻日志。装上能力目录，设置里多一页「工具与技能」：每个技能、每个工具都列出来，标好来源；想加新技能，上传文件或粘贴一条安装命令就行；想接 MCP 服务器，把配置贴进去即可。agent 自己也能查这份清单，回答「我能做什么」。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-1.png" width="560" alt="「工具与技能」设置页：技能预览网格，带来源徽标、搜索排序与模式选择框">

## 能做什么

- **一页看全**：技能和工具分两个标签列出，带搜索和排序；点开一张卡片，能看到完整说明和技能的全部文件。
- **每个工具都标了出处**：内置的、哪个插件装的、哪台 MCP 服务器带来的，一眼看得出。
- **换个模式看看**：在「模式」里选一个模式，页面就只显示这个模式能用的东西；选「全部模式（对比）」，每张卡片会标出它出现在哪些模式里。
- **三种方式装技能**：点「新增 Skill」，可以上传文件夹或压缩包、粘贴一条安装命令，或从本机目录里勾选。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-2.png" width="560" alt="新增 Skill 弹窗：文件上传 / 命令安装 / 从本机目录三种安装方式，每个来源可选目标根与是否进模型 catalog">

- **技能要的密钥在这里填**：技能声明了需要的密钥，详情里就有「凭据配置」，填一次就好，值不会出现在页面上。
- **贴一段配置就能接 MCP**：点「新增 MCP」，把服务器配置粘进去，它自己认出连接方式和密钥；连上后整台服务器或单个工具都能开关，agent 当场就能用。
- **只让某几个模式用某个技能**：在技能详情里勾选它生效的模式，保存即可。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-3.png" width="560" alt="新增 MCP 服务器弹窗:粘贴一段 mcp.json server 配置,自动解析传输与凭据">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-basic
```

能力目录会跟着「基础体验」一起装好。装完打开「设置 → 工具与技能」就能看到。

## 已知限制

- 技能的密钥只是默认不给 agent 看，不是绝对保密：agent 主动去打印，还是能看到。
- 有的插件没给自己的工具标出处，这些工具会暂时显示为「内置」；页面上「为什么我的插件工具不在这里？」给了修法。
- 接进来的 MCP 工具只传文字，不传图片和附件。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 各项能力的细节、工具来源标记、能力指纹、工作区接入接缝、实现原理和双宿主线兼容说明，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/capability-catalog/docs/reference.md)里。给工具标出处的写法见 [docs/tool-origin-guide.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/tool-origin-guide.md)。
- 入口：`src/index.ts`（服务与 `list_capabilities` 工具）、`src/client/index.ts`（设置页）。也可以单独安装：`dsh plugin --profile web add @khorsheed/dsh-capability-catalog`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
