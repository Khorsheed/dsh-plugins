/** `local-agent-claude-code` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-claude-code'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'Local Agent · Claude Code',
  'card.description': 'Claude Code 委派：登录授权与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'model.title': '默认模型',
  'model.info.aria': '默认模型说明',
  'model.info': '填了就每轮委派以它起 CLI（`claude -p --model <模型>`，常驻模式同一个旗标）；留空则本插件一个模型参数都不传，仍由作用域 settings.json 的 model、或 claude 自己的默认决定。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传模型，用 CLI 自己的默认',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
  'live.granularity': '输出粒度',
  'live.granularity.info.aria': '输出粒度说明',
  'live.granularity.info': '两档都会把每个输出项完整折叠进成员会话日志，内容一字不丢。按消息折叠：输出项完成时落一条消息，事件少、开销低；逐字流式：在完整折叠之上，流式增量按节流（默认 ≥300ms 且 ≥200 字符）以增量快照实时写入会话日志，UI 把同一项的快照合并为一条持续增长的消息。',
  'live.granularity.event': '按消息折叠',
  'live.granularity.token': '逐字流式',
  'live.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'live.error': '保存失败，请重试',
  'live.unavailable': '设置服务不可用（宿主未注册 local-agent-claude-code 命名空间）',
} satisfies Record<string, string>

/** The local-agent-claude-code namespace key union. */
export type LocalAgentClaudeCodeKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The claude-code harness settings card copy. */
    'local-agent-claude-code': LocalAgentClaudeCodeKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Local Agent · Claude Code',
  'card.description': 'Claude Code delegation: sign-in and resident (live) mode',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'model.title': 'Default model',
  'model.info.aria': 'About the default model',
  'model.info': "Set, it starts the CLI on every delegation round (`claude -p --model <model>`, the same flag in resident mode). Blank passes no model flag at all: the scoped settings.json key `model`, or the built-in default of claude, decides exactly as before. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass no model, keep the CLI's own default",
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.granularity': 'Output granularity',
  'live.granularity.info.aria': 'About output granularity',
  'live.granularity.info': 'Both levels fold every output item into the member session log in full — nothing is dropped. Folded by message: an item lands as one message when it completes — fewer events, lower overhead. Token streaming: on top of the full fold, streaming deltas are written into the session log as throttled incremental snapshots (default ≥300ms and ≥200 chars), and the UI merges one item’s snapshots into a single continuously growing message.',
  'live.granularity.event': 'Folded by message',
  'live.granularity.token': 'Token streaming',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-claude-code namespace)',
} satisfies Record<string, string>
