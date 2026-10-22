# 变更记录

## 0.3.0（2026-10-22）

纯组合元包，无自有运行时代码；本波变化全部由成员包承载（逐条细节见各成员 CHANGELOG），发布波重写后的成员依赖钉指向各成员 0.2.0-rc.3（dsh-headless 的 0.2.0-rc.2 版本号已被 npm 发布流水线占用（409 拒绝复用），家族同版线整体上移 rc.3；本包 tarball 内的 `^0.2.0-rc.2` 区间按 semver 预发布规则正常解析到 rc.3）。**minor 而非 patch：成员侧含破坏性变更（见认证条），按 0.x 语义进位。**

- **设置面整合**：Plugins 页四张 per-harness 设置卡合并为一张「本机 Agent 委派」家族卡——每家 harness 一个可折叠节（认证状态点、「未检测到 CLI」标签、展开才挂载节体），卡片标题统一为「本机 … 委派」家族命名；随后修复了家族卡因门控命名空间从不被服务而在生产环境永不挂载的问题（3080 实证，2026-10-21）。成员设置卡在独立安装、家族 bundle、模式包三种形态下统一回归（改挂 `plugins.item`、随宿主服务的命名空间门控）。卡片面需要宿主 0.1.7-alpha.1+。
- **认证统一为端点凭据（成员侧破坏性变更）**：claude-code 移除 OAuth 网页授权（钥匙串枚举与双存储协调整体删除），codex 与 kimi 随后也裁掉各自的网页登录流——四个 harness 一套凭据故事：卡片上填 `baseUrl` + `apiKey`（claude-code 另收 `authToken`），落盘为作用域 `endpoint-auth.json`（0600，scope 文件 > profile 配置），卡片带「验证端点并获取模型」探测（三个 provider 都有：kimi 的按钮同波补上，其端点 `/coding/v1/models` 实测可达并回传模型清单）。使用任一网页登录流的部署请在升级前配好端点凭据，否则升级后读作未认证；kimi 的 OAuth 授权在改动前已实测失效。容器轮与宿主共用同一把凭据，容器内零授权。
- **「可用模型」名单统一**：claude-code/codex/kimi 的设置卡共用同一份有序短名单（`<作用域>/models.json`，首项即默认模型、拖拽排序），添加对话框只列所配端点真实供应的模型（三家的模型目录同波全部改为端点 `/v1/models` 取词；kimi 加入名单的端点新模型自动补写 config.toml 的 models 表，否则 kimi-cli 拒绝 `-m` 运行）——自由文本模型框移除，钉一个端点不供应的模型不再可能；成员的模型在首轮即绑定，改名单不影响已在对话中的成员。
- **宿主 0.2.1 适配**：委派迁移到 0.2.1 的 subagent `startActivation` 通道（模型面行为不变，宿主生命周期事件改带 per-execution id）；成员包声明 `engines.dsh`（下限 minHost 不动，上限 `<0.3.0-0` 让未验证的宿主线安装期 fail-closed），peer 区间覆盖 0.2.1，verifiedHost 前移至 0.2.1-rc.1。

## 0.2.0（2026-09-30）

- **家族折叠：patch 撤掉三条委派工具行**。各 provider 的委派工具改为成员包自己的 `./tool` 组合入口（agent 预设点名授予，dev 预设行 id 不变），不再作为 profile 根行复挂；本 patch 保持成员规范行的逐字并集（核 + 四 provider + 两条官方工具行停用覆盖）。deps-only 依赖只剩 `@khorsheed/dsh-local-agent-dsh-headless`——`@khorsheed/dsh-local-agent-tool-subagent` 随折叠退役并从依赖移除。

## 0.1.2（2026-09-30）

无功能变更。随宿主 0.2.0 兼容波重发：成员包的 `@deepseek-ai/dsh-*` peer 区间已加宽以覆盖宿主 0.2.0，bundle 重写后的成员依赖钉随之指向各成员新版本（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.1.1（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2）。纯组合元包，无自有运行时代码；local-agent 家族七成员随本波同版联动重发至 0.1.0-rc.7（各自的变化见各自 CHANGELOG）。

## 0.1.0（2026-09-26）

首个公开发布。
