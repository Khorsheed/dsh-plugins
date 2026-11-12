# Agent Note: 宿主 0.2.2-rc.2 适配——分两轮，而非一次发布

Status: implemented

[English](2026-11-12-host-022-rc2-adaptation.md) | 中文

## Problem

宿主 0.2.2-rc.2 与本仓使用的 rc.1 标签相隔 1568 个提交，既改变 activation 与 Session append 契约，也新增多项与社区插件重叠的能力。只做依赖升版会漏掉真实破坏；只因官方出现相似界面就替换整包，则会把迁移、功能损失和产品变化绑成一次高风险发布。

## Decision

采用两轮。第一轮用准确的 rc.2 更新开发与 workflow 基线，保留现有行为，只迁移仍有旧宿主降级的接口。第二轮分别处理能力整合、持久数据迁移与退役，记录在 `proposals/active/2026-11-12-host-022-rc2-official-capabilities.md`。

开发 pins、lockfile 和两套固定 workflow 使用 `dsh-v0.2.2-rc.2`，CI 使用 Node 24.9。现有 `^0.2.2-rc.1` peer 范围已覆盖 rc.2，不机械改写全部 manifest；只有必须使用且无法降级的新 API 才能抬高 `minHost`。`verifiedHost` 只随实际验证推进。全部 19 个 Remote 包在生成的声明旁补齐 rc.2 必需的 `lib/typert.remote-client.d.ts.map`，并发布 `src/`，与官方源码导航载荷一致。`pack-dist` 保留这份生成地图，同时继续清理普通 sourcemap 与增量状态，并校验每个被引用的源码目标都在 tarball 内。

local-agent 同时携带新版平铺的 activation `prompt` / `parent` 与旧版嵌套 `request`，保留 caller delivery、resume 句柄与取消。子日志守卫对无关系事件批写直接调用官方批量 append，对含关系事件的批写按顺序应用现有修复。TaskPilot 和 Room 用结构类型携带旧宿主需要的 parent id，rc.2 同样接受。Ankh Guard 使用 `AgentRegistry.list()` 并过滤非子代理根会话，同时为旧宿主和旧测试夹具保留 `roots()` 兜底。

内联 HTML 卡片以 `dsh-card` 注册进 `conversation.chat.markdown.fence`。流式时显示官方原代码块，settle 后挂现有沙箱 iframe；槽缺席时旧 DOM 渲染器复用同一个 iframe 生命周期。写作协议、CSP、能力桥、自动高度与链接路由不变。

接缝审计确认 `appendPluginRecord` 可写版本化、`plugin:*`、`ignorable: true` 的持久记录，不进入模型 surface。真实 JSONL 往返已验证此通道可用于后续 eval 通知与 file-preview 事实。它不能把恢复助手文本变成合法模型输入；恢复投影探针仍为 false，现有 role 降级保留。

第一轮不退役任何整包。`client-session-title-edit` 是唯一接近整包退役的候选，但要等第二轮浏览器对照验收。MCP 迁移必须保留单工具开关，且同名服务器不能双桥注册。Room、Context Lens、Transcribe、Worktrees、Local Files 和 Ankh Guard 仍有官方未覆盖的职责。

## Alternatives considered

**一次发布同时完成升版与全部能力整合。** 否决：activation/append 是兼容工作，MCP 设置迁移、工作树清理、原生 Team 和标题 UX 是不同风险与产品决策。

**抬高所有 minHost 并删除兼容分支。** 否决：activation 载荷、fence 槽、registry 与 interrupt authority 都有小且可工作的兼容路径。只有必须使用且无法降级的新 API 才能抬高地板。

**用名称或界面相近的官方功能替换整包。** 否决：Stats、Team、Speech、Forge 并未覆盖已经交付的请求明细、外部 CLI 协作、长音频分人和通用工作树管理。

**MCP 迁移时丢掉单工具开关。** 否决：官方 manager 没有单工具 allow/deny 和 OAuth。迁移必须保留已有开关或等待等价能力，且不得重复注册同名服务器。

**所有旧自定义事件和恢复助手消息都改用插件记录。** 否决：插件记录不进入模型 surface，只适合纯日志通知与事实，不适合模型可见输入。

## Consequences

兼容分支留在独立 worktree，未提交；不代表已部署生产、发布 npm、push 或删除整包。第二轮逐项写明 owner、迁移、保留行为、验收与退役门禁。MCP 单工具迁移与标题编辑退役没有被写成已完成决定。

rc.2 全量门禁和真实组合验收是最终证据边界。包兼容元数据只在相应验证覆盖后推进。干净重建不得复用 rc.1 的 TypeScript 缓存。

## Testing

已在 rc.2 完成：local-agent 59 个文件、597 项测试；local-agent-dsh 18 个文件、246 项测试；Room 62 个文件、736 项测试；TaskPilot 93 项、Ankh Guard 245 项、脚本/包规范 408 项；内联 HTML 41 项测试，覆盖槽注册、流式/settle、卸载与旧 DOM 路径。真实 SubagentRuntime 已验证兼容 activation 的成功与取消路径。真实 rc.2 Chromium 组合通过官方 fence 槽显示卡片内容，iframe 带 `sandbox="allow-scripts"`，页面与控制台错误均为 0。真实 JSONL 插件记录往返确认 `ignorable: true` 且模型 surface 节点为 0。pack-dist 的 42 项测试覆盖生成地图保留与源码目标校验；真实 Room tarball 已确认同时包含 `lib/typert.remote-client.d.ts.map` 和 `src/index.ts`。

最终 rc.2 干净全量门禁在 638 秒内通过全部 17 步：所有包测试与 42 个发布物打包均通过，包括 Remote 声明地图的源码校验。全树 hygiene 检查为 0 项发现，914 组双语记录保持一致。

## Related

- [宿主 0.2.2-rc.1 适配](2026-11-04-host-022-rc1-adaptation.zh.md)
- [第二轮能力路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [上游接缝登记处](../../../../docs/upstream-seam-registry.md)
