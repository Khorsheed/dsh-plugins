/** `session-title-edit` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.rename': '重命名会话',
  'editor.aria': '会话标题',
  'editor.placeholder': '输入新标题…',
  'editor.save': '保存',
  'cancel': '取消',
  'error.invalid': '标题不能为空',
  'error.rename': '重命名失败，请重试',
  'hint.tooLong': '标题过长：最多 {max} 字节（约 {chars} 个汉字），当前 {bytes} 字节',
} satisfies Record<string, string>

/** The session-title-edit namespace key union. */
export type SessionTitleEditKey = keyof typeof zh

/** The dictionary namespace owned by this plugin. */
export const NS = 'session-title-edit'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session-title editing control's copy. */
    'session-title-edit': SessionTitleEditKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.rename': 'Rename session',
  'editor.aria': 'Session title',
  'editor.placeholder': 'Enter a new title…',
  'editor.save': 'Save',
  'cancel': 'Cancel',
  'error.invalid': 'The title cannot be empty',
  'error.rename': 'Rename failed, please try again',
  'hint.tooLong': 'Title too long: max {max} bytes (about {chars} CJK characters), currently {bytes}',
} satisfies Record<string, string>
