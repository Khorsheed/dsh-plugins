# Agent Note：scoped typert 生成从已构建类型解析未选中的兄弟包

状态：已实现

[English](2026-09-12-gen-typert-scoped-sibling-types.md) | 中文

## 问题

`GEN_TYPERT_ONLY` scoped 构建只把选中包的源码拷进 overlay、只映射它们的 `@khorsheed/*` 路径——这是设计（605379c：兄弟包的在途源码破坏不能拖垮无关包的构建）。但选中包可能持有对家族兄弟的 TYPE-only 导入——`packages/room/src/adapter.ts` 读 local-agent 门面的类型——兄弟包既未映射也不在 overlay 里，scoped 生成以 TS2307 失败。`deploy-3080 --package packages/room`（把 `GEN_TYPERT_ONLY` 精确限定为部署集合）因此只有在 local-agent 恰好随车部署时才能构建 room。

## 决策

未选中的兄弟包从**已构建的声明文件**解析，绝不从源码：`copyTypertSiblingTypes` 把每个未选中注册包的 `lib/types` 拷进 overlay，`typertSiblingTypePaths` 补上对应 `paths` 条目（`./<dir>/lib/types/…`）。隔离性不变——兄弟包的源码仍然既不拷贝也不分析，只读它已构建的声明面。没有 `lib/types` 的兄弟跳过；真导入它时会收到原始的 TS2307，而那正确地读作"先构建兄弟包"。

## 验证

- `scripts/gen-typert.spec.ts`：兄弟 paths 只覆盖有已构建 `lib/types` 的未选中包（选中包与无 lib 的兄弟不出现），拷贝只落 `lib/types` 不带 `src`。
- `pnpm test:scripts`：124 通过。
- 从 `packages/room` 真实 scoped 运行：`GEN_TYPERT_ONLY=…,@khorsheed/dsh-room tsx scripts/gen-typert.mts`——正是之前以 TS2307 失败的部署调用——现在正常生成 room 的 artifacts。

## 备选方案

**scoped 模式也拷贝全部注册包的源码（所有兄弟映射到 src）。** 否决：那正是 605379c 拆掉的耦合——一个兄弟的破损 WIP 会再次拖垮每次 scoped 构建。

**用指向真实仓库 `lib/types` 的绝对 `paths` 条目。** 否决：保持 overlay 自包含、条目全部 overlay 相对，与其他条目同风格；绝对目标在 tsconfig 路径解析（baseUrl 交互）上有微妙依赖，没有收益。

**部署侧绕法：部署列表永远带上家族兄弟。** 作为唯一答案否决（掩盖缺陷且膨胀每次部署）；作为备用手段值得知道，但工具应当做到 scoping 注释已经承诺的事。

## 后果

- 单独部署 room（或任何带类型级家族导入的包）恢复可用；验收门不再依赖恰好同行的兄弟。
- 兄弟的声明文件必须先构建才能解析——与包自己的 `tsc -b` 已有的要求相同，没有新增负担。
