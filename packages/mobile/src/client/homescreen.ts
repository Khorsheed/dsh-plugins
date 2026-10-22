/** Add-to-home-screen affordances for the mobile presentation: a data-URI
 * web app manifest (Chrome/Android) and Apple's meta tags (iOS Safari reads
 * those, not the manifest). Injected only while the mobile layout is active,
 * so desktop installs are unaffected. The start URL is credential-free:
 * origin + pathname only. No service worker, no offline claim. */
export class MobileHomescreen {
  private injected = false
  private readonly nodes: Element[] = []
  constructor(private readonly doc: Document) {}

  sync(active: boolean): void {
    if (active === this.injected) return
    if (active) this.inject()
    else this.remove()
  }

  private inject(): void {
    this.injected = true
    const manifest = {
      name: 'DSH Mobile',
      short_name: 'DSH',
      start_url: this.doc.location.origin + this.doc.location.pathname,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#527cff',
      icons: [{ src: ICON_DATA_URI, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    }
    this.add('link', { rel: 'manifest', href: `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}` })
    this.add('meta', { name: 'mobile-web-app-capable', content: 'yes' })
    this.add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' })
    this.add('meta', { name: 'apple-mobile-web-app-title', content: 'DSH' })
    this.add('meta', { name: 'theme-color', content: '#527cff' })
  }

  private remove(): void {
    this.injected = false
    for (const node of this.nodes.splice(0)) node.remove()
  }

  private add(tag: 'link' | 'meta', attrs: Record<string, string>): void {
    const node = this.doc.createElement(tag)
    node.dataset.mobileOwned = 'homescreen'
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    this.doc.head.append(node)
    this.nodes.push(node)
  }

  dispose(): void { this.remove() }
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#527cff"/><text x="256" y="336" font-family="system-ui,sans-serif" font-size="240" font-weight="600" fill="#ffffff" text-anchor="middle">D</text></svg>'
const ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`
