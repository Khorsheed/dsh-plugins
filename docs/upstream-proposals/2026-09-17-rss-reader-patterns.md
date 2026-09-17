# RSS reader rewrite — the patterns to copy

Date: 2026-09-17
Author: `patterns` (teammate recon, task-2)
Subject: the working conventions of the shipped right-sidebar plugins, extracted as a
cookbook for the `@khorsheed/dsh-rss-reader` rewrite.

## Method and evidence rules

- Every claim below is backed by a quote from real source in this checkout
  (`packages/local-files`, `packages/ui-file-preview`, `packages/sidechat`, `packages/quote`,
  `packages/taskpilot`, `packages/worktrees`).
- Where the convention is owned by the **official host packages** (the sidebar-right tab
  registry, the slot runtime, the conversation input machine), the quote comes from the
  host checkout the repo test/type plane already resolves against:
  `~/code/deepseek-harness/packages/...`, at the pinned host line
  `0.1.5-rc.1` (`pnpm-workspace.yaml` `overrides`). Those quotes are marked
  **(host)** and are the contract this repo's plugins are written against.
- Read-only: no build, install, or test was run (`node_modules` is mid-install). No file was
  edited except this one.
- Where no evidence was found, the section says **not found** and lists what was searched.

### The subject: the current stub

