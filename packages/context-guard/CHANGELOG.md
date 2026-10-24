# 变更记录

## 0.2.6（2026-10-24）

- `dsh.references` 去掉已退役的 `@khorsheed/dsh-bundle-conversation-toolbox`(其成员全部并入 basic)。

## 0.2.5（2026-10-22）

- **设置卡回归插件页**：家族/模式 bundle 折叠后阈值设置卡整体失声——`plugins.row.config` 的键钉死了旧载体 bundle（成员行现由模式包承载，键永不命中），0.1.5 座位 `settings.plugin.item` 已被宿主改名删除（现名 `plugins.item`），鸭式老臂静默失效。现在改为注册一个 `plugins.item` 列表条目并以 `configForms.whileServed` 门在服役中的 `context-guard` 命名空间上：独立安装、家族 bundle、模式包三种形态同一张卡，组合摘掉该行时卡也干净消失。代价：宿主 <0.1.7-alpha.1 不再渲染设置卡（输入框压缩按钮等其余面不变，已记入 README 兼容节与 `dsh.compat.notes`）。见 [Agent Note](../../.agents/notes/implemented/bug-fix/2026-10-18-bundle-member-config-card-via-plugins-item.md)
- 适配宿主 0.2.1 线：verifiedHost 前移至 0.2.1-rc.1，`@deepseek-ai/dsh-*` peer 区间加宽覆盖 0.2.1 并声明 `engines.dsh`（`>=0.1.2-rc.1 <0.3.0-0`）；退役 load 期 invariant 伴生探针（空仪式，无行为变化）

## 0.2.4（2026-09-30）

- **设置面直接调用 schemastery 的类型化 `.volatile()`**：0.2.0 开发线解析到 schemastery 3.18.4，其 `Schema` 已声明 `volatile()`——手写的 `VolatileCapable` 强转探测不再类型重叠（TS2352）。运行期双线行为不变：探测在 0.1.5 的 schemastery 3.18.2（无 `volatile` 方法）上仍回落到普通字段
- 加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0

## 0.2.3（2026-09-27）

无功能变更。随宿主 0.1.7-rc.2 基线发布波重发：全量构建+测试在 rc.2 基线通过（rc.1→rc.2 无触及本包的宿主变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)）。

## 0.2.2（2026-09-26）

适配宿主 rc.1 线并实证 0.1.5/0.1.7 双线可用（0.1.5-rc.1 全量 boot 实证，2026-09-25）。

- **家族 bundle 形态下设置卡迁址**：随 `@khorsheed/dsh-bundle-conversation-toolbox` 安装时成员不再是 profile 直依，插件页不给成员开详情页——设置卡（阈值编辑）改注册到行级槽位 `plugins.row.config`（键 `…#context-guard`），从 bundle 详情页该行的「配置」入口打开；独立安装与 0.1.5 legacy 卡两臂不变
- 设置面双线：rc.1 走 entry Config（volatile 探测）+ `configForms`，0.1.5 留 `settings.register` + `settingsScope`；`SessionStatus` 新面迁移，卡注册改双臂（`settings.plugin.item` / `plugins.bundle.config`）
- 图标自持化：插件用到的 rc.1 图标图样由 `sync-icon-artwork` 生成器摊平进包内 `src/client/icons.tsx`（0.1.5 与 rc.1 的图标导出名零交集，外部化引用在 0.1.5 上是 undefined 会炸槽位）；两条宿主线渲染同一份图样
- 插件清单展示元数据（`locale/*.json`）：rc.1 宿主插件页的卡面标题/描述中文化

## 0.2.1（2026-09-11）

- 无功能变更：开发基线随仓内 pin 对齐官方 `0.1.5-rc.1` / cordis `4.0.2`（消除 4.0.1/4.0.2 双实例图分裂）；peer 依赖范围与 minHost（`0.1.2-rc.1`）不变

## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.0`）
- 导入面迁移：client bundle 不再引用宿主已删除的 `dsh-client-runtime`（类型改自 `dsh-client-ui-settings` / `dsh-session` 等 0.1.2 导出面），`apply` 签名回到 cordis `Context`
- 设置注册改用裸命名空间（`settingsNamespace()` 已随宿主移除）

## 0.1.0（2026-08-22）

首个公开发布。

- 上下文占用越过配置比例时，输入框工具栏自动出现琥珀色压缩按钮，低于阈值时隐藏
- 点击执行官方 `/compact`，在上下文溢出拒绝请求之前提醒
- 与输入框旁的进度环同一数据源（官方 `contextPressure` 投影），两者永不打架
- 阈值比例（0.01–1）在设置 → 插件里实时调整，无需重启
