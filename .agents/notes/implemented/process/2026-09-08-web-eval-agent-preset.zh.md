# Agent Note: web-eval 的 agent 预设随 pack 分发，以及它仍然够不到的那几个工具

Status: implemented

## Problem

[冻结决策 12](../../../../profiles/web-eval/README.md#冻结决策) 说评测装置的销毁路径唯一：只有编排器持有 docker socket，评测实例的 agent 预设不挂 Bash 与 docker。到 I2 为止，这条决策只是一句话。实例跑的是随发行版的 `standard` 预设——功能完整的编码 Agent，Bash 在内——因为那是 `@deepseek-ai/dsh-web-app` 钉的名册默认值。

I2 在宿主上直跑，没有容器边界，风险到此为止：顶多弄脏一个真实 home。I3 把 docker socket 交给编排器，每个单元都进 `lab` 的释放闸，这时 agent 目录里的一个 shell 就是同一个房间的第二扇门：跑到一半 `docker rm` 一下，或者往已归档的单元里写一笔，「没有单元能绕过 file-check 被释放」就不再是装置的性质，只是 agent 的自觉。

预设也是这条决策**唯一**能落的地方。Web 面把所有模型可见的行都搬到了 agent 平面：`packages/bundle/web-app/cordis.patch.yml` 在 profile 根上把 `tool-bash`、`tool-fs`、`tool-skill` 等一律 disable，改由每个会话自己挂预设。所以 profile 自己的 `cordis.patch.yml` 根本没有 shell 行可 disable——shell 是随会话挂的那个预设来的，想要没有 shell 的 pack 就得自带一个预设。

## Decision

pack 自带 `profiles/web-eval/presets/eval/`（`agent.cordis.yml` + `preset.yml`，显示名「评测模式」）。它的组成表是随发行版 `standard` 减去两类行：

| 去掉的行 | 类别 | 为什么 |
|---|---|---|
| `tool-bash` / `tool-pwsh` | 执行宿主命令 | shell 本身——决策 12 的字面 |
| `tool-workflow` | 执行宿主命令 | workflow 脚本是**模型写的 JavaScript**，在 Node worker 线程里当作 async 函数体执行（`packages/workflow/workflow-worker-thread`），一个动态 `import` 就够到 `node:child_process`，全程没有 shell |
| `workflow-worker-thread` | 执行宿主命令 | `tool-workflow` 需要的引擎；本组成里没有别的行消费 `ctx.workflowEngine` |
| `tool-ralph` | 执行宿主命令 | 驱动同一个引擎；一个 64 轮自走循环也不是规划 agent 该有的 |
| `plan-mode` | 词汇冲突 | 它的提示词规划的是**实现**并明令不要写文件，而这个 agent 的产出恰恰是写到盘上、交人批准的 `dataseek.plan/1`。一个会话里两个「plan」是混淆，不是能力缺口 |

留下的是读、起草，以及委派给**跑在同一个预设上**的 agent：进程内子 agent 继承父 agent 的预设（宿主的 `packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` 断言的正是这条），所以 `subagent` 与 `subagent_fork` 递不出父 agent 本身没有的 shell。`tool-fs` 保留 `write` 与 `edit`，因为这个 agent 的交付物**就是**文件，而写文件不执行任何东西；`glob`/`grep` 留着，因为它们经 `ctx.subprocess` 起随包的 ripgrep 二进制，不从模型手里接命令。

docker 从来不需要删：`@khorsheed/dsh-lab` 一个模型可见工具都不注册，容器动作全在编排器的服务面。

**预设归 pack**，理由与当初把 `cordis.patch.yml` 收归 pack 的一样（见[评测 pin 的 Agent Note](2026-09-07-web-eval-pins-belong-to-the-pack.zh.md)）：它是装置不是偏好，人对它的改动不该在一次 update 之后静默存活。`install.sh` 在 `PROFILE_FILES` 旁多了 `PRESET_IDS`，`update.sh` 在 `UPDATE_FILES` 旁多了同一份清单；两者都把 `$DSH_HOME/.agent-presets/<id>` 整目录替换。目的地在 profile 目录**之外**，因为预设名册按 `$DSH_HOME` 组织而不是按 profile——于是卸载 profile 不再等于清掉安装器写过的全部东西，两份 README 都在 `rm -rf` 旁边说了这件事。

`cordis.patch.yml` 钉名册默认值：

```yaml
- id: agent-presets
  config:
    default: eval
```

patch 的 `config` 覆盖是整值**替换**而不是深合并（`vendor/include` 的 `applyEntryPatches`：`target[key] = value`）。这里替换掉的是 web-app bundle 写的 `{default: standard}`，它不含别的键，所以什么都没丢：`roots` 由 `apps/cli` 的 `composeProfile` 在其后写入——它把随发行版的预设根作为最后一层 overlay 追加——而 `includeUserRoot` 保持 schema 默认 `true`，那正是 pack 刚把预设装进去的那个根。

### 这个预设够不到的

预设只能过滤自己挂的行。四个委派工具由各 provider 自己的 bundle patch 装在 **profile 根**上（`tool-subagent-kimi`、`tool-subagent-codex-local` 以及 claude-code 与 dsh 的同款，都是 `@khorsheed/dsh-local-agent-tool-subagent` 的实例），而它们按构造就是执行类：每一个都在宿主上起一家 CLI，沙箱档位按[冻结决策](../../../../profiles/web-eval/README.md#冻结决策) 3 放开。新装实例里看得到三个——`subagent_codex`、`subagent_claude_code`、`subagent_kimi`；`subagent_dsh` 要在「设置 → 本地 Agent」里打开 DeepSeek 开关才出现，默认是关的。

三条可选路径，本次都没走：

1. **给 `@khorsheed/dsh-local-agent-tool-subagent` 加工具注册配置**——`datasets` 与 `mission` 拿到 `tools` 分组的那套（T12/T13）。这里每行只注册一个工具，所以这个旋钮是开关而不是分组清单（`tools: all | none`，或 `registerTool: false`）。provider 行照挂，编排器的委派路径与 `/codex login` 都不受影响。代价是改包并发版。
2. **在 pack 的 `cordis.patch.yml` 里给那四个工具行加 `disabled: true`**——不改包，且只 disable 工具行、绝不碰 provider 行；web-app bundle 把工具搬上 agent 平面用的就是这一手。走之前要先确认一件事：编排器的委派走的是注册在 `ctx.subagents` 上的 provider，而不是模型可见的那个工具。
3. **在预设里挂一行作用域限制**，调 `ctx.tools.restrict({ deny: [...] })`。这条可行，也是「预设挑不掉 profile 层工具」的通用解：`restrict()` 拒绝无作用域的 context，而 `mountPreset` 恰好把组成挂在这样一个作用域下，所以 `agent.cordis.yml` 里的一行可以按名字为该预设的每个 agent 拒掉继承来的全局工具。代价是新开一个包，且被拒的名字不存在时它会 fail loud——没装 codex provider 的实例会挂不起这个预设。

预设机制本身的两条边界，与其以后撞上不如现在写下：

- **这条钉的是默认值，不是可达集。** `composeProfile` 无条件把随发行版的预设根作为最后一层 overlay 写进 `roots`，所以 标准 / 代码 / 极简 / cordis 一直在名册上，profile 层删不掉。人可以把一个空白会话改成「标准模式」，Bash 就回来了。决策 12 针对的是 agent 误操作，而 agent 没有切换自身预设的工具——选择是人的动作，日志记为 `agent-preset/selected`。
- **`run_code` 按设计就限不住。** `tools.restrict()` 拒绝命名保留的 Code Mode 传输，而 Code Mode 的程序同样是 Node worker 里的 async 函数体，够到的东西与 workflow 脚本一样。它现在不在，是因为 `tools.mode` 默认 `native` 且本 profile 不改它。评测实例上不要设 `DSH_TOOLS_MODE`；等按会话选 Code Mode 落地，这条就成了活问题。

## Verification

在一个一次性 `$DSH_HOME` 上做全新源码模式安装（`install.sh --source <检出> --fresh`，23 个 `@khorsheed` 成员，160 条 patch 行），在空闲端口上启起来，然后经 `capability-catalog` 的 snapshot Remote 问它自己的目录——那个接口读的是默认预设 standing scope 下的 `ctx.tools.schemas()`，即这个预设上的 agent 真正看得到的清单：

- 39 个工具，**没有 `bash`、没有 `pwsh`、没有 `terminal_*`、没有 `str_replace_editor`、没有 `run_code`，也没有任何容器类工具**。
- `datasets_*`（`authoring` 组）、`mission_get` / `mission_list` / `mission_run_list` / `mission_run_status`、`eval_conditions` / `eval_plan_validate` / `eval_run_status` 全在——工具按域开放那张表照旧成立。
- 同一个实例加一行 `--patch` overlay 把默认值改回 `standard` 再启，是 43 个工具。差集恰好是 `bash`、`exit_plan_mode`、`ralph`、`workflow`——正是这个预设去掉的四个，两个方向上都没有别的差异。
- 对已安装的预设手工改一笔再跑 `update.sh`，它被逐字节还原。

## Alternatives considered

**把预设留给操作者自己做（在界面里复制 `standard` 再改）。** 否决：那样决策 12 就成了习惯而不是文件。手工做出来的实例无法从 pack 复现，漂移没人发现，而且新机器上第一次会话之前，名册自己的复制路径根本还够不着。

**把预设放在 profile 目录下**（`$DSH_HOME/profiles/web-eval/presets/`）。否决：`dsh-agent-presets` 扫的是 `$DSH_HOME/.agent-presets`，名册按设计就是按 home 组织的，loader 找不到的预设不是预设。代价是卸载变成两条 `rm -rf`，两份 README 都写了。

**不写预设，改在 `cordis.patch.yml` 里 disable `tool-bash`。** 否决，因为没有东西可 disable：web-app 面已经在 profile 根上把那一行关掉了，shell 只经预设到达模型。正是这条事实让预设成为唯一执行点，也正是因此 pack 必须带一整份组成而不是一行 patch。

**顺手把四个 `tool-subagent-*` 行也 disable 掉。** 本次否决，理由记在上面的第 2 条。委托这次改动的任务书把 patch 层 disable 这根杠杆留给一次经过考虑的决定，而不是 T21 的副作用；而且这条路只有在确认编排器走 `ctx.subagents` 的 provider、不走模型可见工具之后才安全。悄悄删掉这四个工具还会改变**人**在 tab 里能做什么，那与 agent 能做什么是两个决定。

**保留 `tool-workflow`，只去掉 shell。** 否决：workflow 脚本是 Node worker 里模型写的 JavaScript，留着它等于让决策 12 字面成立、事实不成立。同样的推理连带退掉了为它服务的 `ralph` 与引擎。

**连 `tool-fs` 的 `write`/`edit` 也去掉，做一个严格只读的 agent。** 否决：这个 agent 的交付物就是文件——`plan.json`、`condition.json`、分析初稿——而写文件不执行任何东西。释放闸是对已归档单元的 file-check，不是对 agent 工作目录的检查；一个只读 agent 需要另一条把产出交给人的路，那比决策 12 要求的改动大得多。

**基于 `minimal` 而不是 `standard` 裁剪。** 否决：`minimal` 组的是**常驻 PTY** shell 加一个裸本地文件系统——离这个预设的需求更远而不是更近；而且它固定的 `complete: true` persona 会把分析期要读的运行时上下文一并去掉。

## Consequences

- 决策 12 的前半段成了一份会自我安装的文件；后半段——profile 根上的委派工具——被写下来并附了三条估过价的关闭路径，而不是等 I3 现场发现。
- 这个预设是随发行版组成的**副本**，上游对 `standard` 的改动不会传过来。宿主一动就要重新 diff 两份文件；副本的文件头点名了它的来源，正是为这件事。
- 卸载 pack 现在有两条路径（`profiles/web-eval` 与 `.agent-presets/eval`）。留着预设无害——没有 profile 把它钉成默认，它只是名册上多一项——但「一条 `rm -rf` 清掉安装器写过的一切」不再成立。
- 想在评测实例上用自己那套组成的人，请另起一个预设 id：`eval` 在每次 install 与 update 时被整体替换，与 `cordis.patch.yml` 完全一样。
- 实例的 agent 现在对「帮我跑一下」的回应是请人来跑，而不是发一次工具调用。persona 直说了这件事，于是这一轮花在提出请求上，而不是花在发现工具不存在上。
- fs 工具仍然听宿主的沙箱策略，而这个预设不改它：预设文件本身就是盘上的普通状态，那条策略允许什么，也就允许在那里改什么。要堵这个是沙箱的问题，不是预设的问题。

## Related

- [web-eval 的评测 pin 归 pack](2026-09-07-web-eval-pins-belong-to-the-pack.zh.md)——同一条归属论证，低一层。
- [web-eval 安装的源码模式](../feature/2026-09-04-web-eval-install-source-mode.zh.md)——本次扩展的那个安装器。
- [profiles/web-eval/README.md](../../../../profiles/web-eval/README.md#冻结决策-12-的执行点eval-预设)——面向操作者的一节，含怎样确认运行中的实例正在用这个预设。
- [web-eval 迭代计划](../../../../profiles/web-eval/docs/iterations.md)——I3 · T21。
