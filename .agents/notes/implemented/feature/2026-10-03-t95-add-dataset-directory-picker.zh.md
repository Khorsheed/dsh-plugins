# Agent Note: datasets——「添加题集」弹窗用宿主的目录选择器选来源与仓库位置

Status: implemented

## Problem

「添加题集」弹窗（`packages/datasets/src/client/AddDatasetDialog.tsx`）问数据在哪，并显示新仓库会放在哪。两处都只能靠文字：「数据在哪」是要人手打路径的 textarea；「新仓库放在 …」是 `repoPathFor(datasetsHome, name)` 算出的提示，`datasetsHome` 只能靠插件配置改。`DSH_HOME` 在临时目录下的实例上，新仓库因此必然落进那个临时目录，弹窗里没有出路。

插件其实已经能调宿主的目录选择器：`src/client/index.ts` 里的 `pickDirectory` 先探 `ctx.workspaces.pickDirectory`、再探 `uiWorkspace.pickDirectory`；「高级」里的登记表单只在 `canPick` 成立（回环连接且宿主描述里 `canOpenPath` 为真）时显示按钮。

## Decision

- **「数据在哪」加「选择目录…」。** textarea 保留，因为这一栏还要能填单个文件、公开数据集名字或链接。按钮在输入框旁，选中的路径写进输入框，之后可以接着改。取消（返回 null）或选择器报错都不改原值。
- **「新仓库放在 …」加「更改…」与「恢复默认位置」。** 「更改…」选的是**父目录**，仓库 = `<父目录>/<名称>`，与默认值同一条规则（`src/client/organize.ts` 的 `repoParentOf` + `repoPathFor`）。「恢复默认位置」只在选过之后出现，回到 datasets home。名称还没填对时，这一行用 `<题集名称>` 占位，让人看得到自己选的父目录。
- **选中的位置随请求走。** `AddDatasetFields.repoParent` 带上它，`buildAddRequest` 在「新仓库放在」那一行写 `<父目录>/<名称>` 而不是默认值；请求的其他部分不变。
- **同一套探测、同一种降级。** 弹窗从 `DatasetsView` 拿 `canPick` 与 `pickDirectory`——登记表单本来就在用这两个。`canPick` 为假时两个按钮都隐藏，弹窗就是 T90 的样子。选出来的路径过一遍 `cleanPickedPath`，因为 macOS 的选择器返回的路径带结尾斜杠。

### 下游有没有「必须在 datasets home 下」的假设？

没有，动手前查过：

- `datasets_propose_registration`（`src/proposal.ts` 的 `resolve`）接受任意 `repo`，解析出 git common dir 与检出，按仓库对象核对映射；没有任何地方把路径和 `datasetsHome` 比。
- `registry.register`（`src/registry.ts`）只拒绝已登记的仓库或被占用的 id。
- 登记评审页在「高级」里把 common dir 与检出当事实显示，从不和 home 比。
- `datasetsHome` 只在一处被读：弹窗取默认值用的整理设置。

所以没有需要放宽的地方。唯一一句不严谨的在 skill 里（`skills/dataset-authoring/SKILL.md` 第 3 步）：说请求里写的是「datasets home」。实际请求写的是完整仓库路径，选过位置时就是选中的那个。skill 仍把它当作推荐答案去问人，所以没改；整理 Agent 的行为不在本次范围（skill 归 T94）。

## Alternatives considered

**把 textarea 换成只能选目录的字段。** 常见情形更干净，但「数据在哪」还要接受文件、数据集名字或 URL，目录选择器给不出这些。所以是给输入框加按钮，不是替换它。

**让「更改…」直接选仓库目录本身。** 那样人要去选或新建一个空的 `gsm8k` 文件夹；宿主的选择器并非每个平台都能新建文件夹，路径也会和人填的名称脱节。选父目录让默认值与自选位置共用一条规则 `<父目录>/<名称>`。

**在弹窗里改 `datasetsHome`。** 那是从一次性弹窗写持久配置，还会悄悄把以后每个题集都挪走。选位置是逐次请求的事，改默认值仍走配置键。

**给弹窗另写一套选择器探测。** 两份探测会让两个表单对「有没有选择器」各说各话。弹窗复用登记表单的 `canPick` 与 `pickDirectory`。

## Consequences

- 在临时实例上，人不改配置就能把仓库放到自己的主目录下。
- 非回环连接的浏览器、或没有 `canOpenPath` 的宿主，仍只有文字输入——和登记表单一样，理由也一样：选择器开在宿主机上，不在看页面的那台机器上。
- 选择器是宿主的：macOS 上是 `osascript choose folder`，弹在宿主机桌面上。临时实例验证时只把这个系统对话框换成实例 `PATH` 上的替身；按钮、客户端探测、Remote 与宿主对输出的解析都是真跑的。
- [T90 的 Note](2026-10-01-t90-dataset-journey.zh.md) 决定 C 现在写明可以用弹窗的「更改…」选别的位置。
