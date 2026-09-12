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
  'model.info': '留空 = 跟随默认（输入框里显示的就是当前跟随的模型）。从列表选择或手动输入一个模型名后保存，之后的每轮委派都以它起 CLI（一次性轮次走 `kimi -m <模型>`；常驻模式的 `kimi acp` 没有模型旗标，改为起进程前把作用域 config.toml 的 default_model 写成该值）；手动输入的模型名要是作用域 config.toml 里已定义的那一个（[models."…"] 的键）。成员会话里还可用作曲器按会话切换，不影响这里的默认。改动在下一轮委派生效，进行中的轮次不受影响；评测 run 的条件在建立时冻结，中途换模型会被下一轮的模型回读判为 misattributed 而拦下。',
  'model.placeholder': '留空 = 不传模型，用 CLI 自己的默认',
  'model.menu': '选择模型',
  'model.menuDefault': '默认（跟随 CLI 内置默认）',
  'model.menuDefault.cliConfig': '默认（跟随 CLI 配置：{model}）',
  'model.menuDefault.cliBuiltin': '默认（跟随 CLI 默认：{model}）',
  'model.menuDefault.lastObserved': '默认（跟随 CLI 内置默认（最近：{model}））',
  'model.save': '保存',
  'model.applied': '已保存，下一轮委派生效；进行中的轮次不受影响',
  'model.error': '保存失败，请重试',
  'live.title': '常驻模式（live）',
  'live.info.aria': '常驻模式说明',
  'live.info': '常驻模式 = 成员进程常驻：输出实时流入成员会话、取消不杀进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。设置为全局偏好，对所有后续委派生效。',
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
  'model.info': "Blank = follow the default (the input shows the model it currently follows). Pick from the list or type a model name by hand and save, and every later delegation round starts the CLI with it (`kimi -m <model>` for one-shot rounds; `kimi acp` has no model flag, so resident mode writes the value into `default_model` in the scoped config.toml before spawning); a hand-typed name must be one the scoped config.toml defines (a `[models.\"…\"]` key). Inside a member session the composer can also switch the model per session, without touching this default. A change applies to the next round and never disturbs a round in flight; an evaluation run freezes its condition at setup, so switching mid-run is caught by the model read-back on the next round and fails the run as misattributed.",
  'model.placeholder': "Blank = pass no model, keep the CLI's own default",
  'model.menu': 'Pick a model',
  'model.menuDefault': "Default (follow the CLI's built-in default)",
  'model.menuDefault.cliConfig': 'Default (follow the CLI config: {model})',
  'model.menuDefault.cliBuiltin': 'Default (follow the CLI default: {model})',
  'model.menuDefault.lastObserved': "Default (follow the CLI's built-in default (last: {model}))",
  'model.save': 'Save',
  'model.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'model.error': 'Save failed, please retry',
  'live.title': 'Resident mode (live)',
  'live.info.aria': 'About resident mode',
  'live.info': 'Resident mode keeps the member process alive: output streams into the member session in real time, cancelling does not kill the process, and a crash resumes the same session. Off means every round runs as an independent one-shot process. The setting is global and applies to every later delegation.',
  'live.applied': 'Saved — takes effect on the next delegation round; rounds in flight are unaffected',
  'live.error': 'Save failed, please retry',
  'live.unavailable': 'Settings service unavailable (the host did not register the local-agent-kimi namespace)',
} satisfies Record<string, string>
