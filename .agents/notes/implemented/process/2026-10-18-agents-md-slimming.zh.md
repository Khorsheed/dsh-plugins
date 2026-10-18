# Agent Note: AGENTS.md carries rules only; rationale lives in the owning docs

Status: implemented

## Problem

仓库根的 AGENTS.md 会被宿主的 agent-instructions 包逐字注入每个会话(`Instructions from: …/AGENTS.md`),持久留在会话历史里,并随每个请求一起发送直到压缩——压缩之后宿主还会按设计重新注入。它已膨胀到 20,852 字节,规则、事故叙述和机制解释混杂,因此本仓库的每个会话都在反复为这份全文付费(context-lens 历史视图显示每条 baseline 的插件注入约 20.7k)。大部分体积与 docs/development.md、docs/ops.md、docs/panel-design.md、docs/plugin-visibility.md、docs/publishing.md 及各 checker 脚本已覆盖的内容重复——文件一边指向这些文档,一边复述它们。

## Decision

AGENTS.md 保留全部操作性规则与全部节名(脚本和 Agent Note 引用了 "Package conventions"、「推送与分支保护」、「构建卫生」等),删去理由、事故史与机制叙述。每条规则只留一个事实,每个深话题只留一个指针;checker(`check:plugins`、`check:panels`、`check:hygiene`)仍是机械执行者,对应文档仍是理由的权威出处。删节内容在移除前逐一确认过去处:事故叙述在各自的 Agent Note(如 2026-10-17-host-021-invariant-sweep、2026-09-30-local-agent-tool-fold),执行细节在 `scripts/check-plugin-independence.ts`,流程在 docs/。结果:20,852 → 13,314 字节(-36%)。

## Alternatives considered

- **调小宿主注入预算(`maxBytes`)。** 宿主截断时会优先整文件省略最宽泛的指令文件,这会先砍掉部署全局的 `$DSH_HOME/AGENTS.md` 而不是本文件,且对所有项目一刀切。否决:问题在本文件的体积,不在预算。
- **把 AGENTS.md 拆成按主题的指令文件。** 宿主的发现候选是固定的(`AGENTS.md`/`CLAUDE.md` 加 local 覆盖层),拆出去的文件根本不会被注入。可行的拆分就是本次采用的:规则留这里,理由进 docs/。
- **不动,靠压缩兜底。** 压缩最终会遮蔽 baseline,但宿主按设计会重注,而压缩前的每个请求都照付全价。

## Consequences

本仓库每个会话少携带约 7.5k 字节的注入指令,压缩后的重注也同比变便宜。代价:agent 需要顺指针去读理由,文件读起来更密——可接受,因为它的读者是执行规则的 agent。部署全局的 `$DSH_HOME/AGENTS.md`(约 4k)是另一个更小的目标,本次未动。context-lens 日志重建通道不应用压缩遮蔽(导致重注的 baseline 显示为 ×2 重复)是查看器侧的独立缺口,与本次改动无关,仍未修。

## Related

- [Development base is the latest local HEAD, not origin/main](2026-10-12-base-on-latest-head.md)
