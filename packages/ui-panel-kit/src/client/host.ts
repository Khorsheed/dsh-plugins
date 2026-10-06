/**
 * Where the viewer sits relative to the host machine.
 *
 * Moved here from ui-content-preview (2026-10-06): "is the person at the host"
 * is a panel-wide question — any panel offering a gesture that launches a
 * program on the host (Finder, an IDE, a native folder dialog) must hide it
 * when the page is reached remotely — not a preview-kernel detail.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */

/** Loopback hostnames: the page is open on the host machine itself. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1']

/**
 * Whether this page is open on the host machine. Every open-in-app gesture
 * (and the native directory picker) launches a program ON THE HOST — Finder,
 * an IDE, a folder dialog. Reached through a tunnel from a phone or another
 * computer, the gesture fires on a machine nobody is sitting at and the
 * viewer sees nothing happen. The criterion is therefore "is the person at
 * the host", read from the page's own hostname, not screen size or touch: a
 * remote desktop browser is just as far from the host's Finder, and a narrow
 * window on the host itself is not. An unreadable location keeps the old
 * behavior (treated as on-host).
 * @param scope - the global to read `location` from (tests pass a stub).
 * @returns true unless the page's hostname is clearly not loopback.
 */
export function browserOnHost(scope: unknown = globalThis): boolean {
  const hostname = (scope as { location?: { hostname?: unknown } }).location?.hostname
  if (typeof hostname !== 'string' || hostname === '') return true
  return LOOPBACK_HOSTS.includes(hostname.toLowerCase())
}
