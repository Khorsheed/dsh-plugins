/** `local-agent-codex` namespace dictionaries. */

/** Dictionary namespace owned by this plugin (matches the settings namespace). */
export const NS = 'local-agent-codex'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': 'Local Agent · Codex',
  'card.description': 'Codex 委派：登录授权与常驻模式（live）',
  'card.expand': '展开',
  'card.collapse': '收起',
  'auth.title': '认证',
  'model.title': '默认模型',
  'model.info.aria': '默认模型说明',
  'model.info': '填了就每轮委派以它起 CLI（一次性轮次走 `codex exec -m <模型>`，常驻模式走 app-server 的 `-c model=…`）；留空则本插件一个模型参数都不传，仍由作用域 config.toml 的 model、或 codex 自己的默认决定。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传模型，用 CLI 自己的默认',
  'model.placeholder.cli-config': '留空 = 跟随 CLI 配置：{model}',
  'model.menu': '选择模型',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
  'model.effective.set': '当前生效：{model}',
  'model.effective.cli-config': '跟随 CLI 配置：{model}',
  'model.effective.cli-builtin': '跟随 CLI 内置默认',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
  'live.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'live.error': '保存失败，请重试',
  'live.unavailable': '设置服务不可用（宿主未注册 local-agent-codex 命名空间）',
} satisfies Record<string, string>

/** The local-agent-codex namespace key union. */
export type LocalAgentCodexKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The codex harness settings card copy. */
    'local-agent-codex': LocalAgentCodexKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Local Agent · Codex',
  'card.description': 'Codex delegation: sign-in and resident (live) mode',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'auth.title': 'Authentication',
  'model.title': 'Default model',
  'model.info.aria': 'About the default model',
  'model.info': "Set, it starts the CLI on every delegation round (`codex exec -m <model>` for one-shot rounds, `-c model=…` on the resident app-server). Blank passes no model flag at all: the scoped config.toml key `model`, or the built-in default of codex, decides exactly as before. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass no model, keep the CLI's own default",
  'model.placeholder.cli-config': 'Blank = follow the CLI config: {model}',
  'model.menu': 'Pick a model',
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'model.effective.set': 'In effect: {model}',
  'model.effective.cli-config': 'Following the CLI config: {model}',
  'model.effective.cli-builtin': "Following the CLI's built-in default",
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-codex namespace)',
} satisfies Record<string, string>
