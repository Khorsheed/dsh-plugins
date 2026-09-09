/** `message-tools` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.withdraw': '撤回',
  'editor.aria': '编辑消息',
  'editor.placeholder': '编辑消息…',
  'editor.save': '保存并重新发送',
  'withdraw.title': '撤回这条消息？',
  'withdraw.description': '撤回后，这条消息及其后的所有内容都会对模型隐藏；原文会回填到输入框，可再从撤回分隔线恢复到对话末尾。',
  'withdraw.acknowledge': '我已了解撤回的影响',
  'withdraw.confirm': '确认撤回',
  'withdrawn.divider': '已撤回 {count} 条消息',
  'withdrawn.expand': '展开查看撤回内容',
  'withdrawn.empty': '撤回的内容不在当前已加载的历史中',
  'withdrawn.entryUser': '用户消息原文',
  'withdrawn.entryAssistant': '助手回复摘要',
  'withdrawn.restore': '恢复到对话末尾',
  'withdrawn.backfilled': '已回填到输入框，可编辑后发送',
  'withdrawn.restored': '已恢复',
  'restored.assistant': '已恢复 · 助手回复',
  'withdrawn.restoreFailed': '恢复失败，请重试',
  'error.edit': '编辑失败，请重试',
  'edited.badge': '已编辑',
  'error.withdraw': '撤回失败，请重试',
  'model.aria': '切换模型，当前 {model}',
  'model.menuAria': '模型与推理等级',
  'model.effort': '推理等级',
  'model.providerDefault': '默认',
  'model.empty': '暂无可用模型',
  'model.selectFailed': '模型切换失败',
  'message.extraBlock': '附加内容块',
  'close': '关闭',
  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
  'json.truncated': '… 已截断，共 {total} 字符',
} satisfies Record<string, string>

/** The message-tools namespace key union. */
export type MessageToolsKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The user-message edit/withdraw controls' copy. */
    'message-tools': MessageToolsKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.withdraw': 'Withdraw',
  'editor.aria': 'Edit message',
  'editor.placeholder': 'Edit the message…',
  'editor.save': 'Save and resend',
  'withdraw.title': 'Withdraw this message?',
  'withdraw.description': 'Once withdrawn, this message and everything after it will be hidden from the model; its text is backfilled into the composer, and it can be restored to the conversation tail from the withdrawal divider.',
  'withdraw.acknowledge': 'I understand the effect of withdrawal',
  'withdraw.confirm': 'Confirm withdrawal',
  'withdrawn.divider': 'Withdrawn {count} messages',
  'withdrawn.expand': 'Expand the withdrawn content',
  'withdrawn.empty': 'The withdrawn content is outside the loaded history',
  'withdrawn.entryUser': 'Original user message',
  'withdrawn.entryAssistant': 'Assistant reply summary',
  'withdrawn.restore': 'Restore to the end of the conversation',
  'withdrawn.backfilled': 'Backfilled into the composer; edit and send',
  'withdrawn.restored': 'Restored',
  'restored.assistant': 'Restored · assistant reply',
  'withdrawn.restoreFailed': 'Could not restore; please retry',
  'error.edit': 'Could not apply the edit; please retry',
  'edited.badge': 'Edited',
  'error.withdraw': 'Could not withdraw the message; please retry',
  'model.aria': 'Switch model, current {model}',
  'model.menuAria': 'Model and reasoning effort',
  'model.effort': 'Reasoning effort',
  'model.providerDefault': 'Provider default',
  'model.empty': 'No models available',
  'model.selectFailed': 'Could not switch model',
  'message.extraBlock': 'Extra content block',
  'close': 'Close',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
  'json.truncated': '… truncated, {total} characters total',
} satisfies Record<MessageToolsKey, string>
