# Agent Note: 让"默认"自解释（目录默认 + 最近实测）

Status: implemented

[English](2026-09-13-model-default-visibility.md) | 中文

## Problem

prod 上 codex 成员的作曲器 chip 只显示一个光秃秃的"默认"，设置卡也说不出 CLI 默认到底是哪个；claude 成员则会永远显示"默认"（claude 没有枚举面，这是刻意的）。两个诚实的数据源一直闲置：codex 的 `model/list` 用 `isDefault` 标记账号内置默认（实证：gpt-5.6-sol），而每个 provider 的委派记录都带着 `observedModel`——上次实际跑的是什么。

## Decision

**核心表面。**`LocalAgentModelInfo` 新增 `lastObserved`——harness 内存委派记录里最新的 `observedModel`（`latestObservedModel(provider)`，时序用内存单调戳而不是改 `delegations.jsonl` 的 schema）。gateway 填充：`memberModel` 取成员自己的记录，`harnessModel` 取该 provider 全量最新。`cli-builtin` 来源的文档改为：自身不命名任何东西，但目录可能命名它，记录也能显示上次跑了什么。

**codex。**目录探测保留第一个 `isDefault` slug（hidden 项也算——hidden 是不列出，不是不可跑）；broker 层级变为 覆盖 → 委派 → 设置 → 作用域配置 → 目录默认，当答案来自目录时 source 为 `cli-builtin` 且 `effective` 有值（这一层唯一能命名模型的情形）。apply 后 1.5 秒的后台预热（unref、dispose 时清除）触发探测，第一次打开设置卡通常命中热缓存——回应"codex 要等一会才能拿到"。

**UI。**作曲器 chip 有 effective 就显示它（codex 现在直接显示 gpt-5.6-sol），否则用 lastObserved 显示 `默认（最近 <model>）`，再否则光秃"默认"。四张设置卡在占位文案和生效行两处走同一条链：设置 → 作用域配置 → 目录命名的 CLI 默认 → 最近实测的内置默认 → 光秃内置默认。claude 没有列表（没有诚实来源），但任何一次运行之后两个表面都会显示 默认（最近 …）——一个实证答案，而不是一个谜。

## Alternatives considered

**给委派记录持久化时间戳。**否决：为一个展示层的小改进动 `delegations.jsonl` 的 schema 不值；内存戳在启动回放时保持"最后一行赢"。

**给 claude 从二进制内嵌常量造目录。**再次否决：不是受支持的面。

## Consequences

每个能知道的表面上"默认"都自解释了。代价：启动 1.5 秒后一次后台 app-server 进程（codex），registry 一张单调戳表。测试：核心 +9（delegation 4、gateway 5），codex +10（目录 3、broker 3、apply 1、卡 3），作曲器 +3，kimi 卡 +1。
