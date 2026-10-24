# 变更记录

## 0.2.0-rc.4（2026-10-24）

- 文档:preset 包形态的示例改为各模式包(`@khorsheed/dsh-dev-suite` 等),`@khorsheed/dsh-presets` 已退役。无代码变更。

## 0.2.0-rc.3（2026-10-22）

（版本号说明：家族的 dsh-headless 包 0.2.0-rc.2 版本号已被 npm 发布流水线占用（重复利用被 409 拒绝：「Cannot stage previously published version」——曾发布后被撤回或曾被暂存，外部无法区分，结果相同：该号不可复用）；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

- **本机 DSH 委派继承父实例所选模型路线**：子 dsh 的模型目录与默认选择本就来自父实例，但此前独立 headless profile 只收到 DeepSeek 凭据——父实例选中 Kimi 等官方 pi-ai 路线时以 `NO_ADAPTER` 失败，live 镜像又把原生错误改写成 `UNKNOWN` 掩盖原因。现在本地 exec 与常驻启动经公开 settings 服务快照所选路线的有效配置（原生 DeepSeek，以及显式配置了 API-key 引用的 pi-ai 路线），只复制选中的路线、只解析它声明的凭据；凭据经启动环境传递，不进 argv 与 profile 文件。模型目录隐藏没有继承合同的适配器并标记目录不完整；原生失败保留原始错误码与消息。配置或 key 变化下一轮即生效，无需重启父实例。
- **设置面并入「本机 Agent 委派」家族卡**：家族核提供 `localAgentUi` 注册表时，本包设置界面作为家族卡的一节渲染（Plugins 页从四张 per-harness 卡收拢为一张）；旧 core 或无 core 时回落为本包独立的 `plugins.item` 卡，行为不变。独立卡本身从家族折叠后失效的 keyed 席位改挂 `plugins.item`、按宿主服务的命名空间门控——设置卡在 0.1.7-alpha.1+ 宿主的各种安装形态（独立安装、家族 bundle、模式包）下恢复且一致，0.1.5 与 0.1.6-alpha.2 不再渲染（已记入 README Compatibility 与 `dsh.compat.notes`）。插件管理器与设置卡标题统一为「本机 DSH 委派 / Local DSH Delegation」。
- **评测子 dsh 的 preset 交付改为拷进 scope 的包（宿主 0.2.0）**：0.2.0 的 preset 只以声明式 loader 行存在——provisioning 在子 profile 追加 agent-preset-registry 的 `default` 行，preset 定义是实例直接依赖里的一个包（声明 `dsh.bundle.patch` 的形态），逐字节镜像到 `<scope>/preset-packages/<id>` 并以相对软链挂进子 profile；0.1.5 的目录形态与 roster 行不再写也不再认。宿主 profile 改为**拷贝** headless bundle 而非软链——pack 过的 bundle 被 0.2.0 归为 linked root，startup/runner 的裸导入失败、子 dsh 挂住不出会话（3185 实例探针 420 秒超时实证），拷贝后同一份组合走到 `MISSING_CREDENTIAL`（探针无 key 的预期终点）。新增配置键 `unitHeadlessBundleDir` 写单元里的 headless 路径：写了之后 provisioning 写孪生子 profile（`<name>` 走本实例 bundle、`<name>-unit` 走单元路径），带 `exec` 的轮次选后者，宿主轮不再依赖机器级 `/opt/dsh-headless` 软链。
- **适配宿主 0.2.1（host-021）**：委派迁移到 `SubagentRuntime.startActivation`（0.2.1 删除 `ctx.subagents.start()`）——resume 句柄、工具结果文本、Remote 推送与 stop/cancel 语义等模型面行为不变，run id 改为每次执行唯一。`engines.dsh` 声明为 `>=0.1.5-rc.1 <0.3.0-0`（声明即独占兼容裁决，未验证的宿主线安装期 fail-closed）；invariant 伴随件随官方删除 invariants 体系整体退役（harness 契约审计探针是记录在案的接受损失）。`@deepseek-ai/dsh-*` peer 区间加宽覆盖 0.2.1 线（semver 预发布只覆盖比较子点名的三元组，原区间在严格 npm/pnpm 解析下不含 0.2.1-rc.1）；`dsh.compat.verifiedHost` 前移至 0.2.1-rc.1（host-021 波对 0.2.1-rc.1 树全量构建+测试绿，并经 3080 生产验收）。
- **修复发布 tarball 缺 js-yaml**：`lib/` 裸导入 js-yaml 而 pack-dist 剥掉 `dependencies`，实例内由宿主解析无事，独立运行产物则以 `ERR_MODULE_NOT_FOUND` 死。js-yaml 现声明进 `dsh.runtimeDependencies`，dist manifest 会携带并安装它。

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：`subagent_dsh` 改挂家族核的 `./tool-factory`**。开关 ON 时的动态挂载从已退役的 `@khorsheed/dsh-local-agent-tool-subagent` 包改为 `@khorsheed/dsh-local-agent/tool-factory` 的 `mountSubagentDelegationTool`（内联插件对象，owner 传本包包名），行为与生命周期不变（设置开关独占挂载/卸载）。依赖同步移除。

## 0.1.0-rc.9（2026-09-30）

- **修复同款跨实例 home 回退**：`defaultPresetRoot()` 的兜底从硬编码 `~/.dsh-official` 改为非空白 `$DSH_HOME` → `~/.dsh`（官方 `resolveDshHome` 优先级），桌面 app 上不再误读其他实例的 preset 根

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过。README 截图整理（设置页一张从未存在的引用删除，全部图片引用可解析）。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布。
