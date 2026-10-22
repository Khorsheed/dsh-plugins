# Agent Note:kimi 与 codex 的模型目录改从端点取词

状态:已实现

## 问题

「可用模型」添加对话框的候选词汇必须是所配端点真实供应的模型——claude-code 已验证该模式(目录 = 用解析出的凭据 `GET <baseUrl>/v1/models`,卡片「验证端点并获取模型」按钮走同一次探测)。另外两个 harness 落后:**kimi** 读作用域 `config.toml` 的 `[models.…]` 表——本地清单证明不了端点供应什么,还会把失效凭据根本跑不动的条目摆出来——而且连验证按钮都没有;**codex** 有按钮,但目录靠 spawn `codex app-server` 问 `model/list`,即 CLI 的**本地**注册表,同样证明不了中转供应什么(失效凭据还能躲在它后面)。

## 决策

两个 harness 的非原生目录路径现在都从端点取词——用解析出凭据的 `Authorization: Bearer` 头 `GET <baseUrl>/v1/models`,与验证按钮同一次探测——与 claude-code 完全一致。本地来源只保留为元数据补全。

**kimi**(`packages/local-agent-kimi`):

- `endpoint-auth.ts` 增加探测对:`EndpointServedModel` / `EndpointModelsResult` / `fetchEndpointModels` / `checkKimiEndpoint`,结构对齐 claude。解析读 kimi 自有字段——`display_name`、`think_efforts.valid_efforts` + `default_effort`(兄弟字段 `reasoning.effort.valid`/`default` 带同一份数据,读的是 `think_efforts`)、`context_length`——并容忍只回 id 的通用 OpenAI 形态中转。`KIMI_MANAGED_BASE_URL` 移入本模块(定义归属:check 与目录都需要它而不成环;provision.ts 转发导出,既有引用不动)。
- `KimiModelCatalog(context, deps)` 像 `ClaudeModelCatalog` 一样探测端点:无凭据 / 401/403 / 其他 HTTP / 形状不符 / 零模型各自折成带原因的 `unsupported` 目录(作为数据缓存);传输故障**抛错**,共享缓存因此保留最后一次成功清单。成员的 ACP runtime configOptions 仍是该成员的权威(原生短路不变)。
- kimi 特有的折叠:kimi-cli ≥2.1 要求 `-m <name>` 有对应 `[models."<name>"]` 表(2.1.1 实测:只有带 `model = "k3"` 的 `[models."kimi-code/k3"]` 时,`kimi -m k3` 报 `Model "k3" is not configured in config.toml`),所以命中某张 managed 表 `model` 的端点 id 以**表键**为候选值——即可运行名;端点的显示名/推理档位优先,表的 `display_name`/`support_efforts`/`default_effort` 补齐端点未上报的;没有 managed 表的端点 id 保持裸 id。成功应答 `customInput: false`——kimi 只跑列出的/已配置的模型,自由输入的值不可运行。
- `ensureKimiModelTables`(provision.ts)是写侧的另一半:每次写 `models.json` 后,为配置尚未建表的每个列出值追加一张 managed `[models."<value>"]` 表(最小配置的形状,目录读到的元数据随行)——添加动作在同一次写入里让该 id 可运行。幂等;配置不存在时留给 provisioning 创建。
- 卡片原样获得 codex 的验证按钮块(草稿未保存禁用 + 提示 title,判定行内展示),客户端经 gateway 接线 `checkEndpoint`(声明即降级),harness 描述符声明 `checkEndpoint`——无会话、探测**已保存**的端点。

**codex**(`packages/local-agent-codex`):

- `CodexModelCatalog.probe` 拆成 `probeNative`(app-server 主体,不变)与新的 `load`:端点抓取与原生探测**并发**(`probeNative(...).catch(() => undefined)`,只警告一次)。原生注册表认识的供应 id 带走它的 `label`/`description`/`hidden`/`reasoning`;只有端点供应的 id 以裸条目列出;端点**不**供应的注册表项被丢弃。`defaultModel` 仍是原生探测的 `isDefault` 段(CLI 的编译默认——语义不变)。失败折叠与 kimi 相同;不可达抛错不是纸上谈兵——openproxy 中转在验证当天(2026-10-22)曾短暂 500 又自愈,正是保留最后成功快照语义存在的理由。
- 卡片、gateway 接线与 `checkEndpoint` 描述符本就在;只重读了 warmup 注释(它现在预热的是一次 HTTP 探测加一次 spawn 探测)。

## 验证(对真实部署的探针,2026-10-22)

- kimi `https://api.kimi.com/coding/v1/models` 带 `Authorization: Bearer <key>` 回 200(x-api-key 也行,但发送约定取 Bearer)。当时供应:`kimi-for-coding`(think_efforts low/high/max、默认 max、上下文 1048576)、`kimi-for-coding-highspeed`(无 think_efforts)、`k3`、`k3-256k`。
- kimi-cli 2.1.1:没有对应 `[models.…]` 表时 `kimi -m k3` 失败——端点 id 不能直接跑,表键才可以。
- codex `https://openproxy.to/openai/v1/models` 带 Bearer 回 200,纯 OpenAI 形态(139 条,无显示名与档位元数据);期间一次短暂 500 后自愈——重试/保留最后成功快照的语义正为此设。
- 包测试全绿:kimi 274、codex 242;两个 `tsdown` 构建与 `pnpm check:plugins` 干净。

## 考虑过但未取

- **kimi:裸端点 id 直接做候选值,不配表。**否决:`kimi -m <值>` 按作用域配置的模型表解析,裸端点 id 没有表(kimi-cli 2.1.1 实测)——选择器会列出一跑就失败的模型。表键映射加写入时补表,才让「列表只装端点供应的」与「列表里的都能跑」同时成立。
- **codex:继续以原生 app-server 注册表为词汇。**否决:本地清单证明不了端点供应什么——被端点拒绝的凭据仍会展示一份完整选择器(claude-code 的目录笔记已有先例)。端点的应答才是唯一诚实的词汇。
- **codex:干脆去掉原生探测。**否决:只有它带推理档位选项与 `isDefault` 段(CLI 的编译默认),成员选择器的 effort 控制与 `cli-builtin` 解析层都要消费;端点的纯 OpenAI 形态两者都没有。
- **kimi:除 Bearer 外再用 x-api-key 探测。**否决:对 managed 端点实测 Bearer 已够(x-api-key 只是也行),一个头是更简单的契约。

## 影响

- 没有端点凭据的 scope,现在两个 harness 的添加对话框都带原因**空载**(kimi 此前把配置的表以 configuration 来源候选展示;codex 展示 CLI 注册表)。这正是要的诚实:不列出,就不装可跑。
- kimi 的 `models.json` 写侧现在会改作用域 `config.toml`(追加 managed 模型表)——`default_model` 之外的第一处写穿。文件对既有表保持用户权威:只有缺失的值补表,手改过的表永不被重写。
- kimi 目录的 `customInput` 翻为 false(自由输入的值不可运行);codex 保持 true(任何 id 都能经 argv 到达端点)。
- `KimiModelCatalog` 构造函数新增 deps 参数(端点解析器、fetch、ttl、warn)——内部签名;面向 gateway 的表面不变,旧家族 core 只是永远不走新路径。
- 降级的端点读取(401/403/HTTP/形状不符)作为数据连原因缓存;只有传输故障按缓存节奏重试。卡片保存凭据会经指纹化的 `endpoint-auth.json` 重键缓存,保存即重探。
