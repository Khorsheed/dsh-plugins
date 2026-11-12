import { buildCardSrcDoc } from './srcdoc.ts'
import { attachBridge, type BridgeCapabilities } from './bridge.ts'
import { attachFrameLoading } from './loading.ts'

export interface MountedCardFrame {
  readonly frame: HTMLIFrameElement
  readonly dispose: () => void
}

export function mountCardFrame(container: HTMLElement, html: string, capabilities: BridgeCapabilities = {}): MountedCardFrame {
  const srcdoc = buildCardSrcDoc(html)
  const frame = document.createElement('iframe')
  frame.className = 'dsh-inline-card-frame'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('title', 'inline card')
  frame.style.display = 'block'
  frame.style.width = '100%'
  frame.style.height = '150px'
  frame.style.border = 'none'
  container.appendChild(frame)
  const disposeLoading = attachFrameLoading(frame, container, srcdoc)
  frame.srcdoc = srcdoc
  const disposeBridge = attachBridge(frame, capabilities)
  frame.setAttribute('data-dsh-bridge', '')

  let disposed = false
  return {
    frame,
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeLoading()
      disposeBridge()
      frame.remove()
    },
  }
}
