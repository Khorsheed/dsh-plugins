# Agent Note：local-agent 卡片的设置存进各家自己的存储

状态：已实现

[English](2026-10-27-local-agent-card-settings-store.md) | 中文

## 问题

local-agent 设置卡片上的开关和 dsh 的默认模型，原来是各家插件行配置里的可热更新字段，通过宿主的设置表单写进 profile 配置文件。装了多个模式合集时，每个合集都会插入这一组插件行；宿主写入前的核对拿第一个重复行去比，结果每次写入都被拒（见 [2026-10-27-settings-write-refused-by-duplicate-rows](../bug-fix/2026-10-27-settings-write-refused-by-duplicate-rows.md)）。所以 3080 上，以及社区里任何装了两个合集的用户，这些开关都改不了。

另外，dsh 卡片上还有一个默认关闭的「启用」开关。负责人觉得多此一举：装了这个插件，本身就说明想用它。

## 决定

- **每家一份自己的存储。** 卡片上的值存在各家默认目录下的 `card-settings.json` 里（`card-settings.ts`），端点凭据和可用模型列表本来就存在这里。
  - 核心注册表提供 `cardSettings` / `setCardSettings` / `onCardSettings`，gateway 提供同名的接口。
  - 各家的设置读取接口（settings face）多了一个 `harness:` 参数，把存储里的值叠在插件行配置上面；存储写入后，通过它的 watch 在下一轮生效。
  - 卡片改用 `bindCardSettingsScope`：先取宿主表单读到的值，再叠上存储里的值；写入只写存储。
  - 存储里没有的字段回退到插件行配置，所以 profile 里原有的值不用迁移，照样生效。
- **dsh 一律开启。** 去掉「启用」开关，插件总会注册；残留的 `enabled: false` 会被忽略。`subagent_dsh` 改成包里的 `./tool` 入口，和另外三家一样，由 dev、gamedev、video 三个合集的模式授权（`tool-subagent-dsh`）。它不再挂在 profile 根上：以前只要开关打开，每个会话都能看到它。
- **常驻模式默认开启**，四家都一样（`live` 的默认值和读不到时的回退都改成 `true`）。开关保留，某家 CLI 的常驻模式出问题时，可以退回普通模式。

## 考虑过的方案

**等宿主修。** 否决：在上游发版之前，装了两个合集的社区用户会一直改不了这些开关。宿主的问题仍然值得提上游，因为 room、worktrees 等其他共用插件行也有同样的问题。

**dsh 一律开启，但工具仍挂在 profile 根上。** 否决：那样所有模式的所有会话都会看到 `subagent_dsh`。

## 后果

- 宿主通用的设置清单里，看不到在这些卡片上改过的值；要改就在卡片上改。
- dsh README 的截图里还有旧的「启用」开关，下次整理 README 时重拍。
- dev、gamedev、video 以外模式的会话，不再有 `subagent_dsh`；以前手动打开过开关的 profile 也一样。
- 测试覆盖：
  - 存储的读写，以及用 null 清除某项；
  - settings face 的合并和 watch；
  - 卡片的读写方式（宿主表单的值叠上存储的值，写入只写存储）；
  - dsh 一律注册，且不在根上挂工具；
  - `./tool` 入口能注册 `subagent_dsh`；
  - 在真实组合里，存储里的值决定是否常驻。
