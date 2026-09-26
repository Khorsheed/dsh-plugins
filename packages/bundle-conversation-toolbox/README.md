# @khorsheed/dsh-bundle-conversation-toolbox

[English](README.en.md) | 中文

家族 bundle「会话工具箱」:message-tools、message-timeline、session-title-edit、quote、inline-html-render、context-guard、taskpilot 七个会话体验插件一次装齐。薄元包——patch 插成员规范行 + npm 依赖带齐成员 + locale 卡面元数据,**自身零运行时代码、零客户端面**(纯组合:不注册任何服务/工具/槽位/命令)。

## 形态:纯组合元包

- **patch 逐字复用成员的规范行**:`cordis.patch.yml` 的七行各来自对应成员包自己的 `cordis.patch.yml`,id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点:行只允许落在「成员规范行全集」白名单内,成员必须是真实自挂载包,每个成员必须至少贡献一行。
- **装我 = 装一族,不双挂**:成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。机制依据:`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员作为传递依赖到达,它们自己的 patch 不被应用,任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载(仓规不破);两者同装时的行重叠由官方 bundle 详情页的行级开关解决。
- **`src/index.ts` 只导出常量**(`FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | 消息工具:宿主 Remote + 客户端投影面 |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | 浮动消息时间线跳转 |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | 会话标题内联改名 |
| `@khorsheed/dsh-quote` | `quote` | 引用任意内容(当前会话 / 侧边对话,侧边对话未装时该路由自隐) |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | 转录内联 HTML 卡片 |
| `@khorsheed/dsh-context-guard` | `context-guard` | 上下文占用提醒 + 设置卡 |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | 后台任务的停止/打断命令 |

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
```

挂载后七行全部就位,各插件的浏览器面经各自包内的 `dsh.client` 声明发现。成员的会话级可见性(preset 自隐)逐包保持原判据,本 bundle 不加也不减。

## Compatibility

- **npm 发布线(`@deepseek-ai/dsh@0.1.5`)**:✅ 完整——纯组合,地板取成员最高者(minHost `0.1.5-rc.1`:message-tools、quote、taskpilot 的地板;其余成员 0.1.2-rc.1)。成员各自的降级项(如 quote 的侧边对话路由探测)见各成员自己的 Compatibility 节。
- **源码线 / npm 0.1.7-rc.1+**:✅ 完整(verifiedHost `0.1.7-rc.1`)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。
