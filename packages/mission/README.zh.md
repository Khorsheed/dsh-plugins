# dsh-mission

[English](README.md) | 中文

dsh 生态的通用任务管理：**mission** 是一个工作项——状态、标签、计划数据（依赖 / 一次性定时）、attempt、不透明资源引用、产物索引、append-only 命名空间注解；**run** 是从模板批量创建的一批 mission。模板声明状态机，run 创建时冻结它，每个 mission 强制它：声明即强制——未声明的转移一律 fail loud，guard 是确定性的，且任何代码路径都不做自动转移。

里程碑 M1 交付：store、带三种内置 guard 的状态机、run 模板 lint、五桶投影、服务面（`ctx.mission`）、十二个模型工具、`dsh-mission` CLI。slash 命令与 run bundle 导出属 M2；会话 tab 属 M4。

## 工作方式

- **Run**——一个 JSON 文件（`runs/<runId>.json`），装冻结的状态机、全部 mission 及其 attempt、全部 annotation。`runs/<runId>/data/…` 是追加式运行数据树，submit 的产出落在这里。
- **Mission**——一个工作项，id 在 run 内唯一。`labels` 承载任意坐标（如 `layer=dwd`），`dependsOn` / `scheduledAt` 是计划数据。计划数据只改变投影归属——mission 永不点火；发起仍是人 / agent / 外部编排。
- **attempt 与 checkpoint 不混**——attempt 是整格重跑（`retry` 新开一个，原 attempt 不可变保留）；checkpoint 是 attempt **内**的连续推进点。两者在数据模型与 API 上不可混用。
- **Guard**——转移前置条件，内置三种，不开 seam：`file-check`（期望文件位于相对该 attempt 运行数据目录的目录下——无插值）、`schema-check`（已登记的 submission 通过 JSON Schema 子集校验）、`attested`（外部脚本或人经 `attest` 登记的 key）。
- **五桶投影**——队列视图的筛选维度，从状态机**形状**加计划数据派生：终态（无出边）→ `done`；`dependsOn` 未满足 → `blocked`；`scheduledAt` 未到 → `scheduled`；初始态（无入边）→ `ready`；其余 → `active`。
- **可释放状态**——`releasableStates` 非空即声明「本 run 有资源要释放」。`is-releasable` 回答 mission 持有的资源可否销毁，lint 负责闸的完整性（见下）。

## 安装与加载

包的唯一身份是 **`@khorsheed/dsh-mission`**，在 `dsh-plugins` monorepo 开发并从那里发布到 npm：

