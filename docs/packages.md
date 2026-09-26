# 包地图

> 由 `pnpm map:packages` 生成、`pnpm check:packages` 校验(已进 `pnpm gate`)。**请勿手改**——数字与形态都从各包 manifest 读取。

## 概览

- 包总数:**43**
- 自挂载 bundle(`dsh.bundle.patch`):**34**
- 组合组件(不自挂载,`dsh.composition.component`):**9** — `preset-composed-row` 6、`provider-mounted-row` 1、`source-plane-library` 1、`sub-profile-patch` 1
- 带浏览器半边(`dsh.client`):**28**
- 整合 profile(默认安装单元):**3** — `web-basic`、`web-dev`、`web-eval`

**安装单元是 profile,不是单包。** 单包安装是高级路径:自挂载包 `dsh plugin add <pkg>` 即可,
组合组件(下表 `形态 = composition`)必须由 profile 的 preset 行或 provider patch 落位,`dsh plugin add` 不会挂载它们。

## 包

| 包 | 目录 | 版本 | 形态 | 组件 | 客户端 | minHost | 出现在 profile |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@khorsheed/dsh-ankh-guard` | `packages/ankh-guard` | 0.3.2 | bundle | — | web | 0.1.5-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-bundle-conversation-toolbox` | `packages/bundle-conversation-toolbox` | 0.1.1 | bundle | — | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-bundle-local-agent` | `packages/bundle-local-agent` | 0.1.1 | bundle | — | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-canvas` | `packages/canvas` | 0.4.8 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-capability-catalog` | `packages/capability-catalog` | 0.1.96 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-capture` | `packages/capture` | 0.1.1 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-context-guard` | `packages/context-guard` | 0.2.3 | bundle | — | web | 0.1.2-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-datasets` | `packages/datasets` | 0.1.0-rc.1 | bundle | — | web | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-datasets-tool` | `packages/datasets-tool` | 0.1.0 | composition | preset-composed-row | — | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-reader` | `packages/dsh-reader` | 0.2.1 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-eval` | `packages/eval` | 0.1.0-rc.1 | bundle | — | web | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-eval-tool` | `packages/eval-tool` | 0.1.0 | composition | preset-composed-row | — | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-file-preview` | `packages/file-preview` | 0.3.2 | bundle | — | — | 0.1.5-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-inline-html-render` | `packages/inline-html-render` | 0.1.14 | bundle | — | web | 0.1.2-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-lab` | `packages/lab` | 0.1.0-rc.1 | bundle | — | — | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-local-agent` | `packages/local-agent` | 0.1.0-rc.7 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-agent-claude-code` | `packages/local-agent-claude-code` | 0.1.0-rc.7 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-agent-codex` | `packages/local-agent-codex` | 0.1.0-rc.7 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-agent-dsh` | `packages/local-agent-dsh` | 0.1.0-rc.7 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-agent-dsh-headless` | `packages/local-agent-dsh-headless` | 0.1.0-rc.7 | composition | sub-profile-patch | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-local-agent-kimi` | `packages/local-agent-kimi` | 0.1.0-rc.7 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-agent-tool-subagent` | `packages/local-agent-tool-subagent` | 0.1.0-rc.7 | composition | provider-mounted-row | — | 0.1.2-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-local-files` | `packages/local-files` | 0.1.1 | bundle | — | web | 0.1.5-rc.1 | web-dev, web-eval |
| `@khorsheed/dsh-message-timeline` | `packages/message-timeline` | 0.2.3 | bundle | — | web | 0.1.2-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-client-message-tools` | `packages/message-tools` | 0.3.2 | bundle | — | web | 0.1.5-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-mission` | `packages/mission` | 0.1.0-rc.1 | bundle | — | web | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-mission-tool` | `packages/mission-tool` | 0.1.0 | composition | preset-composed-row | — | 0.1.5-rc.1 | web-eval |
| `@khorsheed/dsh-mobile` | `packages/mobile` | 0.1.1 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-presets` | `packages/presets` | 0.1.0 | bundle | — | — | 0.1.7-rc.1 | — |
| `@khorsheed/dsh-quote` | `packages/quote` | 0.1.1 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-room` | `packages/room` | 0.1.1 | bundle | — | web | 0.1.5-rc.1 | web-dev |
| `@khorsheed/dsh-room-tool` | `packages/room-tool` | 0.1.1 | composition | preset-composed-row | — | 0.1.5-rc.1 | web-dev |
| `@khorsheed/dsh-client-session-title-edit` | `packages/session-title-edit` | 0.2.3 | bundle | — | web | 0.1.2-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-sidechat` | `packages/sidechat` | 0.2.3 | bundle | — | web | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-taskpilot` | `packages/taskpilot` | 0.3.2 | bundle | — | web | 0.1.5-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-typesafe` | `packages/typesafe` | 0.1.1 | bundle | — | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-typesafe-tool` | `packages/typesafe-tool` | 0.1.1 | composition | preset-composed-row | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-client-ui-content-preview` | `packages/ui-content-preview` | 0.1.1 | composition | source-plane-library | — | 0.1.5-rc.1 | — |
| `@khorsheed/dsh-client-ui-file-preview` | `packages/ui-file-preview` | 0.3.2 | bundle | — | web | 0.1.5-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-ui-shortcuts` | `packages/ui-shortcuts` | 0.2.3 | bundle | — | web | 0.1.2-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-whalesong` | `packages/whalesong` | 0.2.3 | bundle | — | web | 0.1.2-rc.1 | web-basic, web-dev, web-eval |
| `@khorsheed/dsh-worktrees` | `packages/worktrees` | 0.2.1 | bundle | — | web | 0.1.5-rc.1 | web-dev |
| `@khorsheed/dsh-worktrees-tool` | `packages/worktrees-tool` | 0.1.1 | composition | preset-composed-row | — | 0.1.5-rc.1 | web-dev |

## 整合 profile

| profile | 直接依赖 | bundles |
| --- | --- | --- |
| `profiles/web-basic` | 10 | 12 |
| `profiles/web-dev` | 23 | 22 |
| `profiles/web-eval` | 26 | 24 |

## 形态的含义

- **bundle**:包自带 `cordis.patch.yml` 并把该文件列进 `files`,装进 profile 的直接依赖后由
  官方 reconciler 挂载**它自己的** loader 行。
- **preset-composed-row**:模型工具行。由**安装它的 profile** 作为直接依赖引入(与 core 并列),
  它自己声明对 core 的依赖(companion → core,只保证模块可解析);再由 agent preset 的
  `agent.cordis.yml` 按名引用一行,按会话授予。它不出现在 `dsh.profile.bundles` 里,`dsh.bundle`
  声明会把工具自动挂回 profile 根,正是工具拆分要移除的东西。配套 UI/提示词随此行的授予
  自隐,判据与反模式见 [plugin-visibility.md](plugin-visibility.md)。
- **provider-mounted-row**:家族内部共享行,由 provider 的 patch 挂载,或由 provisioner 落位。
- **sub-profile-patch**:patch 只面向被 provision 出来的子 profile,由 provisioner 复制进该子
  profile 自己的 patch 层。

根 `README.md` 的插件表是**精选介绍**,不是完整清单;完整清单以本文件为准。
