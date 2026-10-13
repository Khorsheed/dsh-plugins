# Agent Note: capability-catalog 完备性证据与纯数据生产面

Status: implemented

## Problem

协作层跑的实验里，成员在**别的容器**里执行，因此目标侧必须产出能力组合的**证据**——另一个进程可以核验的数据——由 eval 消费。目录此前唯一的指纹路径是 Remote 动词对 `snapshotAt`/`snapshotFor`，它们按设计会**挂载**一个 preset 的 standing scope 作为副作用（roster 的 single-flight standing mount）——目标侧生产者为了一次测量不该付这个代价，而在没有 cordis 组合的裸进程里这条路径根本不存在。更糟的是 snapshot 没有完备性合同：发现失败时保留部分结果（读取抛错的 scope 被跳过、注册表自己的 `complete: false` 信号被忽略、读不出的技能体静默地以 `null` 进摘要），消费方无法区分「确认是空的」（扫过了，零发现）与「没装 / 没读成」——一份空摘要与一份完整摘要无法区分。

## Decision

一切演进都是增量且通用命名的（代码、类型、注释、文档里不出现协作词汇）；版本保持 0.1.98；Remote 动词的 wire 形态逐字节不变。

- **snapshot 上的逐节完备性**（`src/types.ts`）：增量可选字段 `completeness`，为 snapshot 覆盖的每一节（skills / tools / mcpServers / channels）各带一个 `{ state: 'complete' | 'partial' | 'unavailable', reason? }` 描述符。`complete` = 扫完且发现的全部在内（零发现也是 complete-with-zero，与失败可区分）；`partial` = 部分来源失败、行只是子集，`reason` 点名失败的来源**类别**（绝不带秘密内容，也不带可能含路径的错误原文）；`unavailable` = 该节根本不可测（未安装 / 读取失败 / 无权限）。与 `sha`、`preset` 一样，该字段不进入 `hashOf` 摘要的规范形（测试钉死）。
- **行被采集时的健康度**（`src/skills.ts`、`src/remote.ts`）：`collectSkills` 填一个可选的 `SkillsCollectionReport` 出参袋——尝试/失败的 scope 读取数、注册表自报的发现不完整（harness 的 `complete: false` 信号，此前被忽略）、指纹模式下读不出的技能体数——`catalogSnapshot` 接受配套的 `report` 袋。Remote 动词从不传它，所以它们的行与摘要不变。
- **一份工具侧读取实现**（`src/tool-face.ts`）：服务的三个私有读取（可见 schema、origin 标记、按前缀推导的 MCP server 名）抽成共享 helper，服务改为委托，行为逐点保持（`schemas()` 抛错仍从动词透出；同样的告警照常打）。证据生产方走同一个模块读取，因此动词/证据对等是构造上的，而不是两份拷贝今天恰好一致。
- **生产面**（`src/evidence.ts`）：包根 `produceCapabilityEvidence(options)`——输入全部显式（调用方已核验的 `presetId`；绝对 `workdir`，相对路径拒绝；可选的调用方声明 `revision`；可选的已解析不透明 `scope`，只**透传**给读取，这里绝不解析也绝不释放；`skills` / `tools` 注册表切片；基线差分集合；**必填**的 `coverage` 覆盖声明；可选告警汇）。返回 JSON 安全的纯数据：`measurement`（`kind: 'preset-composition'` + presetId/workdir/revision）、`sha`（由动词同款的 `catalogSnapshot` 指纹调用钉出）、四节描述符、以及原样回显的 `coverage`。API 没有 roster 参数、也不收 cordis Context，因此**不可能**挂载 standing scope 或注册服务；抛错的 `tools.get` 降级为读不到的 origin 标记（一个 partial 节）而不是让测量失败；mcpServers 描述符继承 tools 节的状态（它由 tools 推导），channels 继承 skills+tools（它是二者的汇总）。依赖纪律：node 内置加本包既有依赖，仅此而已——发布的 tarball 即目标侧运行时（已验证：pack-dist → 解包 → 裸 node 导入 → 对 fixture 运行）。
- **消费方合同**（两份 README 新增的接缝节）：摘要算法归**本包**所有——消费方绝不重算；任何 `partial` / `unavailable` 的节一律按「未核验」处理——既不当作完整，也不当作「该节为空」。该节同时重申 Remote 动词的 standing-scope 挂载代价：仅限本机使用，行为不变。
- **测试**（`tests/evidence.spec.ts`，新增 19 个）：完备性矩阵（干净扫描 → complete，含零发现；注册表自报不完整 / 技能体读不出 / origin 标记读不到 / 被守卫的 `get` 抛错 → partial，reason 点名类别；服务缺席 / 唯一 scope 读取失败 → unavailable）；「确认是空的」与「读取失败」的区分（缺席的 skills 与空 skills 摘要**相同**——只有描述符能区分二者，这正是要点）；与 `snapshotFor` 路径在同一 fixture 上的摘要对等；测量元数据不进摘要；探针钉死生产只触碰传入的切片（不透明 scope 原样透传；无挂载、无注册）；JSON 往返；输入拒绝；report 管道本身；`completeness` 随 snapshot 而不进摘要。