```sh
npm install @deepseek-ai/dsh                            # 宿主（dsh web / dsh CLI）
dsh plugin --profile web add @khorsheed/dsh-mission     # 本插件
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（裸 `mission` 挂载）合入 profile 的 bundles 层——无需手改 cordis.yml。一个 composition 只能挂载 `mission` 行 id 一次；向可能已挂载该 id 的 composition 添加前，先 `dsh --profile web --dump-config | grep mission` 确认。源码方式：clone monorepo，包在 `packages/mission`（`pnpm install && pnpm run build`）。

配置（全部可选）：`dataDir`——数据根（默认 `$DSH_HOME/state/mission`，否则 `<cwd>/.dsh-mission`）。

## 存储与并发

- 数据根：插件配置 / `--data-dir` > `$DSH_HOME/state/mission/` > `<cwd>/.dsh-mission`。
- `runs/<runId>.json`——状态与索引（run、mission、attempt、annotation）；一个 run 一个文件。
- `runs/<runId>/data/<missionId>/attempt-<N>/…`——运行数据本体。submit **追加**写入：同路径同字节是幂等 no-op，同路径不同字节 fail loud。`file-check` 的 dir 相对 attempt 目录解析。
- 并发写在 per-run 锁文件上串行（手写 `wx` 创建 + stale-pid 回收——无依赖）；每次变更都是 锁 → 读 → 改 → 临时写 → 原子改名，宿主内服务与宿主外 CLI 写同一 store 也安全。查询走 JSON 索引，不翻目录。

## run 模板（JSON）

```json
{
  "name": "content-pack-daily",
  "states": ["queued", "active", "done", "failed"],
  "transitions": [{ "from": "queued", "to": "active" }, { "from": "active", "to": "done" }, { "from": "active", "to": "failed" }],
  "missions": [
    { "id": "ods-extract", "labels": { "layer": "ods" } },
    { "id": "dwd-clean", "labels": { "layer": "dwd" }, "dependsOn": ["ods-extract"] }
  ]
}
```

状态机也可以嵌在 `stateMachine` 键下，两种写法归一化后相同。模板必须恰有一个初始态。内置 `simple` 模板（`queued → active → done | failed`）支撑零配置隐式 run：不带 run 的 `mission_create` 都落在这里（知道会话时按会话隔离，CLI 落 `default`）。

**Lint**（`dsh-mission run lint`，建 run 时同样强制执行——error 拒绝建 run）：

- *error*：`releasableStates` 非空时，凡**进入**可释放状态的转移必须带 guard——没有 guard 的释放许可是空闸；
- *warning*：存在不经任何可释放状态即可到达的终态（资源可能泄漏）；
- *error*：`schema-check` 的 schema 缺失、不可解析、或超出支持的子集（`type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties`——手写校验器，不依赖 ajv）。

`simple` 模板的 `releasableStates` 刻意为空：日常工作项不持有可销毁资源，给每个 `active → done` 挂 guard 会让零配置路径不可用。

## 模型工具

`mission_run_create` / `mission_run_list` / `mission_run_status` / `mission_create` / `mission_list` / `mission_get` / `mission_transition` / `mission_submit` / `mission_annotate` / `mission_attest` / `mission_retry` / `mission_is_releasable`。写工具走标准 `tools/pre-execute` 审批管线；调用方会话 id 以 `tool:<sessionId>` 记入 history。配套系统提示词段（`tool:mission`）向模型简述用法。**export 刻意不做成工具**——分享 run bundle 是发起类人决定（M2，仅 CLI/slash）。

## 服务面

其他插件经 `ctx.get('mission')` 消费——进程内合约，绝不为子进程或手写 JSON 文件。除工具对应的全部方法外，细粒度方法有 `setRefs`（资源标识 / 环境指纹 / sessions）、`addArtifact`、`addCheckpoint`（`ref` 只由资源持有方填；它与 `submit` 登记的同名无 ref checkpoint **合并**——绝不产生重复条目）、`annotate`、`isReleasable`。

## CLI

`dsh-mission <command>`（或 `node lib/cli.js`）；所有命令接受 `--data-dir DIR`。退出码：`0` 成功 / 可释放，`1` 失败 / 不可释放 / lint error，`2` 用法错误。

```sh
dsh-mission run create --template t.json [--id ID] [--meta JSON]
dsh-mission run lint --template t.json        # error 拒绝；有 error 时退出码 1
dsh-mission run list
dsh-mission run status RUN_ID                 # 五桶投影表
dsh-mission create [--run ID] [--id ID] [--title T] [--label k=v]... [--depends-on a,b] [--scheduled-at MS]
dsh-mission list [--run ID] [--bucket B] [--label k=v]...
dsh-mission get MISSION_ID [--run ID]
dsh-mission transition MISSION_ID TO [--note N] [--run ID]
dsh-mission submit MISSION_ID [--file SRC[:DEST]]... [--json JSON | --json-file F] [--checkpoint NAME] [--run ID]
dsh-mission annotate MISSION_ID --ns NS --payload JSON [--run ID]
dsh-mission attest MISSION_ID --key K [--note N] [--run ID]
dsh-mission retry MISSION_ID [--run ID]
dsh-mission is-releasable MISSION_ID [--run ID]   # 退出码 0/1，供销毁脚本使用
```

## Compatibility

- npm release line（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅——store、状态机与 guard、lint、五桶投影、服务面、模型工具、CLI 在发布版宿主上全部可用。
- source line（deepseek-harness master，fork 或 upstream）：✅——同上。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：slash 命令属 M2，且需要交互式 UI adapter（web/TUI）——headless profile 将没有 slash，工具、服务面、CLI 不受影响；会话 tab（M4）仅 web。两者在本线尚不存在。

## Known Limitations and Deferred Work

- **模板是 JSON 不是 YAML**——提案示例用 YAML，但 v1 在依赖决策落定前不引入 YAML 依赖；两种形式描述同一文档模型。
- **`retry` 天然不幂等**——每次调用都真实新开一个 attempt。其余所有写操作幂等（相同参数重复提交 = no-op）。
- **锁对 pid 复用是尽力而为**——stale 锁在 pid 已死或锁龄超 60 秒时回收；窗口内 pid 被复用最多等到 10 秒锁超时。在预期写密度下足够；存储层可换 sqlite 而不动数据模型。
- **每个模板恰一个初始态**——mission 的起点必须无歧义；终态数量任意。
- **M2/M4 范围**——slash 命令、bundle 导出（含泄题闸与 expectedNs 完整性报告）、web 会话 tab 已在提案中设计，此处刻意缺席。
