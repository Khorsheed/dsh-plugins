/** `room` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.newRoom': '新建 Room',
  'view.members': '成员',
  'members.empty': '暂无成员',
  'composer.placeholder': '发消息到黑板；@ 成员以派发',
  'composer.send': '发送',
  'composer.noted': '已记录到黑板，@ 成员以派发',
  'composer.error.unknownTargets': '未知成员：{names}',
  'composer.error.generic': '发送失败，请重试',
  'member.kind.main': '主 agent',
} satisfies Record<string, string>

/** The room namespace key union. */
export type RoomKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The room controls' copy. */
    room: RoomKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.newRoom': 'New room',
  'view.members': 'Members',
  'members.empty': 'No members yet',
  'composer.placeholder': 'Post to the blackboard; @ a member to dispatch',
  'composer.send': 'Send',
  'composer.noted': 'Recorded to the blackboard; @ a member to dispatch',
  'composer.error.unknownTargets': 'Unknown members: {names}',
  'composer.error.generic': 'Could not send; please retry',
  'member.kind.main': 'main agent',
} satisfies Record<RoomKey, string>
