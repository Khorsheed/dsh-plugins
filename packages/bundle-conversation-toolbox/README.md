# @khorsheed/dsh-bundle-conversation-toolbox

[English](README.en.md) | 中文

一条命令,七个会话体验插件装齐——消息编辑/撤回、时间线跳回、会话标题改名、引用任意内容、内联 HTML 卡片、上下文占用提醒、后台任务控制。

七个成员各自单装也完全成立,但插件清单里会散成七张卡。这个家族 bundle 把它们的规范行收成一张「会话工具箱」卡:一次 `dsh plugin add` 装齐整个家族,清单里按一张卡管理。薄元包——patch 插成员规范行 + npm 依赖带齐成员 + locale 卡面元数据,**自身零运行时代码、零客户端面**(纯组合:不注册任何服务/工具/槽位/命令)。

## 特性

- **一条命令装齐**——七个成员全部列进 `dependencies`,装本 bundle 即带齐整个家族,不用逐包安装。
- **清单里按家族归类**——七行收进一张「会话工具箱」bundle 卡;卡面标题与描述随宿主语言走(`locale/zh.json` / `locale/en.json`)。
- **不双挂**——装本 bundle 只应用本 patch;成员作为传递依赖到达,它们自己的 patch 保持惰性,任何一行都不会挂两次(机制见「实现原理」)。
- **成员行为零修改**——每个成员的功能、配置与会话级可见性(preset 自隐)判据与单独安装时完全一致,本 bundle 不加也不减;细节见各成员自己的 README。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | 发出的消息可复制、就地编辑、真撤回(从模型上下文移除,可恢复) |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | 会话滚动区上的浮动时间线,一键跳回任意用户消息 |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | 聊天头部会话标题内联改名(用户命名后不再被自动重生成覆盖) |
| `@khorsheed/dsh-quote` | `quote` | 选中任意文本浮出动作菜单:引用到当前会话 / 侧边对话(未装时该项自隐)、复制 |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | 把 agent 写的 `dsh-card` fenced block 渲染成会话内联的沙箱交互卡片 |
| `@khorsheed/dsh-context-guard` | `context-guard` | 上下文占用越过阈值时,composer 出现压缩提醒按钮 + 设置卡 |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | composer 上方的后台任务/子 agent 停靠 pill:停止/打断、实时耗时与 token、详情侧栏 |

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
```

重启 web 实例后生效。挂载后七行全部就位,各插件的浏览器面经各自包内的 `dsh.client` 声明发现。

```sh
dsh plugin --profile web remove @khorsheed/dsh-bundle-conversation-toolbox
```

卸载即把七行一起撤下(成员的 patch 从未单独应用,无残留)。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.5-rc.1`):✅ 完整——纯组合,地板取成员最高者(minHost `0.1.5-rc.1`:message-tools、quote、taskpilot 的地板;其余成员 0.1.2-rc.1)。成员各自在该线上的降级项(如 quote 的侧边对话路由探测)见各成员自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.1.7-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**形态:纯组合元包。**

- **patch 逐字复用成员的规范行**:`cordis.patch.yml` 的七行各来自对应成员包自己的 `cordis.patch.yml`,id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点:行只允许落在「成员规范行全集」白名单内,成员必须是真实自挂载包,每个成员必须至少贡献一行(本包 `tests/` 里的规格逐行复核)。
- **装一族,不双挂**:成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。机制依据:`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员作为传递依赖到达,它们自己的 patch 不被应用,任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载(仓规不破);两者同装时的行重叠由官方 bundle 详情页的行级开关解决。
- **`src/index.ts` 只导出常量**(`FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求);`locale/*.json` 只携带 bundle 卡面的 `meta.title` / `meta.description`。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/bundle-conversation-toolbox`)。问题与贡献请移步该仓库。