`packages/dsh-rss-reader` is a scaffold whose client swallows every failure and registers
nothing usable. The defects are enumerated under each heading and again in
[§7 Stub defect ledger](#7-stub-defect-ledger).

```ts
// packages/dsh-rss-reader/src/client/index.ts:17-46
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await (ctx as any).remote.$mount(rssReaderRemote))
  } catch { /* degrade silently */ }
  try {
    const localeDisposer = (ctx.locale as any).register(NS, { zh, en })
    disposers.push(async () => { await localeDisposer?.() })
  } catch { /* degrade silently */ }
  try {
    const tabs = (ctx as any).get('sidebarRightTabs')
    if (tabs !== undefined) {
      const t = (ctx.locale as any).bind(NS) as (key: string) => string
      const tabDisposer = tabs.register(rssReaderDefinition(t))
      disposers.push(async () => { await tabDisposer?.() })
    }
  } catch { /* degrade silently */ }
  try {
    const slotsService = (ctx as any).get('slots')
    if (slotsService !== undefined) {
      const uninstall = await slotsService.inject('sidebar.right.pane.tab', async () => {
        return slotsService.register({
          name: 'sidebar.right.pane.tab',
          key: RSS_READER_TAB_ID,
          locale: NS,
        }, RssView)
      })
      disposers.push(async () => { await uninstall?.() })
    }
  } catch { /* degrade silently */ }
```

---

## 1. Sidebar tab, two-stage registration

### Pattern to copy (1–2 lines)

**Stage one** puts a static *type* into `ctx.sidebarRightTabs.register(definition)` (id, kind,
thunks for title/guide, no runtime state). **Stage two** puts the *body* into the keyed seat
`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name, key: <the type's
id>, locale: NS, store?, inject? }, Component))`. Both ride `ctx.effect(...)`; the key in
stage two **must equal the definition's `id`**.

### Stage one — the definition

```tsx
// packages/local-files/src/client/definition.tsx:24-28
/** The tab kind: the official files kind, taken over at the extension band. */
export const LOCAL_FILES_KIND = 'files'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const LOCAL_FILES_TAB_ID = '@khorsheed/dsh-local-files'
```

```tsx
// packages/local-files/src/client/definition.tsx:46-57
export function localFilesDefinition(t: TranslateNS<'localFiles'>): SidebarRightTabDefinition {
  return {
    id: LOCAL_FILES_TAB_ID,
    kind: LOCAL_FILES_KIND,
    title: () => t('tab.label'),
    guide: [{
      order: 40,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: FolderGlyph,
    }],
  }
}
```

The registry's field semantics **(host)**:

```ts
// deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:86-128 (host)
export interface SidebarRightTabDefinition {
  /**
   * This implementation's identity in the tab system, unique across every
   * registration (a package name is the natural value). ... it is the key its
   * body and title register under in the `sidebar.right.pane.tab` and
   * `sidebar.right.pane.tab.title` seats.
   */
  readonly id: string
  /** Type discriminator: what the tabs of this type are, and what `openTab` names. */
  readonly kind: string
  /**
   * Resource-address globs this type recognizes; omit for a page type, which is
   * opened by kind and recognizes no address.
   */
  readonly patterns?: readonly string[]
  /** Defaults to `extension`: a type that says nothing is one from outside the product. */
  readonly priority?: SidebarRightTabPriority
  readonly canOpen?: (address: string) => boolean
  readonly title: (address: string) => string
  /** Entry boxes for the guide page. Omit to stay off it. */
  readonly guide?: readonly SidebarRightGuideEntry[]
}
```

So `definition.tsx` must contain, for an RSS page tab:

| field | value for RSS | evidence |
| --- | --- | --- |
| `id` | `'@khorsheed/dsh-rss-reader'` (package name) | local-files `:28`, ui-file-preview `:30`, sidechat `:22`, taskpilot `:23` |
| `kind` | a **new** kind `'rss-reader'` | see "kind" below |
| `title` | a thunk `() => t('tab.label')`, not a captured string | local-files `:50`; registry refreshes thunks per read `(host) tab-registry.ts:24-25` |
| `guide[]` | one entry `{ order, title, description, icon }` — or omit to stay off the guide | local-files `:51-56`, ui-file-preview `:106-111`, sidechat `:47-52` |
| `patterns` / `canOpen` | **omit** — a page type claims no address | local-files `:16-17` comment, sidechat `:6-9` |
| `priority` | **omit** — `extension` is the default and correct band | registry `(host) :58`, local-files `:41-42` |

`order` is **not** a definition field; it lives inside each guide entry
(`SidebarRightGuideEntry.order`, registry `(host) :61-63`). Shipped values: ui-file-preview
`20`, local-files `40`, sidechat `50`, taskpilot none (off-guide).

### Stage two — the body

```ts
// packages/local-files/src/client/index.ts:101-114
  // The right-Sidebar registration, straight-line (the ui-file-preview
  // pattern): the tab type into the registry, the body into the keyed pane
  // seat under the type's id. ...
  ctx.effect(() => ctx.sidebarRightTabs.register(localFilesDefinition(t)), 'local-files: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: LOCAL_FILES_TAB_ID,
    locale: NS,
    store: createLocalFilesStore,
    inject: browserFace,
  }, WorkspaceView)), 'local-files: sidebar tab body')
```

ui-file-preview is the same shape with an arrow face:

```ts
// packages/ui-file-preview/src/client/index.ts:199-216
  disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(filePreviewDefinition(t)), 'ui-file-preview: tab type'))

  // Stage two: the body under the type's id in the keyed pane seat.
  disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: FILE_PREVIEW_ID,
    locale: NS,
    store: createFilePreviewStore,
    inject: (sessionId: SessionId): FilePreviewTabInjected => ({
      listFiles: (sid: SessionId) => remote.list(sid),
      readFile: (sid: SessionId, path: string) => remote.read(sid, path),
      ...
    }),
  }, FilePreviewTab)), 'ui-file-preview: tab body'))
```

taskpilot registers the same body plus the optional live-title seat:

```ts
// packages/taskpilot/src/client/index.ts:89-96
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TASKPILOT_TAB_ID, locale: NS, inject: (): JobTabInjected => ({ loadHistory }) },
    JobTab,
  ))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TASKPILOT_TAB_ID },
    JobTabTitle,
  ))
```

The seat is declared by the host package (so it may not exist yet when the plugin applies):

```ts
// deepseek-harness/packages/client/ui-sidebar-right/src/client/contract/slots.ts:50-69 (host)
    'sidebar.right.pane.tab': {
      kind: 'keyed'
      scope: 'session'
      hookContext: TabHookContext
      inject: SidebarRightTabInjected
    }
    ...
    'sidebar.right.pane.tab.title': {
      kind: 'keyed'
      scope: 'session'
      hookContext: TabHookContext
      inject: SidebarRightTabInjected
    }
```

and `SidebarRightTabInjected` is only the hook factory:

```ts
// deepseek-harness/packages/client/ui-sidebar-right/src/client/contract/slots.ts:156-159 (host)
export interface SidebarRightTabInjected {
  hooks: { tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo> }
}
```

### `kind`: reuse a builtin or mint a new one?

**Mint a new kind for RSS (`'rss-reader'`).** Reuse of a builtin kind is a deliberate
*shadowing takeover* that only makes sense when the plugin is a functional superset of the
builtin card. The registry states the rule:

```ts
// deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:18-22 (host)
 * A kind may carry one `builtin` and one `extension` registration at once: the
 * extension is the one in force — claims, `get`, the guide page, and the body
 * and title, which the seat finds under the definition's own `id` — and the
 * builtin resumes when the extension unregisters. Everything else colliding on
 * a kind throws, as does a second registration of an `id`.
```

```ts
// deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:44-48 (host)
 * - `extension` — a type from outside the product, and the highest: a type that
 *   declares nothing outranks every viewer shipped here, exactly as in VS Code.
 *   It is also the band that may take over a `builtin` kind.
```

The one shipped takeover is local-files, and it says why:

```tsx
// packages/local-files/src/client/definition.tsx:5-14
 * The kind is the official files type's own (`dsh-client-ui-sidebar-files`):
 * the registry (`ui-sidebar-right`'s tab-registry) admits exactly one
 * `extension` registration per `builtin` kind and puts the extension in force
 * ... Our browser defaults to the session workspace and
 * browses any directory on top, a functional superset, so the official
 * workspace card is shadowed rather than duplicated on the guide page. ...
 * `id` stays our own — ids collide hard (a duplicate id throws), kinds are
 * the designed takeover channel.
```

Every other shipped page tab mints its own kind: `file-preview`
(ui-file-preview `:27`), `sidechat` (sidechat `:19`), `taskpilot` (taskpilot `:20`),
`worktrees` (`packages/worktrees/src/client/index.ts:14-17`). There is **no official RSS
builtin kind** to shadow — minting is the only correct choice.

### `store` and `inject` registration options

- `store` is **optional**, and it is a *factory* handle created at module level by
  `defineStore` (never a module-level instance — a module-level handle would pin identity
  across plugin reloads; see `packages/ui-file-preview/src/client/file-preview-store.ts:1-9`).
- `inject` is the registrant's **business face factory**. Its parameter list is derived by
  the slot runtime:

```ts
// deepseek-harness/packages/client/ui-slots/src/index.ts:491-506 (host)
 * Inject factory parameter list, derived from the registration's declaration:
 * strict session slots receive a definite framework-resolved `sessionId`;
 * session-maybe slots receive the current id or `undefined`; a declared store
 * appends the baked `actions` (the same callbacks the component receives).
 * Business data access happens through the apply closure's ctx — no binding
 * object parameter exists.
export type InjectParams<K extends keyof SlotMap & string, H> =
  ScopeOf<K> extends 'session'
    ? ([H] extends [StoreDecl] ? [sessionId: SessionIdOf, actions: BoundActions<HandleOf<H>>] : [sessionId: SessionIdOf])
```

  `sidebar.right.pane.tab` is `scope: 'session'`, so:
  - with `store` declared → `inject: (sessionId, actions) => Face`;
  - without `store` → `inject: (sessionId) => Face`.
- `locale: NS` adds the framework-synthesized `t` prop:

```ts
// deepseek-harness/packages/client/ui-slots/src/index.ts:578-586 (host)
  /** Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope). */
  store?: H
  /**
   * Dictionary namespace of this entry's copy. Declaring it puts the
   * framework-synthesized `t` seat (typed to the namespace's dictionary
   * union) on the component props; rendering requires an installed locale
   * face — fails loud otherwise.
   */
  locale?: N
```

  The word "exclusive" matters: the framework mints **one store instance per entry ×
  session scope** and caches it (`store create(scopeKey)` in
  `deepseek-harness/packages/client/store/src/index.ts:216-222`). A tab body that needs
  per-session UI state declares a store; one whose data all comes from the Remote does not:
  sidechat's tab body registers `store`-less (`packages/sidechat/src/client/index.ts:155-160`),
  local-files/ui-file-preview/worktrees declare one.

### `ctx.effect(...)` discipline

`register()` and `slots.inject()` already install their own fiber-scoped effects
(`(host) tab-registry.ts:257-267` wraps registration in `this.ctx.effect(...)`;
`(host) ui-renderer/src/client/registry.ts:174-232` wraps `inject` in `ctx.effect`). The
canonical plugin style additionally wraps both call sites in an outer `ctx.effect(callback,
'<plugin>: <what>')` so the label shows in diagnostics and HMR teardown unwinds them with the
plugin fiber:

```ts
// packages/local-files/src/client/index.ts:57
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-files: dictionaries')
```

Wrapping is the majority style (local-files, ui-file-preview, sidechat, worktrees). taskpilot
calls `ctx.slots.inject(...)` / `ctx.sidebarRightTabs.register(...)` bare
(`packages/taskpilot/src/client/index.ts:54,63,89-96`); both work because of the inner effect.
Either is acceptable; the outer wrapper is what the two reference packages do.

### What the RSS stub got wrong here

1. **No `ctx.effect` at all.** Every registration is a manual `disposers.push(...)` inside a
   `try {} catch {}` (`src/client/index.ts:19-46`). The canonical shape is
   `ctx.effect(() => ctx.sidebarRightTabs.register(def), 'rss-reader: tab type')`.
2. **`ctx.get('sidebarRightTabs')` instead of `ctx.sidebarRightTabs`** (`:27`). The service is
   already in `inject` (`:15`), so cordis guarantees it at apply time; `ctx.get` only adds a
   silent skip branch and an `any`-typed service. local-files uses the typed property
   (`:107`).
3. **Wrong `slots.inject` callback shape** (`:37`): the callback must *synchronously* return a
   disposer or iterable —

```ts
// deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:92 (host)
type SlotInjectionEffect = (() => void) | Iterable<() => void, void, void>
// deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:172 (host)
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void {
```

   The stub passes `async () => slotsService.register(...)` — a `Promise`, which is not a
   `SlotInjectionEffect` (it compiles only because `slotsService` is `any`). Also `await` on
   `inject(...)` is meaningless: `inject` already returns the sync disposer, so `uninstall`
   ends up being that function, not a resolved value.
4. **No `store`, no `inject` face** (`:38-42`). The body therefore receives no business face
   and no per-session state seat; `RssView` can never call the Remote.
5. **`inject` declares `sidebarRight` unused** (`:15`). For a page tab that never calls
   `openResource`/`openTab`, drop it — sidechat (`:66`) and local-files (`:40`) do not declare
   it; ui-file-preview (`:75`) and worktrees do because they navigate.
6. **`definition.tsx` types `t` as `(key: string) => string`** (`packages/dsh-rss-reader/src/client/definition.tsx:14`) instead of `TranslateNS<'rss-reader'>`, and uses
   the folder glyph for RSS:

```tsx
// packages/dsh-rss-reader/src/client/definition.tsx:10-12
function RssGlyph({ size, className }: IconProps) {
  return <FileTypeIcon kind="folder" size={size} className={className} />
}
```

   The kind itself (`'rss-reader'`, `:7`) is correctly minted — keep it. The guide `order: 50`
   (`:20`) ties sidechat's; ties sort by registration order
   (`(host) tab-registry.ts:394-399`), so pick a distinct value.

---

## 2. Client plugin entry

### Pattern to copy (1–2 lines)

An `async function apply(ctx): Promise<() => Promise<void>>` that (a) `await ctx.remote.$mount(<pkg>/remote)` inside `try/catch` that **logs** the double-mount composition error, (b) wraps
`ctx.locale.register` in `ctx.effect`, (c) reads its own Remote namespace back with `ctx.get`
(after the mount settles), (d) registers the tab type + body via `ctx.effect`, and (e) returns
a disposer that resolves the mounted Remote's disposers.

### Canonical shape

```ts
// packages/local-files/src/client/index.ts:39-59
/** Required services: slots, the remote channel, the locale, and the tab-type registry. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(localFilesRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-files: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote.localFiles') as LocalFilesRemote
```

Disposer handling is deliberately thin — the `ctx.effect` registrations die with the plugin
fiber, only the Remote mount needs explicit unwinding:

```ts
// packages/local-files/src/client/index.ts:116-118
  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
```

ui-file-preview adds a **capability handshake gate** before registering any visible surface —
worth copying for RSS because refresh/quote depend on optional host capabilities:

```ts
// packages/ui-file-preview/src/client/index.ts:98-110
  const remote = ctx.get('remote.filePreview') as FilePreviewRemote | undefined
  if (remote === undefined) {
    return async () => { await Promise.all(disposers.map(dispose => dispose())) }
  }
  try {
    const capabilities = await remote.capabilities()
    if (!capabilities.ok || capabilities.value.protocolVersion !== 1) {
      return async () => { await Promise.all(disposers.map(dispose => dispose())) }
    }
  } catch {
    return async () => { await Promise.all(disposers.map(dispose => dispose())) }
  }
```

Its disposer runs the surfaces' disposers in **reverse**:

```ts
// packages/ui-file-preview/src/client/index.ts:273-275
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
```

### Required vs optional `inject` keys

| key | required? | evidence |
| --- | --- | --- |
| `slots` | **required** — the seat dispatch | local-files `:40`, ui-file-preview `:75`, sidechat `:66`, quote `:55` |
| `remote` | **required** — `$mount` | all five |
| `locale` | **required** if any locale seat/`t` is used | all five |
| `sidebarRightTabs` | **required** for a sidebar tab type | local-files `:40`, sidechat `:66`, taskpilot `:48` |
| `sidebarRight` | **only if you navigate** (`openResource`/`openTab`) | ui-file-preview `:75`, taskpilot `:48`, worktrees; sidechat/local-files omit it |
| `sessions` | hard-inject when the plugin needs the session runtime; otherwise probe | message-tools `:76`, message-timeline `:43` inject it; quote probes it (`quote/src/client/index.ts:104`) |
| `conversation` | **probe, don't inject, if you want to degrade** | message-tools hard-injects it (`:76`), message-timeline does **not** and reads `actx.get('conversation')` (`message-timeline/src/client/index.ts:68-70`) |

The two idioms for a second-round service read:

```ts
// packages/ui-file-preview/src/client/index.ts:92-98 (deliberate ctx.get)
  // The namespace is registered by $mount above; `ctx.remote.filePreview`
  // cannot see it (the property proxy walks the fiber chain, and the namespace
  // lives in the sibling fiber $mount spawned), so read it from the global
  // store once the mount has settled ...
  const remote = ctx.get('remote.filePreview') as FilePreviewRemote | undefined
```

```ts
// packages/taskpilot/src/client/index.ts:56-61 (deliberate ctx.get for an optional namespace)
  const loadHistory = createHistoryLoader(ctx.get('remote.session'), ctx.get('connection'))
```

```ts
// packages/quote/src/client/index.ts:103-109 (probe-and-no-op, the degrade rule)
  const insertQuote = (sessionId: SessionId, block: string): void => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    if (scope === undefined) return
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return
    input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  }
```

### Degrade-don't-explode

The AGENTS.md rule ("probe optional host capabilities at apply time … degrade silently or to
an empty state") is implemented two ways:

- **Seat probing via `slots.inject`** — a host without the seat simply never installs the
  entry, no throw (`quote/src/client/index.ts:126-135`, comment: "degrades silently on a host
  without the seat — the plugin then adds no surface at all").
- **Explicit `ctx.get(...) === undefined` guards** for a capability the plugin can live
  without (`quote/src/client/index.ts:88-98`, `sidechat/src/client/index.ts:111-115`,
  `ui-file-preview/src/client/index.ts:99-101`).

**Caution about the set of things that are genuinely optional.** In the shipped web
composition `slots`, `locale`, and `remote` are always present; a plugin that hard-injects
`slots` is not "fragile", it is declaring its wiring. The stub's `try/catch` around
`ctx.remote.$mount` and `ctx.locale.register` is the wrong reaction: those failures are
composition errors and the canonical entry **logs** them (`ctx.logger.error(error)`,
local-files `:55`) rather than swallowing them with `catch { /* degrade silently */ }`
(stub `:21,25,33,46`).

### What the RSS stub got wrong here

- `(ctx as any).remote.$mount` / `(ctx as any).locale` / `(ctx as any).get('slots')` — every
  one of these services is already declared in `inject` (`:15`), so the `any` casts only erase
  types. `ctx.remote.$mount` and `ctx.locale.register`/`bind` are typed.
- The bare `catch { /* degrade silently */ }` blocks hide exactly the failures the repo wants
  to see (double-mount, a missing locale runtime).
- No handshake: the Remote advertises `capabilities()` (`src/remote.ts:77-80`) but the client
  never calls it, unlike ui-file-preview `:102-109`.
- `RssView` receives only `{ sessionId?: string }` (`src/client/RssView.tsx:5-7`) — it does not
  consume the composed props at all; nothing is typed against
  `PropsRuntime<'sidebar.right.pane.tab'>` / `InjectFace<...>` / `PropsLocale<...>`.

---

## 3. Remote / contract split

### Pattern to copy (1–2 lines)

Host-side logic lives in `src/service.ts` (the `ctx.<service>` core); `src/remote.ts` is a
thin `TypertRemoteService` adapter that only delegates, one `@Remote('verb')` method per verb;
`src/index.ts` does `ctx.provide('<service>', core)` then `ctx.plugin(RemoteService, {})`;
the client's `src/client/contract.ts` owns the composed-props types and aliases the Remote as
`TypertRemoteNamespaceMap['<namespace>']`; the browser mounts it with
`ctx.remote.$mount(pkgRemote)`. Business failures return `RemoteResult<T>`
(`{ok:true,value}` / `{ok:false,error}`) — the host method returns the bare value and the wire
folds carrier + thrown errors into the error branch.

### What lives where

`src/service.ts` — the real logic, no wire concerns:

```ts
// packages/local-files/src/service.ts:150-161
/** The local-files service. One instance per plugin mount; holds no mutable state. */
export class LocalFilesService {
  async listLocalDirectory(path: string): Promise<ListLocalDirectoryResult> {
```

`src/remote.ts` — a delegating adapter, one decorator per verb:

```ts
// packages/local-files/src/remote.ts:30-54
export class LocalFilesRemoteService extends TypertRemoteService<LocalFilesRemoteConfig> {
  static inject = ['localFiles']

  constructor(ctx: Context, _config: LocalFilesRemoteConfig = {}) {
    super(ctx, 'localFilesRemote', { namespace: 'localFiles' })
  }

  private get localFiles(): LocalFilesService {
    return this.ctx.localFiles
  }

  @Remote('listDirectory')
  listDirectory(request: ListLocalDirectoryRequest): Promise<ListLocalDirectoryResult> {
    return this.localFiles.listLocalDirectory(request.path)
  }
```

Note `static inject = ['localFiles']` on the adapter (remote.ts:31): the adapter waits for the
core rather than probing it.

`src/index.ts` — provide then mount:

```ts
// packages/local-files/src/index.ts:29-33
export function apply(ctx: Context): void {
  const service = new LocalFilesService()
  ctx.provide('localFiles', service)
  ctx.plugin(LocalFilesRemoteService, {})
}
```

`src/client/contract.ts` — the browser-side type home:

```ts
// packages/local-files/src/client/contract.ts:30-57
/** The localFiles Remote namespace (list + readFile), as mounted by this plugin. */
export type LocalFilesRemote = TypertRemoteNamespaceMap['localFiles']

/** Business face injected into the file-browser view (either seat). */
export interface WorkspaceViewInjected {
  /** List one local directory (git-agnostic browser plane). */
  listDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
  ...
}

/** Full props of the file-browser view. */
export type WorkspaceViewProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createLocalFilesStore>>
  & InjectFace<WorkspaceViewInjected>
  & PropsLocale<'localFiles'>
```

The generated artifacts are package exports, not source files:

```json
// packages/local-files/package.json:33-40
    "./typert": {
      "types": "./lib/typert.host.d.ts",
      "default": "./lib/typert.host.js"
    },
    "./remote": {
      "types": "./lib/typert.remote-client.d.ts",
      "default": "./lib/typert.remote-client.js"
    },
```

and the client imports the default export of `@khorsheed/dsh-local-files/remote`
(`packages/local-files/src/client/index.ts:23`) under a type-only self-import that pulls the
`ctx.remote` merge (`packages/local-files/src/client/index.ts:19`).

### Error shape: result objects, not throws

```ts
// deepseek-harness/packages/typert/protocol/src/types.ts:62-74 (host)
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }
```

The host method signature is the **bare business value** (`remote.ts:45` above); the wire wraps
it. The client therefore never wraps a call in `try/catch` to recover a business failure:

```ts
// packages/ui-file-preview/src/client/FilePreviewTab.tsx:220-221
      if (result.ok) actions.setList(result.value)
      else actions.setListError(result.error.message)
```

```ts
// packages/ui-file-preview/src/client/turn-files-cache.ts:29-33
    return remote.turnFiles(sessionId).then((result) => {
      const merged = cache.get(sessionId) ?? new Map<string, Map<number, readonly FilePreviewTurnFile[]>>()
      if (result.ok) {
```

A domain-level refusal is also a value, not a throw — quote's `addRef` returns its own tagged
outcome and the host folds the seam error into it:

```ts
// packages/quote/src/remote.ts:68-85
  @Remote('addRef')
  async addRef(request: QuoteAddRefRequest): Promise<QuoteAddRefOutcome> {
    if (request.contextKey.trim() === '' || request.ref.text.trim() === '') {
      return { ok: false, error: 'empty' }
    }
    const sideChat = this.ctx.get('sideChat') as SideChatMirror | undefined
    if (sideChat === undefined) return { ok: false, error: 'unavailable' }
    try {
      await sideChat.openWith({
        contextKey: request.contextKey,
        label: request.label ?? request.contextKey,
        refs: [request.ref],
      })
      return { ok: true }
    } catch {
      return { ok: false, error: 'io' }
    }
  }
```

Two clarifications:

- `this.ctx` is available to a `TypertRemoteService` subclass — quote uses
  `this.ctx.get('sideChat')` with no cast (`quote/src/remote.ts:73`). `TypertRemoteService
  extends Service<T>` (`(host) typert/protocol/src/index.ts:153`), and cordis `Service` carries
  the protected `ctx`.
- **Do not double-wrap.** The RSS stub's wire methods return `{ ok: true, feeds: [] }`
  (`src/remote.ts:85-87`) *inside* a `RemoteResult`, so the client would have to write
  `result.value.ok`. Either return the bare value and let the carrier wrap it (the shipped
  pattern), or — if a domain refusal is meaningful — return a tagged union as the bare value
  (quote's `QuoteAddRefOutcome`) and check `result.ok` then `result.value.ok`.

### What the RSS stub got wrong here

1. **No service core at all.** `src/index.ts:32-34` mounts the Remote directly, and every verb
   is an inline literal (`listFeeds` → `{ok:true,feeds:[]}`, `listEntries` → `{ok:true,entries:[]}`).
   There is no `ctx.fs`/fetch logic, no `ctx.rssReader` core, no `src/service.ts`. The Remote
   is supposed to be "a thin adapter over the same `ctx.localFiles` service core — no logic is
   copied" (`packages/local-files/src/remote.ts:2-4`).
2. **Double envelope** (`src/remote.ts:85-87,91-93` and `src/types.ts:59-62,73-76`): domain
   `{ok:true,...}` inside the carrier's `{ok,value}`.
3. **Unnecessary cast** `(this as unknown as { ctx: Context }).ctx` (`src/remote.ts:104`) with
   a comment claiming `this.ctx` is inaccessible — quote disproves it (`quote/src/remote.ts:73`).
4. **`updateFeed`/`deleteFeed` return the string `'Not implemented in this build stage'`** as
   a business refusal (`src/remote.ts:118,124`) — no tagged error vocabulary
   (compare `QuoteAddRefError` in `packages/quote/src/types.ts:34-40`).
5. **No request/response typing discipline in `types.ts`:** requests carry an unused `kind`
   discriminant (`RssListFeedsRequest` is never a parameter — `listFeeds()` takes none,
   `src/remote.ts:85`), and responses are `...Outcome` with a baked `ok` instead of clean
   payload types.
6. `capabilities()` exists (`:77-80`) but the client never calls it — either gate on it
   (ui-file-preview) or drop it.

---

## 4. State store

### Pattern to copy (1–2 lines)

Per-tab UI state is a client store declared with `defineStore({ init, persist?, actions })`
from `@deepseek-ai/dsh-client-store`, exported as a **factory** and passed to the registration
as `store:`; the body reads it with `useStore(s => ...)` and writes with the baked
`props.actions`. The store seat is per-entry × session, **in-memory (plus optional
localStorage)** — durable feed/entry persistence is **not** provided by the framework and must
be implemented in the plugin's host half over `ctx.fs` (the sidechat/canvas precedent).

### In-process store shape

```ts
// packages/local-files/src/client/store-local.ts:58-95
export function createLocalFilesStore(): EngineStoreHandle<LocalFilesState, LocalFilesActions> {
  return defineStore({
    init: (): LocalFilesState => ({ ...INITIAL }),
    actions: {
      setSession: (d, sessionId: string, start: string) => {
        d.sessionId = sessionId
        d.root = start
        ...
      },
      setListing: (d, listing: ListLocalDirectoryResult) => {
        d.listing = listing
        d.loading = false
        d.error = null
      },
      refresh: (d) => { d.rev += 1 },
    },
  })
}
```

The contract's shape:

```ts
// deepseek-harness/packages/client/store/src/contract.ts:55-83 (host)
export interface StoreSpec<T, A extends ActionsDecl<T>> {
  init: () => T
  persist?: string
  actions: A
}

export interface StoreInstance<T, A extends ActionsDecl<T>> {
  readonly actions: BakedActions<T, A>
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  clearPersisted(): void
}
```

So the pattern is: `actions` are pure draft mutators `(draft, ...params) => void`; the store's
exposed `actions` are the baked `(...params) => void` form; `getSnapshot()`/`subscribe()` are
the observable hook pair the render machinery binds `useStore` to. The component side:

```tsx
// packages/local-files/src/client/WorkspaceView.tsx:69-78
  sessionId, useStore, useSessions, actions, t,
  ...
  const root = useStore(s => s.root)
  const currentSession = useStore(s => s.sessionId)
  const listing = useStore(s => s.listing)
```

A store that is **per-tab within one session** keys its per-tab slice by `TabId`
(`packages/ui-file-preview/src/client/file-preview-store.ts:26-27,31-38,63`).

Also note the fetch/refresh convention is a **revision counter**, not a command:

```ts
// packages/ui-file-preview/src/client/file-preview-store.ts:34
  /** Bumped by the refresh action to re-trigger the list fetch. */
  listRequestRev: number
```

```ts
// packages/ui-file-preview/src/client/file-preview-store.ts:70-71
      /** Re-trigger the list fetch. @param d - draft state. */
      refreshList: (d) => { d.listRequestRev += 1 },
```

### What the framework gives a sidebar tab

- A store instance **per registration × session scope**, framework-minted and cached
  (`(host) client/store/src/index.ts:216-222`, "one instance per handle x scope key").
- Optional localStorage persistence via the `persist` key, scoped by session:

```ts
// packages/sidechat/src/client/dock-store.ts:44-47
export function createSideChatDockStore(): EngineStoreHandle<SideChatDockState, SideChatDockActions> {
  return defineStore({
    persist: 'dsh.sidechat.dock',
    init: (): SideChatDockState => ({ open: false, contextKey: null, x: HOME_X, y: HOME_Y }),
```

  `persist` is the *only* shipped client persistence (`grep -rn "persist:" packages/*/src` finds
  exactly this one line), and it is browser localStorage — not the host state dir.
- It does **not** give: any file/JSON document persistence, any cross-session shared store for a
  session-scoped seat, any host-side state. Feed subscriptions and the entry cache are durable
  data owned by the host half.

### Host-side persistence precedent

```ts
// packages/sidechat/src/store.ts:95-115
  constructor(ctx: Context, config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveSideChatStateRoot(config.stateRoot)
    // Deferred injection, NOT an apply-time probe (canvas's tools precedent):
    // the fs service's mount order is not ours to race — a constructor-time
    // `ctx.get` silently loses it and memory-only-degrades the store forever
    // (the 3080 persistence bug: contexts.json was never written). ...
    ctx.inject(['fs'], (fsCtx) => {
      this.fs = fsCtx.get('fs') as Context['fs'] | undefined
      ...
    })
  }
```

```ts
// packages/sidechat/src/store.ts:186-196
  async write(doc: SideChatContextsDoc, version: FsVersion | null, session: Session | undefined): Promise<FsVersion> {
    if (this.fs === undefined) throw new SideChatStoreError('sidechat: no filesystem is mounted', 'io')
    const receipt = await this.fs.writeText(
      await this.target(),
      serializeDoc(doc),
      version === null ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version },
      undefined,
      this.policyOf(session),
    )
    return receipt.version
  }
```

The read side tolerates a missing file and refuses a corrupt one:

```ts
// packages/sidechat/src/store.ts:154-174
  async read(): Promise<SideChatStoreRead> {
    if (this.fs === undefined) return { doc: emptyContextsDoc(), version: null }
    ...
    const info = await this.fs.stat(target)
    if (info === undefined || info.type !== 'file') return { doc: emptyContextsDoc(), version: null }
    try {
      return { doc: normalizeContextsDoc(JSON.parse(await this.fs.readText(target))), version: info.version }
    } catch (error) {
      if (error instanceof FsError) throw error
      throw new SideChatStoreError(
        `sidechat: ${target.displayPath} does not parse — fix or remove it by hand`,
        'io',
      )
```

Key facts for the RSS plugin to reuse verbatim:

- **State root resolution**: explicit config → `$DSH_HOME/state/<plugin>` → `<cwd>/.dsh-<plugin>`
  (`packages/sidechat/src/store.ts:47-52`; same shape in `packages/canvas/src/store.ts:52-58`).
- **Deferred `ctx.inject(['fs'], …)`**, never an apply-time `ctx.get('fs')` — the mount-order
  race is documented as a real shipped bug (`packages/sidechat/src/store.ts:97-105`).
- **One version-guarded JSON document**, `createIfAbsent` for the first write,
  `replaceIfVersion` afterwards; the caller owns one stale-version re-apply.
- Sandbox policy: the write stamps the calling session's resolved policy but re-roots
  `workspaceRoot` at the plugin's state dir (`packages/sidechat/src/store.ts:142-146`).

### What the RSS plugin must implement itself

1. **A host-side `RssStore`** (sidechat's `SideChatStore` shape) over `ctx.fs`: one
   `state.json` under a resolved state root, `read()`/`write()` with `FsVersion` guards,
   memory-only degradation when `fs` never mounts.
2. **The feed fetch + XML parse on the host side**, behind `ctx.get('fetch')`-style probes — the
   client cannot persist feed state and the store is per-session.
3. **The client store** for pure UI state (selected feed, "today"/"all" filter, per-tab
   selection, in-flight/error flags), mirroring `createFilePreviewStore` — including the
   `listRequestRev` refresh-counter idiom.
4. Optionally, `persist: 'dsh.rss-reader.view'` for the filter memory, exactly as sidechat's
   dock does.
5. **Not** the Remote data itself. Entries/feeds are Remote results; the store holds the latest
   fetched whole values plus the request revision (the ui-file-preview model).

### What the RSS stub got wrong here

```ts
// packages/dsh-rss-reader/src/store.ts (the whole file, 38 lines)
export function statePath(rootDir?: string): string { ... }
function initialDoc(): RssStateDoc { ... }
```

- The host "store" is two pure helpers and an unused `initialDoc()` — no class, no `ctx.fs`, no
  read/write, no version guard, no degradation. Nothing persists.
- `StoreVersion { version: number }` (`:11-13`) is a hand-rolled version type; the real token is
  `FsVersion` from `@deepseek-ai/dsh-fs` (`packages/sidechat/src/store.ts:31,62`).
- `statePath()` joins with `/`/`\\` by hand (`:22-25`) instead of `node:path`'s `join`, which
  the host precedent uses (`packages/sidechat/src/store.ts:29,130`).
- There is **no client store at all** — no `defineStore`, no `store:` registration, so the tab
  has no state seat and no per-session memory.
- `refreshIntervalMinutes` / `refreshTimeOfDay` live in the Remote config type
  (`src/remote.ts:60-65`) but nothing consumes them.

---

## 5. Quote / reference into the current conversation

### Pattern to copy (1–2 lines)

The sanctioned "insert into the conversation" path is the **official composer input machine**:
`ctx.sessions.scope(sessionId)` → `scope.get('conversation').input.for(scope)` →
`input.setDraft(merged(input.state.getSnapshot().draft, block))`. There is no quote-service
dependency and no `sideChat` dependency for this route; the pure merge/format helpers are the
plugin's own (quote's `formatQuoteBlock` / `mergedQuoteDraft` are 30 lines in
`packages/quote/src/types.ts`). For side-chat refs, the sanctioned seam is
`ctx.get('sideChat').openWith({contextKey, label, refs})` — probed, structural, and reached
from the browser through the plugin's own thin Remote (quote's `addRef`).

### The composer insertion path (the answer to "what is the minimum a different plugin calls")

```ts
// packages/quote/src/client/index.ts:100-109
  // 「引用到当前会话」: the message-tools backfill path — resolve the session's
  // scope, read the live draft, and write the merged one back. Every absence
  // (scope gone, conversation service missing) is a silent no-op.
  const insertQuote = (sessionId: SessionId, block: string): void => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    if (scope === undefined) return
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return
    input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  }
```

The same call in the two other shipped plugins that write the draft:

```ts
// packages/message-tools/src/client/index.ts:122-133
  const backfill = (sessionId: SessionId, text: string): void => {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`message-tools: session "${sessionId}" resolved no scope`)
    const conversation = actx.get('conversation')
    if (conversation === undefined) throw new Error('message-tools: conversation service unavailable')
    const input = conversation.input.for(actx)
    input.setDraft(mergedDraft(input.state.getSnapshot().draft, text))
    input.notify('info', t('withdrawn.backfilled'))
  }
```

The official API surface it targets:

```ts
// deepseek-harness/packages/client/ui-conversation/lib/types/client/contract/input.d.ts:169-200 (host)
export interface SessionInput extends InputTarget {
    /** Replace the whole draft (persisted-draft seed and programmatic writes). */
    setDraft(text: string): void;
    ...
    /** Input state store (InputZone currency + decorations read here). */
    readonly state: SnapshotStore<InputState>;
}
/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolver {
    /** Resolve the facade for one session-scope ctx. */
    for(actx: Context): SessionInput;
}
```

Note `for(actx: Context)` takes the **session-scoped Context**, which is exactly what
`ctx.sessions.scope(sessionId)` returns (`(host) api/session-controller/src/client/contract/sessions.ts:99-103`:
`scope(id: SessionId): AgentContext | undefined`). `input.setDraft` **replaces** the whole
draft, which is why every caller first reads the live draft via
`input.state.getSnapshot().draft` and merges.

The formatting/merge helpers are plain plugin code — copy them:

```ts
// packages/quote/src/types.ts:59-75
export function formatQuoteBlock(text: string, attribution: string): string {
  const lines = text.trim().split('\n').map(line => `> ${line}`)
  return [...lines, `> ${attribution}`].join('\n')
}

export function mergedQuoteDraft(current: string, block: string): string {
  return current.trim() === '' ? block : `${current}\n\n${block}`
}
```

### Is there a sanctioned cross-plugin path, or does everyone roll their own?

**There is one official path for the composer, and it is a public service — everyone uses it,
nobody needs to depend on `quote`/`sidechat`.**

| route | mechanism | compile-time deps | evidence |
| --- | --- | --- | --- |
| quote → current conversation | `sessions.scope(id).get('conversation').input.for(scope).setDraft(...)` | none beyond official `sessions`/`conversation` | quote `:103-109`, message-tools `:122-133`, message-timeline `:65-79` |
| quote → side chat (ref) | queue on the session's side-chat context through the side-chat service seam | none (structural mirror + `dsh.references`) | quote `src/remote.ts:36-43,73-80` |
| surface a sidebar page/tab | `ctx.sidebarRight.openTab(kind, {params})` / `openResource(address)` | none (official nav face) | quote `:120-121`, sidechat `:119-122`, taskpilot `:80` |
| render an `@file` mention in prose | `chatFileMentions` (inbound clicks only) | structural wrap | ui-file-preview `mentions-wrap.ts:33,61-88` |
| `@`-completion reference insertion | official `ui-reference` input-trigger source (`InsertReferenceRequest` + token spans) | heavy; no simple public insert-by-text | `(host) client/ui-reference/README.md` |

The side-chat seam, in full:

```ts
// packages/quote/src/remote.ts:36-43
export interface SideChatMirror {
  /** Open (or update) one chat context: display label plus queued refs. */
  openWith(input: {
    readonly contextKey: string
    readonly label: string
    readonly refs?: readonly QuoteRef[]
  }): Promise<void>
}
```

```ts
// packages/quote/src/remote.ts:73-80
    const sideChat = this.ctx.get('sideChat') as SideChatMirror | undefined
    if (sideChat === undefined) return { ok: false, error: 'unavailable' }
    try {
      await sideChat.openWith({
        contextKey: request.contextKey,
        label: request.label ?? request.contextKey,
        refs: [request.ref],
      })
      return { ok: true }
```

Its manifest declares the relationship as data, never a dependency:

```json
// packages/quote/package.json:162-164
    "references": [
      "@khorsheed/dsh-sidechat"
    ]
```

and the rationale is explicit in the source comment:

```ts
// packages/quote/src/remote.ts:9-13
 * must land as a PENDING ref. So the route crosses through this thin face,
 * whose host half probes `ctx.get('sideChat')` and calls `openWith` — the
 * sanctioned host-to-host seam (the canvas `askAgent` precedent), mirrored
 * STRUCTURALLY: the sidechat package is never imported (the one edge is the
 * probed service name, declared in the manifest's `dsh.references`).
```

The quote plugin's client also probes the presence of the sidechat *Remote* namespace for
visibility, without importing it:

```ts
// packages/quote/src/client/index.ts:96-98
  const sideChatAvailable = (): boolean =>
    quoteNamespace() !== undefined
    && (ctx.get('remote.sidechat') as SideChatRemotePresence | undefined) !== undefined
```

`ui-file-preview`'s mention wrap is **not** an insertion route — it intercepts clicks on
already-rendered prose mentions (`mentions-wrap.ts:6-13`), and it is worth noting only because
it shows the in-place-mutation workaround for a service with no official cross-plugin override
(`:15-25`).

### Minimum an RSS plugin needs

1. To quote an entry into the current conversation: **no new host code and no cross-plugin
   dependency** — in the tab body's injected face or click handler, call
   `ctx.sessions.scope(sessionId).get('conversation').input.for(scope)` and
   `setDraft(mergedQuoteDraft(current, block))`, exactly as quote does. Declare `sessions` in
   `inject` (core service); probe `actx.get('conversation')` per call so a composition without
   the conversation package degrades to a no-op (the message-timeline split: inject
   `['slots','sessions','locale']`, `message-timeline/src/client/index.ts:43`).
2. To quote an entry into the side chat: **mirror quote's shape exactly** — a thin
   `@Remote('addRef')` verb on the RSS Remote whose host half probes `ctx.get('sideChat')` and
   calls `openWith({ contextKey: sessionId, label, refs: [{label, text}] })`, returning a tagged
   `{ok:false,error:'unavailable'|'empty'|'io'}` union; declare
   `dsh.references: ["@khorsheed/dsh-sidechat"]` and never import the package. Because
   sidechat's own Remote has no client-reachable refs verb (`quote/src/remote.ts:6-9`), this
   route must cross through the RSS plugin's own host half; there is no shortcut.
3. **Do not** build the reference text on the host and store it — the ref is opaque
   `{label, text}`, and the conversation-side block is markdown the client formats
   (`quote/src/types.ts:49-62`).

### What the RSS stub got wrong here

- `generateRef` returns hard-coded Chinese placeholder text
  (`src/remote.ts:129-132`: `` text: `来自 RSS 的引用内容（${request.entryId}）` ``) — it neither
  reads the entry nor formats a real block, and `request.format`
  (`'markdown-block' | 'plain-text'`, `src/types.ts:120-125`) is ignored.
- No client insertion code exists: `RssView` is `return null`
  (`src/client/RssView.tsx:9-13`) and the locale keys `entry.quote` / `entry.quote.side`
  (`src/client/locales.ts:18-19,37-38`) are never referenced.
- `package.json` declares `"references": ["@khorsheed/dsh-sidechat", "@khorsheed/dsh-quote"]`
  (`packages/dsh-rss-reader/package.json:174-177`) and the compat note says it probes
  `ctx.get('sideChat')` — but nowhere in the source is `sideChat` or `remote.sidechat` read
  (`grep -rn "sideChat\|remote.sidechat" packages/dsh-rss-reader/src` → only that comment in
  `src/index.ts:5`). The `@khorsheed/dsh-quote` reference is also unnecessary for the composer
  route, which is official.

---

## 6. Tests

### Pattern to copy (1–2 lines)

`tests/*.spec.ts(x)` run under the package's own `vitest.config.ts` → `dshTestConfig()` (no
jsdom in the config); a browser test opts in with a first-line
`// @vitest-environment jsdom` docblock. The three shipped test kinds for a sidebar plugin are:
(1) a **definition unit test** (id/kind/priority/patterns/guide), (2) a **store unit test**
(draft actions via `create().actions` + `create().getSnapshot()`), and (3) a **browser-plugin
integration test** that boots the real `apply` on a real cordis `Context` with fake
`remote`/`locale`/`slots`/`sidebarRightTabs` faces and asserts the type lands in the registry
and the body lands in the keyed seat.

### Setup

```ts
// packages/local-files/vitest.config.ts (whole file)
import { dshTestConfig } from '../../build/vitest.ts'

export default dshTestConfig()
```

```ts
// packages/local-files/package.json:110-114
  "scripts": {
    "build": "tsx ../../scripts/gen-typert.mts && tsc -b tsconfig.json && tsdown",
    "test": "vitest run",
    "typecheck": "tsc -b tsconfig.json --noEmit"
  },
```

The shared preset carries no environment (so node tests are the default) and does the
source-plane aliasing:

```ts
// build/vitest.ts:147-162
  return defineConfig({
    esbuild: { jsx: 'automatic' },
    test: { testTimeout: 30_000, maxWorkers: defaultTestWorkers() },
    resolve: { dedupe: ['react', 'react-dom'], alias },
    plugins: [
      sourcePathsPlugin(harness, paths, /^@deepseek-ai\//),
      localPackagePlugin(),
    ],
  })
```

A DOM test opts in **per file**:

```tsx
// packages/local-files/tests/workspace-view.client.spec.tsx:1-9
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceViewProps } from '../src/client/contract.ts'
import { clearLocalRoot, localRootOf, rememberLocalRoot } from '../src/client/local-root.ts'
import { createLocalFilesStore } from '../src/client/store-local.ts'
import { WorkspaceView } from '../src/client/WorkspaceView.tsx'
```

`pnpm run test` at the root fans out per package (`package.json:11`), and AGENTS.md forbids bare
`vitest run` (it bypasses the alias preset). The stub already has the right config
(`packages/dsh-rss-reader/vitest.config.ts` is line-for-line the same).

### Kind 1 — definition unit test

```ts
// packages/local-files/tests/definition.client.spec.ts:13-35
describe('localFilesDefinition', () => {
  it('registers as a page type under the package identity, claiming no address', () => {
    const definition = localFilesDefinition(t)
    expect(definition.id).toBe(LOCAL_FILES_TAB_ID)
    // The kind is the official files type's own: the extension band takes the
    // builtin kind over (the registry's designed shadowing), so the guide
    // lists one files card — ours.
    expect(definition.kind).toBe('files')
    expect(LOCAL_FILES_KIND).toBe('files')
    expect(definition.patterns).toBeUndefined()
    expect(definition.priority).toBeUndefined()
    expect(definition.title('sidebar://local-files')).toBe('t:tab.label')
  })

  it('offers one guide entry parked after the built-in cards', () => {
    const definition = localFilesDefinition(t)
    expect(definition.guide?.length).toBe(1)
    const entry = definition.guide![0]!
    expect(entry.order).toBe(40)
    ...
```

### Kind 2 — store unit test

```ts
// packages/ui-file-preview/tests/store.client.spec.ts:1-13
import { describe, expect, it } from 'vitest'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

const tab = (id: string): TabId => id as TabId

function makeStore() {
  const instance = createFilePreviewStore().create()
  return { actions: instance.actions, getState: () => instance.getSnapshot() }
}
```

then draft-action assertions (`store.client.spec.ts:15-49`: initial state via `toMatchObject`,
per-tab independence, whole-value replacement, `refreshList` bumps the revision).

### Kind 3 — browser-plugin integration test (the one the stub is missing)

```ts
// packages/local-files/tests/browser-plugin.client.spec.ts:18-52
/** Boot the plugin over fake faces; the tab-type registry records registrations. */
async function bench() {
  const ctx = new Context()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const mount = vi.fn(async () => () => {})
  Object.assign(ctx.remote, { $mount: mount })
  ctx.provide('remote.localFiles', {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const registered: SidebarRightTabDefinition[] = []
  ctx.provide('sidebarRightTabs', {
    register: (definition: SidebarRightTabDefinition) => {
      registered.push(definition)
      return () => { registered.splice(registered.indexOf(definition), 1) }
    },
  })
  await ctx.plugin(SlotRegistry).await()
  // Declare the target seat (normally declared by ui-sidebar-right).
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, mount, registered }
}
```

```ts
// packages/local-files/tests/browser-plugin.client.spec.ts:54-69
describe('local-files browser plugin', () => {
  it('registers the files tab type and its body in the pane seat', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(b.registered.map(d => d.id)).toContain(LOCAL_FILES_TAB_ID)
    })
    const definition = b.registered.find(d => d.id === LOCAL_FILES_TAB_ID)
    expect(definition?.kind).toBe(LOCAL_FILES_KIND)
    await vi.waitFor(() => {
      const entries = b.ctx.slots.entries('sidebar.right.pane.tab')
      expect(entries.map(entry => entry.options.key)).toContain(LOCAL_FILES_TAB_ID)
    })
    await b.fiber.dispose()
    expect(b.registered).toHaveLength(0)
  })
})
```

The comment at the head of that file states the *reason* to keep such a test:

```ts
// packages/local-files/tests/browser-plugin.client.spec.ts:2-9
 * The browser half on a real cordis Context with fake remote / locale / slots
 * / sidebarRightTabs faces: the plugin must land the `files` tab type in the
 * registry and its body in the keyed `sidebar.right.pane.tab` seat. Written
 * for the 673b1d7 regression where the sidebar entry silently vanished —
 * pinning the registration end to end beats re-deriving cordis resolution
 * rules by hand.
```

ui-file-preview runs the same boot with more surfaces and a host/remote capability gate
(`packages/ui-file-preview/tests/browser-plugin.client.spec.tsx:31-80`), and quotes the
`RemoteResult` envelope in its fake (`:37-40`).

### What shipped sidebar plugins test

- definition/registry shape — `local-files/tests/definition.client.spec.ts`;
- store draft actions — `ui-file-preview/tests/store.client.spec.ts`;
- component render/gesture with `@testing-library/react` (`render`/`screen`/`fireEvent`/
  `cleanup`) — `local-files/tests/workspace-view.client.spec.tsx`,
  `ui-file-preview/tests/FilePreviewTab.client.spec.tsx`, plus their pane-search specs;
- plugin boot/dispose registration — the two `browser-plugin.client.spec.ts(x)` files.

**"Contract tests"**: not found as a named category. `grep -rln "contract" packages/*/tests` and
a scan of the two sidebar packages' test lists show no file that tests the `contract.ts` types
at runtime — the composed-prop types are exercised *through* the component tests by passing
structurally-complete props (e.g. `local-files/tests/workspace-view.client.spec.tsx:22-30` builds
`WorkspaceViewProps` and a real store instance). Typert wire shape is checked by the generated
artifacts + tsc, not by a test.

### What the RSS stub got wrong here

```ts
// packages/dsh-rss-reader/tests/rss-reader.spec.ts:1-17 (the only test file)
import { describe, it, expect } from 'vitest'
import { stableEntryId, truncatePreview, defaultFeedLabel } from '../src/types'
describe('dsh-rss-reader vocabulary', () => {
  it('builds a stable entry id', () => { ... })
```

- It tests three pure helpers only. There is **no definition test**, **no store test** (there is
  no store), and critically **no browser-plugin boot test** — exactly the 673b1d7 regression the
  local-files test was written to prevent. The stub's registration bugs (§1) would all be caught
  by a single `bench()`-style test.
- No jsdom / `@testing-library/react` test despite those devDependencies being declared
  (`packages/dsh-rss-reader/package.json:128,131`).
- It imports `'../src/types'` without the `.ts` extension the rest of the repo uses
  (`'../src/types.ts'`); verify against the package's module resolution before copying.

---

## 7. Stub defect ledger

One line per concrete wrong thing in `packages/dsh-rss-reader`, with the pattern it violates.

| # | location | defect | correct pattern (evidence) |
| --- | --- | --- | --- |
| 1 | `src/client/index.ts:19-46` | every registration wrapped in `try {} catch { /* degrade silently */ }`; no `ctx.effect` | `ctx.effect(() => …, 'label')`; log composition errors (`local-files:55`) |
| 2 | `src/client/index.ts:20,23,27,35` | `(ctx as any)` casts for services already in `inject` | typed `ctx.remote` / `ctx.locale` / `ctx.sidebarRightTabs` / `ctx.slots` |
| 3 | `src/client/index.ts:27` | `ctx.get('sidebarRightTabs')` + undefined check | `ctx.sidebarRightTabs.register(...)` inside `ctx.effect` (`local-files:107`) |
| 4 | `src/client/index.ts:37-43` | `slots.inject` callback is `async` (returns Promise, not `SlotInjectionEffect`); `await` on a sync disposer | `() => ctx.slots.register(...)` (`local-files:108-114`) |
| 5 | `src/client/index.ts:38-42` | keyed body registration omits `store` and `inject` | `store: createXStore, inject: face` (`local-files:112-113`, `ui-file-preview:206-215`) |
| 6 | `src/client/index.ts:15` | `sidebarRight` injected but never used | omit unless navigating (`sidechat:66`, `ui-file-preview:75`) |
| 7 | `src/client/index.ts:23-24` | locale disposer retyped through `any` and manually awaited | `ctx.effect(() => ctx.locale.register(NS, {zh,en}), '…: dictionaries')` (`local-files:57`) |
| 8 | `src/client/RssView.tsx:5-13` | props are `{sessionId?: string}`, body returns `null`; no composed-props contract | `WorkspaceViewProps` intersection + `useStore`/`t`/injected face (`local-files/src/client/contract.ts:52-57`) |
| 9 | `src/client/definition.tsx:14` | `t` typed `(key: string) => string` | `TranslateNS<'rss-reader'>` (`local-files:46`) |
| 10 | `src/client/definition.tsx:10-12` | RSS tab uses the folder glyph | a package-owned glyph (`ui-file-preview:44-65`) or a fitting official icon (`sidechat:15,51`) |
| 11 | `src/client/index.ts:34-46` | no `ctx.remote.$mount` capability handshake | `remote.capabilities()` gate (`ui-file-preview:102-109`) |
| 12 | `src/remote.ts` (whole) | no service core; verbs are inline literals; `src/index.ts` never `ctx.provide` | `service.ts` core + thin adapter + `ctx.provide` (`local-files/src/index.ts:29-33`) |
| 13 | `src/remote.ts:104` | `(this as unknown as { ctx: Context }).ctx` cast | `this.ctx.get('sideChat')` (`quote/src/remote.ts:73`) |
| 14 | `src/remote.ts:85-93`, `src/types.ts:59-76` | domain `{ok:...}` nested inside the carrier `RemoteResult` | return the bare value (`local-files/src/remote.ts:44-47`) or one tagged union (`quote/src/remote.ts:68-85`) |
| 15 | `src/remote.ts:117-125` | refusals are `'Not implemented in this build stage'` strings | typed error vocabulary (`quote/src/types.ts:34-45`) |
| 16 | `src/store.ts` (whole) | no read/write, no `ctx.fs`, no version guard, no degradation; hand-rolled `StoreVersion`; manual path join | `SideChatStore` read/write (`sidechat/src/store.ts:154-196`), `ctx.inject(['fs'])` (`:106-114`), `node:path.join` |
| 17 | (missing file) | no client store at all | `createFilePreviewStore` + `store:` seat (`ui-file-preview/src/client/file-preview-store.ts:53-88`) |
| 18 | `src/remote.ts:129-132` | `generateRef` returns hard-coded placeholder text and ignores `format` | format from the entry client-side (`quote/src/types.ts:59-62`) |
| 19 | `package.json:174-177` | `dsh.references` lists `@khorsheed/dsh-quote` (unused) and `@khorsheed/dsh-sidechat` (never probed in code) | declare only what is probed (`quote/package.json:162-164`) |
| 20 | `tests/rss-reader.spec.ts` (whole) | helper-only tests; no boot test, no definition test, no store test | the three kinds in §6 (`local-files/tests/browser-plugin.client.spec.ts:54-69`) |
| 21 | `src/types.ts` whole model | `RssStateDoc` is `readonly` arrays yet is the persisted mutable document; requests carry an unused `kind` discriminant | mutable document + action-style store (`sidechat/src/types.ts` state doc style); drop discriminants (`local-files/src/types.ts:59-62`) |

---

## 8. Distilled skeleton for the rewrite (assembled from the quotes above — not new evidence)

```ts
// packages/dsh-rss-reader/src/index.ts
export const name = 'rss-reader'
export function apply(ctx: Context): void {
  const service = new RssService(ctx)          // sidechat's core shape, ctx.fs deferred inside
  ctx.provide('rssReader', service)
  ctx.plugin(RssReaderRemoteService, {})        // local-files/src/index.ts:29-33
}
```

```ts
// packages/dsh-rss-reader/src/client/index.ts
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs', 'sessions']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(rssReaderRemote))
  } catch (error) {
    ctx.logger.error(error)                     // local-files:49-56
  }
  const remote = ctx.get('remote.rssReader') as RssReaderRemote | undefined
  if (remote === undefined) return async () => { await Promise.all(disposers.map(d => d())) }
  try {
    const capabilities = await remote.capabilities()
    if (!capabilities.ok || capabilities.value.protocolVersion !== 1) {
      return async () => { await Promise.all(disposers.map(d => d())) }
    }
  } catch {
    return async () => { await Promise.all(disposers.map(d => d())) }
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rss-reader: dictionaries')
  const t = ctx.locale.bind(NS)

  const insertIntoConversation = (sessionId: SessionId, block: string): void => {
    const scope = ctx.sessions.scope(sessionId)          // quote:103-109
    const input = scope?.get('conversation')?.input.for(scope)
    if (input === undefined) return
    input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  }

  ctx.effect(() => ctx.sidebarRightTabs.register(rssReaderDefinition(t)), 'rss-reader: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: RSS_READER_TAB_ID,
    locale: NS,
    store: createRssReaderStore,
    inject: (sessionId: SessionId): RssReaderTabInjected => ({
      listFeeds: () => remote.listFeeds(),
      listEntries: (request) => remote.listEntries(request),
      refresh: (request) => remote.refresh(request),
      updateFeed: (request) => remote.updateFeed(request),
      deleteFeed: (request) => remote.deleteFeed(request),
      insertIntoConversation: (block: string) => { insertIntoConversation(sessionId, block) },
      quoteToSideChat: (label, text) => remote.addRef({ contextKey: sessionId, label, ref: { label, text } }),
    }),
  }, RssReaderTab)), 'rss-reader: sidebar tab body')

  return async () => { await Promise.all(disposers.map(d => d())) }
}
```

Keyed params (only if the plugin will be opened by `ctx.sidebarRight.openTab`):

```ts
// pattern from packages/taskpilot/src/client/definition.ts:25-35
export interface RssReaderTabParams { readonly feedId?: string }
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'rss-reader': RssReaderTabParams
  }
}
```

Auto-refresh: **not found.** None of the six named packages owns a host-side
daily/interval scheduler. The timer usages in the repo are client-side debounce/toast
(`packages/canvas/src/client/tab/DraftView.tsx:148`, `CanvasTab.tsx:111`) and the ankh-guard
watchdog CLI (`packages/ankh-guard/src/index.ts:665`) — neither is a plugin-domain schedule.
The host checkout has a `schedule` package (`deepseek-harness/packages/schedule`) but no plugin
in this repo composes it. Treat a host timer as new architecture, not a pattern to copy.
(search: `grep -rn "setInterval\|setTimeout" packages/*/src --include=*.ts --include=*.tsx`)

---

## 9. Not-found / searched list

- **A public cross-plugin "insert text/reference into the composer" service** other than
  `ctx.sessions.scope(id).get('conversation').input.for(scope)` — searched
  `packages/*/src` for `input.for`, `setDraft`, `insert`, and
  `deepseek-harness/packages/client/ui-conversation/lib/types` exports. The input machine is
  the only path; `ui-reference` owns structured `@` references behind
  `InsertReferenceRequest` + token spans and exposes no simple public insert-by-text.
- **A client-reachable side-chat refs verb** — `packages/sidechat/src/remote.ts` has
  `getState`/`listContexts`/`send`/`quoteMessage`/`surfaceHints`; quote's own remote comment
  says so explicitly (`quote/src/remote.ts:6-9`). Cross-plugin refs must go through the
  caller's own host half probing `ctx.get('sideChat')`.
- **A named "contract test" category** — searched `packages/*/tests` for files named
  `*contract*` and for imports of `src/client/contract.ts`; no test imports a contract module
  directly.
- **Client persistence to anything but localStorage** — `grep -rn "persist:" packages/*/src`
  returns exactly one hit (`sidechat/src/client/dock-store.ts:46`).
- **A host-side scheduled/timer precedent in the six named packages** — searched for
  `setInterval`/`setTimeout`/`cron`/`schedule` under `packages/*/src`. `schedule` exists in the
  host checkout (`deepseek-harness/packages/schedule`) but no plugin in this repo uses it;
  RSS auto-refresh has no proven pattern here.
- **A `sidebar.right.pane.tab` example registering `kind` as a builtin takeover for anything
  other than `files`** — local-files is the only shipped shadowing instance.
- **Any RSS-specific host capability** (an official feed/fetch service) — searched
  `deepseek-harness/packages` for `rss`/`feed`: none. Feed fetch/parse is the plugin's own
  host-side work over `ctx.fs`/`fetch`.
