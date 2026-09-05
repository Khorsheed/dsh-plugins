# Agent Note: local-agent 评测生效设置快照

Status: implemented

[English](2026-09-04-local-agent-eval-effective-settings.md) | 中文

## 问题

web-eval profile 的公平性冻结基线（决策 2 到 4：全 exec 驱动、容器侧的审批边界、每家显式的推理强度）要求每个 harness 当前生效的设置进入评测的条件哈希。此前没有任何东西能读到它们：各 provider 的旋钮散在各自的配置面里，kimi 的推理强度写死在预置代码里（`high`），status 面只报认证事实。评测者只能相信两个条件格之间的差异恰是声明的因子——而这正是条件哈希要消除的信任。

## 决策

- core 的 `LocalAgentHarness` 契约新增可选的 `effectiveSettings()` 声明；注册表经只读的 `effectiveSettings(name)` 方法按名解析，两个 status 面——`/<harness> status` 回复与 `LocalAgentStatus` Remote——以增量可选字段附带快照，既有客户端不受影响。
- 快照形状（`LocalAgentEffectiveSettings`）是封闭词汇的纯 JSON：`drive`、`sandbox`/`permissionMode`/`autoApprove`（各 harness 自己的边界词汇）、`reasoningEffort`、`baseUrlSet` + `baseUrlHost`（只报主机名，绝不报完整 URL——其路径可能携带准凭据段），以及预留的 `cliVersion`。凭证永不进入类型。harness 没有的旋钮字段缺位，缺位是刻意的：它是诚实的条件哈希输入（「dsh 无限制」表现为没有边界字段，而不是发明一个值）。
- 快照是实时读，不是配置回声：kimi 与 codex 读各自作用域的 `config.toml`（effort、端点、kimi 的 `Bash(*)` 放行规则——用预置闸所用的同一子串检测），claude-code 复刻 provider 自己的解析顺序（配置 `baseUrl` 优先于 `ANTHROPIC_BASE_URL`），drive 取自 live 设置偏好。人改过的作用域配置报改过的值——真正会跑的才是被哈希的。
- kimi 的 `thinking.effort` 离开预置硬编码，成为 `thinkingEffort` 配置项（默认 `high`，即原硬编码值）。它只在预置期生效，与被镜像的 model 完全一致：已存在的 config 永不覆盖，快照读文件而非配置项，两者永远不会无声分歧。
- 不加 CLI 版本探测：探测意味着 status 时拉起所有 CLI。`cliVersion` 字段预留，后续探测纯增量落地。

顺带把 kimi apply 路径的权限引导改为链在 config 预置之后。两者此前并发 fire-and-forget；在全新 home 上引导可能读到 ENOENT 而早退，`Bash(*)` 放行规则直到下次重启都写不进去——首次启动的委派回答但不执行工具。链式化让引导注释（「预置会带着规则写出」）从愿望变成事实。

## 延伸：已配置模型进入快照

web-eval 的条件契约要求 `model.declared`，就绪检查要把声明与各轮真正会跑的模型比对——快照因此增加可选的 `model` 字段，读取纪律与其余字段相同（实时读、各读各家配置面）：kimi 读作用域 config 的顶层 `default_model`，codex 读作用域 config 的 `model`，claude-code 读作用域 `settings.json` 的 `model`，dsh 读无头子 dsh 所继承的宿主 `agentDefaultModel.currentSelection()`（格式 `provider/model`）。缺位规则不变且是关键：harness 没有点名的模型绝不代填猜测的默认值（claude 的默认模型归 CLI 所有；dsh 读不到选择就什么都不报）——就绪检查要么比对真实配置值、要么检测到缺位，绝不能比对一个编造值。读取使 local-agent-dsh 增加对 `@deepseek-ai/dsh-agent-default-model` 的可选 peer 依赖（仅类型；服务在运行时仍可选，缺位降级为字段缺位）。不加模型选择、不加 CLI 参数、不改任何默认行为——本节只是读取侧。

## 已考虑的替代方案

**只报插件配置值（回声而非实时读）。** 否决：mirrored-config 路径意味着配置项与作用域文件经常分歧（用户真实 config 被镜像进来时不带任何 effort 键）；快照报配置项等于哈希一个各轮从未使用的值。

**跨 harness 统一的 `permissions` 字符串。** 否决：要么把 codex 的沙箱词汇塞进 claude 的权限槽，要么造一个谁的 CLI 都不讲的伪词汇（`sandbox:workspace-write`）。跨 harness 的归一化归评测条件契约所有；快照报各 harness 自己的词，可回溯到产生它的配置。

**现在就做每条件 effort 覆盖（I4 的参数化模型）。** 按迭代计划不属本期：I3 钉词汇，I4 让 provider 接受每条件的模型参数。让 effort 可配置（而非每条件）是保持默认冻结前提下的最小去失控步骤。

**配置读取器上深度 TOML 解析。** 否决：既有 `readKimiBaseUrl`/`readCodexBaseUrl` 的行扫描已按 section 感知且零依赖；解析器依赖（或手写文法）给诊断路径加攻击面。新读取器沿用同一形状，包括键缺位时诚实的 `undefined`。

## 后果

- 条件哈希的公平性输入可被评测器、status 面与运行 `/kimi status` 的人在运行时读到；两格只差一个因子是可检查的，不是可声明的。
- 快照是证据，不是强制：人在 run 中途改作用域 config 改变的是下一次读，不是已记录的条件。编排器必须在条件预置时拍快照、run 启动时复读以检测漂移。
- provider 侧词汇增补（新的边界种类、版本探测）是增量可选字段；消费方对对象做 `JSON.stringify` 哈希，字段顺序无关，但加字段会改哈希——可接受，因为条件哈希变化必须意味着声明因子的变化，而这些字段本就是声明因子。
- kimi 的 `thinkingEffort` 只抵达全新 home；评测实例必须在首次启动前让 profile patch 层带着期望的 pin 预置作用域 home，事后改 pin 需要重新预置 home。
- 测试确定性：kimi spec 把 `os.homedir()` 钉到没有真实 `~/.kimi-code/config.toml` 的位置，否则 mirror 路径会把开发机的真实配置复制进每一条 fresh-home 断言。
