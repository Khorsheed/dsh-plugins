# Agent Note: 图书馆——工具调用韧性：缺 what 的教学报错、minted id 纪律、toc 文本化、描述精简

Status: implemented

## Problem

两个真实会话（不同模型）呈现同一簇工具失败：(1) `library_write` 漏了 `what`，撞上宿主裸 schema 拒绝（"missing required property what"），零教学；(2) 模型给编辑目标臆造语义 id（`p_math`、`b_prob_lifesaver_2020`）——其中 "no project p_math" 的报错诱导了错误结论"那就新建一个"；(3) `acceptance` 连续两次挂在 quiz 站上——拒收只讲了规则没给出口（教学清单属于 `goals`）；(4) 长嵌套 payload 直接生成非法 JSON（`MALFORMED_RESPONSE`，整轮报废）；(5) 失败压力下模型最终把工具调用写成了回复文本。与此同时 write 工具的描述已长成 ~2600 字符的整段墙，稀释注意力（用户此前的评审：形状应贴着字段，纪律放提示词）。

## Decision

- **`what` 在 schema 里改可选、在执行层必填教学**：`library_read` / `library_write` 去掉 `required: true`；缺失或未知 `what` 抛出带合法清单和示例的教学报错，替代宿主的无教学拒绝。
- **minted id 拒收带教学**：`updateProject`（"no project p_math"）与 `putBook` 现在说明 id 是系统铸造的、`library_read · projects / books` 可列、省略 id 即新建。
- **acceptance 拒收指出口**：「…acceptance belongs to kind: practice only; quiz / read 站的完成要求写进 goals: [...]」。
- **最易崩的 payload 降深度**：`what=book` 的 `toc` 在对象/字符串数组之外接受单个换行字符串（每行即一行目录）。
- **描述精简**：`library_write` 的 description 每个 `what` 只留一行行为说明；所有 payload 形状下沉到对应 parameter 的 description（模型写字段时眼前就是形状）。提示词管纪律、参数管形状，不再重复。
- **提示词加两句**：被拒后只改拒收点名的字段、其余原样重发（重写回归正是观察到的失败螺旋）；工具调用是函数调用，绝不写成回复文本。

## Alternatives considered

- **按名字解析项目/书**（把「数学」当 id）：否决——模糊身份会静默写错目标；教 minted id 保持契约精确。
- **路线节点的行式 DSL**（`id | kind | title | covers`）：暂不——语法糖会繁殖语法；JSON 文本传输 + toc 换行字符串已覆盖观察到的崩坏点。
- **quiz 站接受 acceptance** 当信息性里程碑：否决——会稀释动手站的闸门语义；导向 `goals` 两全。

## Consequences

- 每个被观察到的拒收现在都点名修法；剩下的致命模式（非法 JSON 生成、文本式调用）在模型侧，payload 降深度缩小了最大诱因。
- 无状态/API 形状变更，存量数据不动。

## Testing

`tool.spec.ts`（+2）：两个工具缺 `what` 都给教学报错；换行 `toc` 注册成功且空行被丢弃。`service.spec.ts`（扩展）：acceptance 拒收同时指向 `goals`。全套绿。
