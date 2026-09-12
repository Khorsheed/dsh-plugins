/** `local-agent-kimi` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-kimi'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'Local Agent · Kimi',
  'card.description': 'Kimi Code 委派：登录授权与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'model.title': '默认模型',
  'model.info.aria': '默认模型说明',
  'model.info': '填了就每轮委派以它起 CLI（一次性轮次走 `kimi -m <模型>`；常驻模式的 `kimi acp` 没有模型旗标，改为起进程前把作用域 config.toml 的 default_model 写成该值）。模型名要是作用域 config.toml 里已定义的那一个（[models."…"] 的键）。留空则本插件不传模型，仍由 default_model 决定。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传模型，用 CLI 自己的默认',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
  'live.granularity': '输出粒度',
  'live.granularity.info.aria': '输出粒度说明',
  'live.granularity.info': '两档都是常驻模式内的投递频率，且两档都把每个子项（思考、回复、工具调用）完整折叠进子会话日志。按消息折叠：子项完成即折叠，事件少、开销低；逐字流式：在全量折叠之上，流式增量按节流（默认 ≥300ms 且 ≥200 字符）以快照实时写入会话日志，UI 把同一条消息整体替换为持续增长的一条，子项完成时在同一位置收尾。',
  'live.granularity.event': '按消息折叠',
  'live.granularity.token': '逐字流式',
  'live.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'live.error': '保存失败，请重试',
  'live.unavailable': '设置服务不可用（宿主未注册 local-agent-kimi 命名空间）',
} satisfies Record<string, string>

/** The local-agent-kimi namespace key union. */
export type LocalAgentKimiKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The kimi harness settings card copy. */
    'local-agent-kimi': LocalAgentKimiKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Local Agent · Kimi',
  'card.description': 'Kimi Code delegation: sign-in and resident (live) mode',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'model.title': 'Default model',
  'model.info.aria': 'About the default model',
  'model.info': "Set, it starts the CLI on every delegation round (`kimi -m <model>` for one-shot rounds; `kimi acp` has no model flag, so resident mode writes the value into `default_model` in the scoped config.toml before spawning). The name must be one the scoped config.toml defines (a `[models.\"…\"]` key). Blank passes no model: `default_model` decides. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass no model, keep the CLI's own default",
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.granularity': 'Output granularity',
  'live.granularity.info.aria': 'About output granularity',
  'live.granularity.info': 'Both levels are delivery frequencies within resident mode, and both fold every item (thinking, replies, tool calls) completely into the member session log. Folded by message: each item folds when it completes — fewer events, lower overhead. Token streaming: on top of the full fold, streaming deltas append throttled snapshots (default ≥300ms apart and ≥200 chars of growth) to the session log in real time, which the UI merges into one continuously growing message; the item’s completion fold lands at the same spot.',
  'live.granularity.event': 'Folded by message',
  'live.granularity.token': 'Token streaming',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-kimi namespace)',
} satisfies Record<string, string>
