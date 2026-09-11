import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { BRIDGE_VERSION, MOBILE_VERSION } from '../protocol.ts'
import { MobilePresentation } from './presentation.ts'
import { DirectoryFlow } from './DirectoryFlow.tsx'
import { MobileNavigation } from './navigation.ts'
import { MobileWelcome } from './MobileSeats.tsx'
import { MobileSubmissionFocus } from './SubmissionFocus.tsx'
import { MobileTools } from './MobileTools.tsx'
import { MobileChrome } from './MobileChrome.tsx'
import type { MobileChromeInjected } from './MobileChrome.tsx'
import { MobileQueue } from './MobileQueue.tsx'
import { MobileRooms, type RoomRemoteFace } from './rooms.ts'
import { MessageMenu } from './messageMenu.ts'
import { NS, en, zh } from './locales.ts'

declare global {
  interface Window {
    __DSH_MOBILE_SHELL__?: { bridgeVersion: number; capabilities?: readonly string[] }
    webkit?: { messageHandlers?: { dshMobile?: { postMessage(value: unknown): void } } }
  }
}

export const inject = ['slots', 'locale', 'layout', 'connection']

/** One browser-owned presentation; no Host preference or sibling plugin is changed. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'mobile: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => {
    const reconnect = () => { connection.reconnect() }
    window.addEventListener('dsh-mobile-foreground', reconnect)
    return () => { window.removeEventListener('dsh-mobile-foreground', reconnect) }
  }, 'mobile: foreground reconnect')
  const rooms = new MobileRooms(() => ctx.get('remote.room' as never) as unknown as RoomRemoteFace | undefined)
  ctx.effect(() => () => rooms.dispose(), 'mobile: room presentation')
  const messages = new MessageMenu(document)
  ctx.effect(() => () => messages.dispose(), 'mobile: message actions')
  const navigation = new MobileNavigation()
  ctx.inject(['sessions', 'workspaces', 'uiWorkspace'], scoped => {
    navigation.set({ sessions: scoped.sessions, workspaces: scoped.workspaces, workspace: scoped.uiWorkspace })
    scoped.effect(() => () => { navigation.set(undefined) }, 'mobile: optional navigation')
  })
  const presentation = new MobilePresentation(window, window.__DSH_MOBILE_SHELL__?.bridgeVersion === BRIDGE_VERSION)
  ctx.effect(() => () => { presentation.dispose() }, 'mobile: presentation')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mobile-navigation', locale: NS,
    inject: (): MobileChromeInjected => ({ presentation, connection, navigation, rooms, toggleSidebar: () => { ctx.layout.toggleSidebar() } }),
  }, MobileChrome))
  for (const name of ['conversation.input.dock', 'conversation.session.header.actions'] as const) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'mobile-send-focus' }, MobileSubmissionFocus))
  }
  // Room's first asynchronous cache fill does not bump its composer slot in
  // this revision. A declining mobile entry refreshes the public election;
  // the original Room/approval/local-agent entries still decide the winner.
  ctx.slots.inject('conversation.composer', () => {
    let remove: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      const current = navigation.getSnapshot()?.sessions.list.getSnapshot().current
      if (!presentation.getSnapshot().active || !current || !rooms.get(current)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        remove?.()
        remove = ctx.slots.register({ name: 'conversation.composer', priority: 10000, select: () => null }, () => null)
      }, 300)
    }
    const unsubscribe = rooms.subscribe(refresh)
    return () => { unsubscribe(); clearTimeout(timer); remove?.() }
  })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'mobile-room-queue', locale: NS,
    inject: sessionId => {
      const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation')
      return conversation ? { updateQueue: conversation.updateQueue.bind(conversation) } : {}
    },
  }, MobileQueue))
  // Contribute through existing seats; no foreign child-slot ownership is claimed.
  ctx.slots.inject('conversation.hero.brand.mark', () => {
    let remove: (() => void) | undefined
    const sync = () => {
      if (presentation.getSnapshot().active) remove ??= ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100, locale: NS }, MobileWelcome)
      else { remove?.(); remove = undefined }
    }
    sync(); const unsubscribe = presentation.subscribe(sync)
    return () => { unsubscribe(); remove?.() }
  })
  ctx.slots.inject('conversation.input.left', () => {
    let remove: (() => void) | undefined
    const sync = () => {
      if (presentation.getSnapshot().active) remove ??= ctx.slots.register({ name: 'conversation.input.left', id: 'mobile-input-tools', order: -100, locale: NS, inject: () => ({ rooms }) }, MobileTools)
      else { remove?.(); remove = undefined }
    }
    sync(); const unsubscribe = presentation.subscribe(sync)
    return () => { unsubscribe(); remove?.() }
  })
  // Shadow only these public flow slots while this client is in mobile mode.
  for (const name of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const) {
    ctx.slots.inject(name, () => {
      let remove: (() => void) | undefined
      const sync = () => {
        if (presentation.getSnapshot().active) {
          remove ??= ctx.slots.register({ name, priority: -100, locale: NS }, DirectoryFlow)
        } else { remove?.(); remove = undefined }
      }
      sync()
      const unsubscribe = presentation.subscribe(sync)
      return () => { unsubscribe(); remove?.() }
    })
  }
  const post = (type: 'ready' | 'unloaded') => {
    if (window.__DSH_MOBILE_SHELL__?.bridgeVersion !== BRIDGE_VERSION) return
    window.webkit?.messageHandlers?.dshMobile?.postMessage({ type, bridgeVersion: BRIDGE_VERSION, mobileVersion: MOBILE_VERSION, layout: presentation.getSnapshot(), navigation: !!navigation.getSnapshot(), anchors: { root: document.querySelectorAll('[data-slot="root"]').length, overlay: document.querySelectorAll('[data-shell-overlay]').length, main: document.querySelectorAll('[data-slot="main"]').length, sidebar: document.querySelectorAll('[data-slot="sidebar"]').length } })
  }
  post('ready')
  ctx.effect(() => presentation.subscribe(() => post('ready')), 'mobile: layout availability')
  ctx.effect(() => navigation.subscribe(() => post('ready')), 'mobile: navigation availability')
  ctx.effect(() => () => { post('unloaded') }, 'mobile: shell availability')
}
