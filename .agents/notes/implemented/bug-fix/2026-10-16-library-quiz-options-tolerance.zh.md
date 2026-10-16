# Agent Note: 图书馆——选择题选项容忍 { label } / 字母键写法（选项消失 bug）

Status: implemented

## Problem

3080 真实会话（【新建数学项目并添加微积分读本】）存入的选择题在学习者侧只剩题干、没有选项。模型写的是 `options: [{ label: "A) …" }, …]`（label 对象数组）；`normalizeQuiz` 只保留字符串项，把选项静默丢光；写入侧校验又因为答案带字母前缀（`A) …`）被 `choiceOptionIndex` 按字母放行，全程没读选项。静默丢弃 + 字母捷径 = 一张永远答不了的考卷。

## Decision

`normalizeQuizOptions`（store.ts，导出）把观察到的形态统一成纯字符串——字符串数组原样、`{ label }` 对象取 label、字母键 map 取 values——并剥掉字母前缀（`A) `），因为作答 UI 自带字母徽标。两端都用：工具 quiz case 在 `putQuiz` 前规整（校验看到真字符串），`normalizeQuiz` 读经它（已存的坏考卷读取即自愈）。`questions` 参数的 schema 把 label 形态列为第二分支（`oneOf [string, { label }]`），让 DSL 自己的校验容得下这条容错。

## Alternatives considered

- **写入时拒收非字符串选项**：否决——带字母前缀的答案仍会绕过内容匹配，且已存的考卷永远是坏的。
- **纯字符串选项也剥字母前缀**：否决——那是教练的原文字，答案可能逐字匹配它。

## Consequences

- 以 label / 字母键形态写入的考卷现在存成纯字符串并正常渲染；已存的坏考卷下次读取即自愈（规整在读路径上）。
- `choiceOptionIndex` 保留字母捷径——选项在进它之前已规整，无害。

## Testing

`store.spec.ts`（+1）：字符串 / label 对象 / 字母键 map / undefined / 坏项。`tool.spec.ts`（+1）：`{ label }` 选择题存成纯字符串选项。全套绿。
