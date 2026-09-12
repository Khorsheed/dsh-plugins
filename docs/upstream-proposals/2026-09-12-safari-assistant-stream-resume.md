# Safari 恢复会话后正文停止、统计继续更新

状态：已从 iPhone 现场定位；修复建议经过隔离验证，未修改或部署宿主。

宿主源码基线：`183f08e9c6`，`@deepseek-ai/dsh-util-values@0.1.5-rc.1`。

## 现场证据

通过 Web Inspector 附着用户原有的 iPhone WKWebView，未刷新页面、重启服务或向会话发送消息。正文停在 16:34 已结束的一轮，而 Web 正在执行下一轮；步骤和消耗持续增长。

| 检查项 | 实测 |
|---|---|
| 连接状态 | `connected` |
| Session | `openState: open`、`openError: null`、`running: true` |
| 正文 event source | 436 个条目，末项 `turn/end`，seq 435，时间 16:34:05 |
| 正文 journal | generation 3，lastCursor 493，未 disposed / aborted |
| Assistant fold | durableCursor 493，active attempt step 8，nextIndex 1777 |
| 消费循环 | `journal.done` 已拒绝，错误见下 |
| 页面位置 | scrollTop 2837 + clientHeight 670 = scrollHeight 3507，已在底部 |

调试读取内部字段仅用于定位，不能成为插件的运行时接口。

错误链：

```text
TypeError: Assistant stream raw chunk must be a lossless JSON object
  cause: Assistant stream chunk must be losslessly JSON-serializable
snapshotChunk → validateRecord → expandAssistantStream
→ ClientAssistantStream.replace → Session.installWindow
→ Session.acceptEventChange → RemoteJournalStream.replaceFromOpening
→ replaceGeneration → consume
```

这不是滚动位置或所有消息都未送达：统计与正文走独立订阅。正文 journal 消费失败，但连接和统计订阅仍然存活。

## 根因：原生函数源码格式被写死为 V8 格式

`packages/util/values/src/index.ts` 的 `hasIntrinsicConstructor` 使用：

```ts
Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
```

真机返回：

```text
function Object() {
    [native code]
}
function Array() {
    [native code]
}
```

两个比较均为 `false`。正常 JSON 对象和数组因原型校验被拒绝。恢复期间，`ClientAssistantStream.replace` 会展开进行中 attempt 的紧凑 stream，其中 raw chunk 触发此错误。不能把该错误解释为模型输出了非法 JSON。

## 第二处缺陷：消费失败后状态仍然是 open

`packages/api/session-controller/src/client/sessions/session.ts` 中 `failEventStream` 对非 RemoteFailure 直接抛出，没有清理当前 journal 或把 Session 改为 error。结果 `RemoteJournalStream.consume` 已结束，而外部仍看到 open / null error。

另外，`RemoteJournalStream.replaceFromOpening` 在 `options.publish` 成功前就更新 cursor。`ClientAssistantStream.replace` 也在展开完成前更新自身状态。这解释了 journal/fold 到 493 而正文停在 435 的现场差异。

`Session.open()` 对 open 状态直接返回，单纯重连底层 transport 也不会重新创建已结束的消费循环。不能把手动重新连接作为此问题的完整修复。

## 最小修复建议

保留 constructor 名称、prototype 身份及原型链约束，比较当前引擎自身的 intrinsic 源码：

```diff
--- a/packages/util/values/src/index.ts
+++ b/packages/util/values/src/index.ts
@@
-      && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
+      && Function.prototype.toString.call(constructor)
+        === Function.prototype.toString.call(globalThis[name])
```

这是待上游评审的修复建议，不是已应用的补丁。应补跨 realm 回归测试，确认仍拒绝伪造 prototype、子类和有损 JSON。

消费失败还需单独加固：

1. 将 fold / publication 抛出的本地异常转换为可观测的会话错误，保留 cause，清理 journal 所有权。
2. 明确重试入口，重建正文订阅；不要无限重试确定性坏数据或只重连统计通道。
3. 在成功展开 / 发布之后提交 fold 状态和 resume cursor，或明确使用终止后完整重建的策略，防止半更新。
4. 保留已展示正文，同时呈现正文同步失败状态；不要把它误报为整个服务器正在重启。

## 已做的隔离验证

读取该基线 `util-values` 源码，在独立函数作用域中运行原版和上述候选版本，不替换生产函数。

| 引擎 | 原版 | 候选版本 |
|---|---|---|
| Node / V8 | 11 / 11 个预期结果 | 11 / 11 |
| macOS JavaScriptCore（`osascript -l JavaScript`） | 普通对象、含嵌套数组的对象被误拒绝 | 11 / 11 |
| iPhone WKWebView | 原生 Object / Array 源码格式与硬编码值不同；实际正文消费抛出上述错误 | 完整候选测试未取得结果，不能算通过 |

11 个输入：普通对象、嵌套数组对象、null-prototype 对象、循环对象、自定义类实例、负零、Infinity、undefined 属性、稀疏数组、不可枚举属性、Symbol 属性。前三个应接受，后八个应拒绝。

最小跨浏览器触发检查：

```js
for (const name of ['Object', 'Array']) {
  const actual = Function.prototype.toString.call(globalThis[name]);
  console.log(name, {
    actual,
    acceptedByCurrentHost: actual === `function ${name}() { [native code] }`,
  });
}
```

## 修复后的验收标准

- iPhone 在已有模型回复进行中打开会话，能还原已生成部分并继续增长。
- 从后台切回、网络断开恢复后，在该轮结束前仍持续显示正文。
- 使用真正的 WebKit / iPhone；Chromium 的 mobile viewport 不能覆盖引擎差异。
- 人为让 publication 抛出普通 TypeError，Session 应进入可观测错误状态，重试后继续正文订阅。
- 检查 ordinary text、reasoning、tool-call、raw chunk 和最终 settlement，避免重复或遗漏。
- 观察两端相同时间段的正文增长，而不只是 token 统计或结束后的最终答案。

## 当前部署边界

本轮只诊断并准备上游修复材料。宿主按本仓库 AGENTS.md 约定保持只读；不在移动插件中修改全局 `Function.prototype.toString`，不跳过 JSON 校验，不用私有 Session 字段实现运行时重试。尚未修复生产实例中的该缺陷。