## Alternatives considered

- **加一个返回证据的 Remote 动词变体**：否决——服务上的任何动词都骑在一个已经付过组合代价的 Context 上，而目标侧是裸进程；这个动词要么挂载（正是要避开的副作用），要么把降级策略复制一份。一个没有 roster 参数的纯函数在构造上就无法挂载，这比一句「不会挂载」的文档更强。
- **把 snapshot 行也放进证据包**：合同列的就是四样（摘要、完备性、测量对象、覆盖声明）；带上行会诱使消费方用行重算摘要——正是合同禁止的那件事（重实现的算法会漂移），还会让工具参数 schema 撑大 JSON 边界。
- **让完备性进摘要**：被对等要求否决——证据摘要必须等于同一批注册表上 `snapshotFor` 的摘要，两个进程才能比对；完备性是关于**测量**的元数据，随行记录在摘要旁，不是能力。
- **不把 origin 标记降级算进完备性模型**：channel 进摘要，标记读不到就退回启发式归因，因此部分启发式的 tools 节如实是 `partial`。既有的「`get` 缺席」降级保持 `complete`，因为那就是本地动词在这种注册表上自己的答案——证据不能与它对声称等的动词相矛盾。
- **多 scope 的证据读取**：动词只读一个 scope（`[scope]`），生产面照此。report 管道与 partial 措辞保持通用（多个 scope 读取中失败一个子集），因为 `collectSkills` / `catalogSnapshot` 是共享的，但生产面与服务一样只传一个 scope。

## Consequences

- 新公开面：`produceCapabilityEvidence` 及 `ProduceCapabilityEvidenceOptions` / `ProducedCapabilityEvidence` / `CapabilityEvidenceMeasurement` / `CapabilityEvidenceCoverage` / `CapabilityEvidenceCompleteness`；`CatalogSectionCompleteness` / `CatalogSnapshotCompleteness`；`RegistrySlice` / `SkillsCollectionReport` / `CatalogToolsSlice` / `ToolSchemaLike` 类型从包根再导出；可选的 `CapabilityCatalogSnapshot.completeness` 字段。版本保持 0.1.98。
- 服务的工具侧读取现在住在 `src/tool-face.ts`，服务委托过去；动词的可观察行为不变（告警与抛错行为保持）。
- 全部 284 个既有测试原样通过（总计 303，新增 19）；没有编辑任何既有期望。
- tarball 已验证：pack-dist 0.1.98 → 解包 → 裸 node 导入包根解析出生产面并对 fixture 运行（摘要形态正确、完备性正确、JSON 往返一致）。
- 这个形状就是 eval 消费的合同：比对 `sha`，要求每一节都是 `complete`，并拿 `measurement` / `coverage` 对期望的组合。
