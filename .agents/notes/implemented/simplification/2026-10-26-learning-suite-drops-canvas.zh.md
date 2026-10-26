# Agent Note: Learning suite drops the canvas

Status: implemented

## Problem

2026-10-19 画布加入了 `@khorsheed/dsh-learning-suite`（一条 `canvas` 根行，加上 `preset-dsh-learning` 行里的 `canvas-agent` 授予），让学习者把读到的东西写成画布卡片。2026-10-26 这一波发布，用户把 canvas、canvas-novel、datasets、eval、lab 留下不发——遗留问题太多。套件只要 npm 依赖一个未发布的成员就发不出去，而学习套件是受影响的模式包里仍要发的那一个。

## Decision

学习套件带四个成员：library、reader、transcribe、capture。`canvas` 根行、`canvas-agent` 授予、npm 依赖、`dsh.bundle.members` / `dsh.references`、`FAMILY_MEMBERS`、locale 描述和中英 README（成员表、画布功能一节、开头总括、示例说法）都去掉了它。版本保持 0.1.0（从未发布），CHANGELOG 记一条。

没有别的东西依赖画布在场：library 与它没有代码依赖；灵感空间的「同步到画布」按钮在画布服务缺席时自动隐藏（`packages/reader/src/client/contract.ts`）。灵感空间 README 只把这个按钮留作「装了画布才有」的一句从句。

带着这些留下的包的写作套件、评测套件这一波也不发；已发布包的 README 不再在「其他套件」里列它们。

## Alternatives considered

**画布照样跟学习套件一起发。** 用户否决：画布这一波还有未解决的问题，而套件成员会装到每个学习者那里。

**学习套件也留下不发。** 否决：画布只是学习主线（图书馆 + 灵感空间）的附加步骤，去掉它主线不受影响。

**保留 `canvas-agent` 授予，让单独装的画布在学习会话里亮起来。** 暂不采用：授予行会让套件引用一个未发布的包。画布发布后，把行和成员加回来就是回头路。

## Consequences

画布发布前，学习者在学习模式里少了「写成卡片」这一步，灵感空间的同步到画布按钮对他们保持隐藏。换来的是套件能独立发布，没有悬空依赖。加回画布是对称的改动：根行、授予、依赖、成员列表、README 一节。
