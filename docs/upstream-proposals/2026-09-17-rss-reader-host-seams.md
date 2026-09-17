# RSS reader rewrite — host seams: fetch / state / scheduling / Remote / XML

Date: 2026-09-17
Author: `host-seams` (teammate recon, task-1)
Subject: which **host-side** seams a rewritten `@khorsheed/dsh-rss-reader` may use for
(a) outbound HTTP, (b) JSON state persistence, (c) a daily refresh timer, (d) the browser
RPC face, (e) XML parsing.

Rules of evidence: every claim is a file path + line number + quoted code. Nothing is
paraphrased from an API that was not read. Where no evidence exists the section says
**not found** and prints the exact search that failed. Read-only: no build, install, test,
or edit was performed except this file. `pnpm` was never invoked.

## 0. Method, host line, and where the host packages actually live

Pinned host line: **`0.1.5-rc.1`**.

```
~/code/deepseek-harness/package.json:2
  "version": "0.1.5-rc.1",
~/code/deepseek-harness/  (git HEAD)
183f08e9c6 Merge pull request #3912 from deepseek-harness/worktree/release/dsh-0.1.5-rc.1
1ef9c1fa9a release(dsh): 0.1.5-rc.1
```

### Correction: the prod profile does not contain the host packages, and the installed
### `@khorsheed/dsh-rss-reader` tarball is the running stub

The brief asked for evidence from
`$DSH_HOME/profiles/web/node_modules/@deepseek-ai/`. I searched it exhaustively; the host
service packages (`dsh-web`, `dsh-fs`, `dsh-typert-protocol`, …) are **not there**:

```
$ ls "$DSH_HOME/profiles/web/node_modules/@deepseek-ai/"
cosmokit
dsh-brand
dsh-client-ui-primitives -> ../../.dsh-module-fallback/node_modules/@deepseek-ai/dsh-client-ui-primitives
dsh-experimental-agent-team
dsh-experimental-agent-team-profile
dsh-experimental-agent-team-web-profile
dsh-experimental-client-ui-agent-team
dsh-experimental-tool-agent-team
schemastery

$ find "$DSH_HOME/profiles/web" -type d -name 'dsh-web'            -> (no output)
$ find "$DSH_HOME/profiles/web" -type d -name 'dsh-typert-protocol' -> (no output)
$ find "$DSH_HOME/profiles/web" -type d -name 'dsh-fs'             -> (no output)
```

(`$DSH_HOME` = `$DSH_HOME`.) The live instance runs the **harness
checkout** as its host, which is why those packages are absent from the profile:

```json
// $DSH_HOME/state/launch-spec.json (active)
"command": "DSH_HOME=$DSH_HOME node ~/code/deepseek-harness/apps/cli/lib/bin.js web --no-open --trusted-host ...",
"hostPackageVersion": "0.1.5-rc.1",
"credentialRepo": "~/code/deepseek-harness",
"harnessRoot": "~/code/deepseek-harness",
"profile": "web",
```

So the authoritative host source for every question below is
`~/code/deepseek-harness/packages/**` at that HEAD. Two things **are** useful
in the profile and are quoted below: the profile's composition (`package.json` bundles,
`cordis.patch.yml`) and the installed `@khorsheed/dsh-rss-reader@0.1.0` tarball, whose
`lib/index.js` was verified on disk to be the same stub Remote face as
`packages/dsh-rss-reader/src/remote.ts` (see §4.6 — its generated artifacts also prove the
stub's `remote.ts` shape is generator-accepted).

---

## 1. Outbound HTTP on the host

### 1.1 The sanctioned path: `ctx.web` (a documented capability seam)

`@deepseek-ai/dsh-web` declares a `Context` service named **`web`**, implemented by
`WebRuntime`:

```ts
// packages/web/web/src/index.ts:35-39
declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}
```

```ts
// packages/web/web/src/index.ts:74
export class WebRuntime extends Service {
// packages/web/web/src/index.ts:90-94
  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER
    this.fetchProviderId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER
  }
```

The two method signatures — this is the whole public execution surface:

```ts
// packages/web/web/src/index.ts:140
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
// packages/web/web/src/index.ts:157
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
```

with the request/result vocabulary (this is what the RSS plugin codes against):

```ts
// packages/web/web/src/types.ts:64-66
export interface WebFetchRequest {
  readonly url: string
}
```

```ts
// packages/web/web/src/types.ts:74-83
export interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}
```

```ts
// packages/web/web/src/types.ts:94-96
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }
```

The seam is documented as a **seam** (not a core spine) in the generated service graph:

```
// docs/capability-seams.md:539
| `ctx.web` | `seam` | [`web`](../packages/web/web) | [`web-search-exa`](...), [`web-search-perplexity`](...), [`web-search-deepseek`](...), [`web-fetch-http`](...) | [`tool-web`](../packages/web/tool-web) | - | Search and fetch providers register into one ctx.web seam; tool-web owns the stable model-facing names. |
```

and a **separate installed package** consumes it purely by declaring the service name in
`inject` — the proof that a third-party plugin reaches it the same way:

```ts
// packages/web/tool-web/src/index.ts:21-24
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt']
```

```ts
// packages/web/tool-web/src/fetch.ts:503-506
      const result = await ctx.web.fetch(
        { url: input.url },
        exec.signal,
      )
```

### 1.2 The provider that actually performs the socket work: `web-fetch-http`

```ts
// packages/web/web-fetch-http/src/index.ts:26-29
export const name = 'web-fetch-http'

/** The web seam this provider registers into. */
export const inject = ['web']
```

```ts
// packages/web/web-fetch-http/src/index.ts:86-93
  const limits: HttpFetchLimits = {
    maxResponseBytes: resolved.maxResponseBytes,
    maxBodyChars: resolved.maxBodyChars,
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    userAgent: resolved.userAgent,
  }
  ctx.web.registerFetchProvider(new HttpFetchProvider(limits))
```

Provider id and the real transport:

```ts
// packages/web/web-fetch-http/src/provider.ts:35-40
/** Stable id this provider registers under. */
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/** The anonymous public HTTP(S) fetch provider. */
export class HttpFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID
```

```ts
// packages/web/web-fetch-http/src/network.ts:199
  const { Agent, fetch } = await import('undici')
```

### 1.3 Registration in the shipped composition (prod-equivalent)

`$DSH_HOME/profiles/web/package.json` lists `@deepseek-ai/dsh-base` **first** in
`dsh.profile.bundles`, and `dsh-base` inserts the `web` seam and its HTTP provider:

```
// $DSH_HOME/profiles/web/package.json (dsh.profile.bundles)
"@deepseek-ai/dsh-base",
"@deepseek-ai/dsh-web-app",
```

```yaml
# packages/bundle/base/cordis.patch.yml:436-440
    - id: web
      name: '@deepseek-ai/dsh-web'
      config:
        searchProvider: deepseek-official
        fetchProvider: http
```

```yaml
# packages/bundle/base/cordis.patch.yml:447-448
    - id: web-fetch-http
      name: '@deepseek-ai/dsh-web-fetch-http'
```

**Surprise worth flagging to the Lead:** the Web bundle disables the *model-facing tool*
but **not** the service row — so `ctx.web.fetch(...)` is live at runtime even though the
model has no `web_fetch` tool in this profile:

```yaml
# packages/bundle/web-app/cordis.patch.yml:470-471
- id: tool-web
  disabled: true
```

No later layer re-targets `id: web` or `id: web-fetch-http`:

```
$ grep -rn "id: web$\|id: web-fetch-http\|id: timer$" --include=cordis.patch.yml packages/ apps/
packages/bundle/sdk-minimal/cordis.patch.yml:68:    - id: timer
packages/bundle/base/cordis.patch.yml:16:    - id: timer
packages/bundle/base/cordis.patch.yml:447:    - id: web-fetch-http
# (the `id: web` row at base:436 was read directly; the anchored grep misses it on
#  trailing whitespace — verified by reading the file)
```

and neither the profile patch nor a home patch touches them:

```
$ cat "$DSH_HOME/profiles/web/cordis.patch.yml"   # 50 lines; no `id: web`, no `id: timer`
$ ls "$DSH_HOME/cordis.patch.yml"                 # no home patch layer exists
$ grep -n "web\|timer" "$DSH_HOME/state/last-good-composition/cordis.patch.yml"
6:# the row leaves the web-app bundle.
```

### 1.4 Every host-side service that can perform an outbound HTTP request

Enumerated from the full service-key sweep and the outbound-call-site sweep:

```
$ grep -rn "super(ctx, '" --include=*.ts packages/ | grep -v node_modules | grep -v /lib/ | grep -v /tests/
$ grep -rn "await import('undici')\|from 'undici'\|globalThis.fetch\|await fetch(\|= fetch(" \
    --include=*.ts --exclude-dir=node_modules --exclude-dir=lib --exclude-dir=tests packages/
```

| service key | owner package | outbound-HTTP method(s) | where registered | arbitrary URL? |
| --- | --- | --- | --- | --- |
| **`web`** | `@deepseek-ai/dsh-web` | `fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>`; `search(request: WebSearchRequest, signal?): Promise<WebSearchResult>` | `packages/web/web/src/index.ts:91` `super(ctx, 'web')`; mounted by base row `web` (`packages/bundle/base/cordis.patch.yml:436`) | **yes — this is the seam** |
| `llm` | `@deepseek-ai/dsh-llm` | no URL-taking method; adapters POST to their configured base URL | `packages/llm/llm/src/index.ts:342` `super(ctx, 'llm')`; base row `llm` (`cordis.patch.yml:27-28`) | no — model APIs only |
| `e2b` | `@deepseek-ai/dsh-e2b` | `getSandbox(): Promise<Sandbox>` (`packages/e2b/e2b/src/index.ts:133`) | `packages/e2b/e2b/src/index.ts:94` `super(ctx, 'e2b')`; **not in the web profile's bundle list** | no — E2B API only (`import { ... } from 'e2b'`, `:11`) |
| `webServer` | `@deepseek-ai/dsh-host-webserver` | — (inbound routes) | service key `webServer` (`packages/host/webserver/src/index.ts`); `docs/capability-seams.md:542` calls it "Plain node:http carrier" | no — inbound |
| `webhookRuntime` | `@deepseek-ai/dsh-webhook` | — (inbound deliveries) | `docs/capability-seams.md:545` | no — inbound |
| — (function plugin, no service key) | `@deepseek-ai/dsh-mcp-client` | Streamable HTTP client to a configured MCP server | `packages/mcp/mcp-client/src/index.ts:29-32` (`name`, `inject = ['tools']`); `src/transport.ts:11` `import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'` | no — MCP servers only |

First-party packages that call `globalThis.fetch` / `undici` directly (these are **host
packages**, not the sanctioned route for a third-party plugin; listed for completeness):

```ts
// packages/web/web-search-deepseek/src/provider.ts:225      response = await fetch(endpoint, {
// packages/web/web-search-exa/src/provider.ts:101           response = await fetch(`${this.options.baseURL}/search`, {
// packages/web/web-search-perplexity/src/provider.ts:104    response = await fetch(`${this.options.baseURL}/chat/completions`, {
// packages/llm/llm-deepseek/src/adapter.ts:651              response = await fetch(`${connection.baseURL}/chat/completions`, {
// packages/llm/llm-pi-ai/src/discovery.ts:326               response = await fetch(url, {
// packages/llm/llm-deepseek/src/files-api.ts:139            this.fetchImpl = options.fetch ?? globalThis.fetch
```

There is **no** service keyed `fetch`:

```
$ grep -rn "super(ctx, 'fetch'" --include=*.ts packages/   -> (no output)
```

The only `'fetch'` strings in the host are tool-presentation kinds, not services:
`packages/core/tools/src/presentation.ts:15` `export type ToolCallKind = ... | 'fetch' | 'other'`.

### 1.5 Verdict for Q1

**Sanctioned path: probe `ctx.web` and call `ctx.web.fetch({ url }, signal)`.** It is a
declared, documented capability seam implemented by a provider package with no compile-time
coupling between consumer and provider; it handles proxy routing, DNS validation and
address pinning, redirect policy, byte/char caps, charset decoding and timeouts.
A third-party plugin should **not** call `globalThis.fetch` (no proxy/pinning/limits, and
it bypasses the seam's provider selection).

Provider selection is resolved at call time and can throw; the codes are in
`packages/web/web/src/index.ts:166-194`:

```ts
// packages/web/web/src/index.ts:171-194 (abridged quote of the resolution rules)
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}
```

### 1.6 RSS-specific caveats discovered in the fetch provider (all load-bearing)

**(a) RSS/Atom content types pass the classifier** — feeds arrive as `text`, so
`WebFetchBody.kind === 'text'` and `content` is the raw XML string:

```ts
// packages/web/web-fetch-http/src/policy.ts:78-84
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}
```

`application/rss+xml` and `application/atom+xml` hit `endsWith('+xml')`; `text/xml` hits
`startsWith('text/')`; `application/xml` is explicit. A server sending a non-`text/*` type
**without** `+xml` (e.g. bare `application/octet-stream`) throws
`WEB_UNSUPPORTED_CONTENT_TYPE` (`provider.ts:150-153`) — the plugin must surface that as a
per-feed error, not crash.

**(b) Cross-origin redirects are refused.** Feed URLs very often redirect (http→https,
`feedburner`-style movers). The provider only follows **same-origin** hops:

```ts
// packages/web/web-fetch-http/src/provider.ts:92-99
          let validatedTarget: URL
          try {
            validatedTarget = validateFetchUrl(target.toString())
            if (!isSameOrigin(validatedTarget, currentUrl)) {
              throw new WebError(
                `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
                'WEB_REDIRECT_BLOCKED',
              )
            }
```

The plugin must read `WebFetchResult.url`… but a blocked redirect *throws*, it does not
return. **There is no way for the plugin to discover and retry the target automatically
from this error** (the target origin is in the message text only). This is a real
functional limitation for RSS and belongs in the design decision log.

**(c) Body is silently truncated at `maxBodyChars` (default 100 000 chars).**

```ts
// packages/web/web-fetch-http/src/index.ts:45-51
export const Config: z<Config> = z.object({
  maxResponseBytes: z.number().default(5_000_000),
  maxBodyChars: z.number().default(100_000),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})
```

with `truncated: true` in the result (`provider.ts:165-176`) — but a truncated XML
document will fail to parse. The base bundle mounts `web-fetch-http` with **no config
override**, so the 100 000-char cap is what a plugin gets in this profile.

**(d) Timeout 30 s, max 5 same-origin redirects, URL length cap 2048.**

```ts
// packages/web/web-fetch-http/src/policy.ts:11-12
/** Maximum accepted request URL length enforced by the public fetch provider. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048
```

**(e) Public destinations only**, and only `http:`/`https:` with no embedded credentials:

```ts
// packages/web/web-fetch-http/src/network.ts:100-102
    if (!isPublicIpAddress(entry.address)) {
      throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_BLOCKED_URL')
    }
```

```ts
// packages/web/web-fetch-http/src/policy.ts:32-37
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
```

**(f) No conditional-GET / ETag plumbing.** `WebFetchRequest` carries only `url` and the
provider builds a fixed header set:

```ts
// packages/web/web-fetch-http/src/provider.ts:117-121
  private async requestOnce(url: URL, signal: AbortSignal) {
    const headers = {
      'user-agent': this.limits.userAgent,
      'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
    }
```

A plugin cannot send custom headers (no `Accept` override, no `If-None-Match`). Daily
refresh therefore always re-downloads the full feed.

---

## 2. Host-side state persistence

### 2.1 `ctx.fs` exists and is the canonical seam

```ts
// packages/fs/fs/src/index.ts:86-89
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }
```

It is a **seam** with a sandboxing implementation (`packages/fs/fs-sandbox`,
`packages/e2b/fs-e2b`, `packages/fs/fs-local`):

```
// docs/capability-seams.md:533
| `ctx.fs` | `seam` | [`fs`](../packages/fs/fs) | [`fs-local`](...), [`fs-sandbox`](...), [`fs-e2b`](...) | [`tool-fs`](...) | [`fs-observation-policy`](...) | ... |
```

and the base bundle mounts the confining backend:

```yaml
# packages/bundle/base/cordis.patch.yml:477-480
    # The sandboxed filesystem provider. `cwd` defaults to `process.cwd()`; an
    # overlay can pin another workspace.
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
```

### 2.2 Exact method set (abstract surface, `FileSystem`)

All quoted from `packages/fs/fs/src/index.ts`:

| line | signature |
| --- | --- |
| 116 | `abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>` |
| 126 | `abstract processPath(target: FsTarget): string` |
| 136 | `processPathFromHostPath(hostPath: string): string \| undefined` |
| 148 | `abstract fileUrl(target: FsTarget): string` |
| 157 | `abstract contains(parent: FsTarget, child: FsTarget): boolean` |
| 165 | `abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo \| undefined>` |
| 181 | `abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo \| undefined>` |
| 189 | `abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>` |
| 200 | `abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>` |
| 212 | `abstract readBytes(target: FsTarget, signal: AbortSignal \| undefined, maxBytes: number): Promise<Uint8Array>` |
| 227 | `abstract readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array>` |
| 236 | `abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>` |
| 250 | `abstract writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome>` |
| 271 | `abstract editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome>` |

Two facts that the discarded stub gets wrong and that the rewrite must respect:

- **Paths are not read/written directly.** A path string must first go through
  `resolve()` to an opaque `FsTarget`; `readText`/`writeText`/`stat` take the target:

```ts
// packages/fs/fs/src/index.ts:107-116
  /**
   * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
   * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
   * async even though the local backend only normalizes + realpaths.
   ...
   */
  abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
```

- `writeText`'s guard is a **`FsWriteIntent`** (`createIfAbsent` / `replaceIfVersion`), and
  `sandboxMode` tells the caller whether the mounted backend confines at all:

```ts
// packages/fs/fs/src/index.ts:92-105
   * The sandbox mode this backend enforces on mutations BY DEFAULT, or
   * `undefined` when it does not confine at all ...
  get sandboxMode(): SandboxMode | undefined {
```

### 2.3 The precedent: `packages/sidechat` `SideChatStore` (quoted in full, the parts that matter)

State-root convention:

```ts
// packages/sidechat/src/store.ts:40-52
/**
 * Resolve the side-chat state root (the datasets `defaults.ts` precedent): an
 * explicit value wins, then `$DSH_HOME/state/sidechat`, then
 * `<cwd>/.dsh-sidechat`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the state root directory.
 */
export function resolveSideChatStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', SIDECHAT_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-sidechat')
}
```

Deferred injection of `fs` (a documented shipped-bug workaround — this is the single most
important line for a new store):

```ts
// packages/sidechat/src/store.ts:97-114
    // Deferred injection, NOT an apply-time probe (canvas's tools precedent):
    // the fs service's mount order is not ours to race — a constructor-time
    // `ctx.get` silently loses it and memory-only-degrades the store forever
    // (the 3080 persistence bug: contexts.json was never written). With fs
    // already mounted the callback fires now; with none ever mounting the
    // store stays memory-only by construction — deliberately NOT a package-
    // level `inject = ['fs']`, which would pend the whole plugin away on a
    // composition without a filesystem. sandboxPolicy rides its own deferred
    // door inside, only when the arrived fs actually confines.
    ctx.inject(['fs'], (fsCtx) => {
      this.fs = fsCtx.get('fs') as Context['fs'] | undefined
      if (this.fs?.sandboxMode !== undefined) {
        fsCtx.inject(['sandboxPolicy'], (policyCtx) => {
          this.sandboxPolicy = policyCtx.get('sandboxPolicy') as SandboxPolicyService | undefined
        })
      }
      this.fsReadyListener?.()
    })
```

Target resolution + tolerant read + version-guarded write:

```ts
// packages/sidechat/src/store.ts:127-131
  /** The `contexts.json` target under the state root. */
  private target(): Promise<FsTarget> {
    if (this.fs === undefined) throw new SideChatStoreError('sidechat: no filesystem is mounted', 'io')
    return this.fs.resolve(join(this.stateRoot, SIDECHAT_CONTEXTS_FILE_NAME))
  }
```

```ts
// packages/sidechat/src/store.ts:154-174
  async read(): Promise<SideChatStoreRead> {
    if (this.fs === undefined) return { doc: emptyContextsDoc(), version: null }
    let target: FsTarget
    try {
      target = await this.target()
    } catch (error) {
      if (error instanceof FsError) return { doc: emptyContextsDoc(), version: null }
      throw error
    }
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
    }
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

### 2.4 The precedent: `packages/canvas` `CanvasBoardStore` (same shape, explicitly anti-`node:fs`)

```ts
// packages/canvas/src/store.ts:8-20
 * The fence is the canvas `store.ts` precedent, NOT datasets' bare `node:fs`:
 * the state dir is deployment-level state that no session workspace can hold,
 * so writes keep the mounted `ctx.fs` (version guards, atomic writes, the
 * observation trail) and re-root the writable boundary at the plugin's own
 * state dir. ...
 * A composition without `ctx.fs` degrades to memory-only state ...
```

```ts
// packages/canvas/src/store.ts:47-53
export function resolveCanvasStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', CANVAS_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-canvas')
}
```

```ts
// packages/canvas/src/store.ts:223-229
      try {
        const target = await this.fileTarget(id)
        const outcome = await this.fs.writeText(
          target, serializeBoard(next),
          { kind: 'replaceIfVersion', version: FsVersion(current.version) },
          undefined, policy,
        )
```

This is not theory: `$DSH_HOME/state/canvas/` exists with live board directories.

```
$ ls "$DSH_HOME/state/canvas"
canvas_0mu3wgq3i1wwsmcjzg6
canvas_0mu4db7lqrem3tcrtex
...
```

### 2.5 `local-files` and `quote` — what they actually do (the brief named both)

**`packages/local-files` does not persist JSON state at all.** It is a read-only browser of
arbitrary absolute paths and therefore uses `node:fs/promises` directly:

```ts
// packages/local-files/src/service.ts:11-12
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
```

It has no state file, no version guard, and no write path. It is **not** a persistence
precedent.

**`packages/quote` persists nothing.** It says so:

```ts
// packages/quote/src/index.ts:8-9
 * Composing this plugin out of cordis.yml removes every surface it adds; no
 * state of its own exists to leave behind.
```

The only Write verb in the whole package is `addRef`, which immediately posts into the
side-chat service and stores nothing locally (`packages/quote/src/remote.ts:68-85`, quoted
in full in §4.4).

### 2.6 Packages that **do** use bare `node:fs` (and why they are not the precedent)

```
$ grep -rln "from 'node:fs'\|from \"node:fs\"" --include=*.ts --include=*.tsx packages/*/src
packages/ankh-guard/...
packages/datasets/...
packages/eval/...
packages/inline-html-render/...
packages/lab/...
packages/local-agent/...
packages/local-agent-dsh/...
packages/local-agent-kimi/...
packages/mission/...
```

These are process/CLI-level tools (ankh-guard is the watchdog; datasets/eval/mission
operate on their own repos and out-of-process artifacts). None of them is a host-half
plugin persisting deployment-level JSON under `$DSH_HOME/state`, which is exactly what the
RSS reader is. The canonical in-repo answer for that shape is **`ctx.fs`** — two packages
(sidechat, canvas) say so in their module headers, and canvas names `datasets` as the
counterexample by hand.

### 2.7 Path conventions and a helper the plugin may use

Observed on-disk convention: `$DSH_HOME/state/<plugin-or-domain>/…` (`state/canvas`,
`state/eval`, `state/schedule-exit.log`, …). Fallbacks in both precedents are
`<cwd>/.dsh-<name>`.

The host also ships a shared home-path helper (a plain module, not a service):

```
$ grep -n "export function\|export const" packages/util/home-paths/src/index.ts
12:export const DSH_HOME_DIR_NAME = '.dsh'
15:export const DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`
18:export const DSH_HOME_ENV = 'DSH_HOME'
61:export function defaultDshHome(): string {
70:export function expandHomePath(path: string): string {
87:export function resolveDshHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
98:export function dshHomePath(...segments: string[]): string {
110:export function dshHomeDisplay(resolvedHome: string): string {
```

Both shipped stores hand-roll `process.env.DSH_HOME` instead; either is defensible, but the
hand-rolled form is the one with in-repo precedent.

### 2.8 Verdict for Q2

**Canonical: one version-guarded JSON document under `$DSH_HOME/state/dsh-rss-reader/`,
read and written through a **deferred** `ctx.inject(['fs'], …)` inside a `SideChatStore`-shaped
store class; memory-only degradation when `fs` never mounts; no bare `node:fs`.**
Ignore the stub's `FsMirror` / `statePath()` / `StoreVersion` — see §4.7.

---

## 3. Scheduling

### 3.1 Is there a cron / daily scheduler service? **No.**

I enumerated every host service key (§1.4 search) and every reminder/timer implementation.
The two candidates are both **not** what they look like:

**(a) `ctx.timer` exists and is mounted, but it is a raw-timer helper, not a scheduler.**

```ts
// vendor/timer/src/index.ts:3-7
declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<TimerService, 'interval' | 'timeout' | 'throttle' | 'debounce' | 'setTimeout' | 'setInterval'> {
    timer: TimerService
  }
}
```

```ts
// vendor/timer/src/index.ts:11-16
/** Disposable timer helpers mixed into Cordis contexts. */
export class TimerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval'])
  }
```

Its methods are `timeout(callback|delay)`, `interval(callback|delay)`, `throttle`,
`debounce`, and two deprecated aliases (`setTimeout`/`setInterval`) — i.e. a fiber-scoped
`setTimeout`/`setInterval`, nothing calendar-aware. It is registered by the base bundle:

```yaml
# packages/bundle/base/cordis.patch.yml:15-17
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
```

**No `timer` row in `docs/capability-seams.md`** (grep for `timer` in that file → no
output), i.e. it is not a documented dsh capability seam, just a vendored cordis plugin
that happens to be mounted.

**(b) `@deepseek-ai/dsh-schedule` is an agent-scoped conversational reminder system, not a
plugin-facing timer.**

```ts
// packages/schedule/schedule/src/index.ts:35-43
/** Cordis function-plugin name. */
export const name = 'schedule'
/** Services required before future root agents can receive Schedule. */
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence']
...
/** Install Schedule only for root agents published after this plugin loads. */
export function apply(ctx: Context): void {
```

It provides **no service key** (nothing in it is `ctx.schedule`), it runs one
`ScheduleRuntime` per root agent (`src/index.ts:52-73`), it drives its own private timer
(`src/runtime.ts:79` `private timer: ReturnType<typeof setTimeout> | undefined`, `:178-184`
`this.timer = setTimeout(...)`), and its deliveries are session messages. From the package
README: *"Reminders survive restarts, but delivery requires a live root agent: closed
sessions keep reminders overdue until resumed."* It is also **not mounted in the web
profile's bundles** (the profile `dsh.profile.bundles` list contains no `dsh-schedule`).

### 3.2 Is `apply` called once per process?

The precise, verified fact is: **`apply` runs once per *plugin-row mount*, i.e. once per
process for a boot-mounted profile bundle.** The chain:

A profile bundle's `cordis.patch.yml` is a patch layer; the composition stacks layers in
`dsh.profile.bundles` order and mounts the composed entry list once:

```ts
// apps/cli/src/profile-boot.ts:1-5
/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, apply its selected patch-reload
 * lifecycle, and wire fail-loud plus bounded shutdown.
```

```ts
// apps/cli/src/profile-boot.ts:234-243
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  ...
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
```

Each row is mounted through `ctx.plugin(...)`, which creates one fiber and calls the
callback exactly once:

```ts
// vendor/cordis/src/registry.ts:316-319
  plugin(plugin: Plugin, config?: any, getOuterStack = buildOuterStack()) {
    // check if it's a valid plugin
    const callback = this.resolve(plugin)
    if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin)
```

```ts
// vendor/cordis/src/fiber.ts:247-261
      this._runner = {
        epoch: INACTIVE,
        getOuterStack,
        execute: function () {
          if (isConstructor(runtime.callback)) {
            // eslint-disable-next-line new-cap
            const instance = new runtime.callback(this.ctx, this.config)
            for (const hook of instance?.[symbols.initHooks] ?? []) {
              hook()
            }
            return instance?.[symbols.init]?.()
          } else {
            return runtime.callback(this.ctx, this.config)
          }
        },
        collect,
      }
```

**Caveat / uncertainty:** the *user* patch layer (`cordis.patch.yml`, and `--patch`
overlays) has a `patchReload` lifecycle — and for the **web** template it is **`live`**,
not `startup`:

```ts
// packages/boot/app-boot/src/profile.ts:116-119
  web: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    patchReload: 'live',
  },
```

while the base bundle ships the `hmr` row `disabled: true`
(`packages/bundle/base/cordis.patch.yml:21-23`). So a **live edit** to the user patch layer
can re-mount rows; plugin *bundles* are mounted once at boot. A timer armed in `apply` and
disposed with the fiber handles both cases correctly. The one thing I could **not** verify is
which `patchReload` the *running* profile actually resolves to: the live
`$DSH_HOME/profiles/web/package.json` has no `dsh.profile.patchReload` field, so the
migration path at `packages/boot/app-boot/src/profile.ts:701-710` decides, and I did not
execute it. Flagged as the one unresolved fact in Q3 — it does not change the recommendation
(use `ctx.effect` cleanup either way).

### 3.3 Cleanup convention: `ctx.effect` / returned disposer. **`ctx.on('dispose')` does not exist.**

`ctx.effect(execute, label)` runs the body immediately, collects every disposer it yields,
and runs them in reverse on explicit disposal or fiber unload:

```ts
// vendor/cordis/src/fiber.ts:402-413
  /**
   * Register a cleanup-aware effect on this fiber.
   *
   * `execute` runs immediately; the disposers it produces are collected and
   * run (in reverse order) either when the returned disposer is called or
   * when the fiber unloads, whichever comes first. Calling the disposer twice
   * is a no-op. ...
   */
  effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
```

Returning a function from `apply` registers it as a disposer too:

```ts
// vendor/cordis/src/fiber.ts:366-368
      const effect: Effect = runner.execute.call(this)
      if (typeof effect === 'function') {
        return runner.collect(effect)
```

The cordis `Events` interface — the full list of events a plugin can listen to — has no
`dispose` event:

```ts
// vendor/cordis/src/events.ts:329-352
export interface Events {
  /** A plugin fiber was created or its uid was cleared on disposal. */
  'internal/plugin'(fiber: Fiber): void
  /** A fiber changed lifecycle state; receives the fiber and its previous state. */
  'internal/status'(fiber: Fiber, oldValue: FiberState): void
  ...
  /** An event is being dispatched to listeners (fired for non-internal events only). */
  'internal/dispatch'(mode: DispatchMode, name: string, args: any[], thisArg: any): void
}
```

```
$ grep -rn "on('dispose')\|emit('dispose')" vendor/cordis/src/*.ts            -> (no output)
$ grep -rn "on('dispose')" packages/*/src/*.ts (dsh-plugins)                   -> (no output)
```

The cordis primer states the convention in prose:

```
// docs/cordis-primer.md:45
Every registration should have a disposer, either by returning one from `ctx.effect()` or using a Cordis helper that does it for you. If teardown order matters, keep the related work in one effect so disposal unwinds in the intended sequence.
```

### 3.4 In-repo precedent for a host-half plugin-owned timer

`packages/ankh-guard` (a host-half plugin) arms both a one-shot and a repeating timer in
`apply`-time code and disposes each with `ctx.effect`:

```ts
// packages/ankh-guard/src/index.ts:656-659
    if (resumeInterrupted) {
      const timer = setTimeout(() => { void resumePass() }, resumeDelayMs)
      ctx.effect(() => () => { clearTimeout(timer) })
    }
```

```ts
// packages/ankh-guard/src/index.ts:664-671
    if (cutoverBlocksWake(stateDir)) {
      const releaseTimer = setInterval(() => {
        if (disposed || cutoverBlocksWake(stateDir)) return
        clearInterval(releaseTimer)
        for (const agent of ctx.agents.roots()) deliver(agent)
      }, 250)
      ctx.effect(() => () => { clearInterval(releaseTimer) })
    }
```

### 3.5 Node timer-range fact that matters for a "daily at 10:00" design

The host itself documents Node's 32-bit timer clamp and defends against it:

```ts
// packages/web/web-fetch-http/src/index.ts:14
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647
```

```ts
// packages/schedule/schedule/src/runtime.ts:21-22
/** Largest delay that Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647
```

`2_147_483_647 ms ≈ 24.86 days`, so a **daily** delay (86 400 000 ms) is safely
representable — the clamp is not a hazard for a 24 h arm. It *is* a hazard if the plugin
computes "next 10:00" wrongly or arms a multi-week delay, and it matters for the
re-arm-after-fire pattern (`schedule/src/runtime.ts:178-184` clamps and rechecks the wall
clock on every wake, which is the safe shape).

### 3.6 Verdict for Q3

**No host scheduler service exists. A plugin-owned timer is the only option.** Use
`ctx.timer.timeout(cb, delay)` (fiber-scoped, auto-disposed) or a bare `setTimeout` wrapped
in `ctx.effect(() => () => clearTimeout(t), 'rss-reader: daily refresh')` — never
`ctx.on('dispose')`, which is not an event. Re-check the wall clock on every wake (DST,
suspend/resume, laptop sleep) rather than trusting the delay.

---

## 4. Remote surface

### 4.1 The premise of the question is wrong: there is **one** idiom, and local-files/quote use it

The brief contrasts "`TypertRemoteService` + `@Remote` (as `packages/dsh-rss-reader/src/remote.ts`
attempts) versus the pattern used by `packages/local-files/src/remote.ts` and `packages/quote`".
Both of the latter use **exactly the same** imports, base class, constructor call and
decorator:

```ts
// packages/local-files/src/remote.ts:10-11
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
```

```ts
// packages/local-files/src/remote.ts:30-35
export class LocalFilesRemoteService extends TypertRemoteService<LocalFilesRemoteConfig> {
  static inject = ['localFiles']

  constructor(ctx: Context, _config: LocalFilesRemoteConfig = {}) {
    super(ctx, 'localFilesRemote', { namespace: 'localFiles' })
  }
```

```ts
// packages/local-files/src/remote.ts:44-47
  @Remote('listDirectory')
  listDirectory(request: ListLocalDirectoryRequest): Promise<ListLocalDirectoryResult> {
    return this.localFiles.listLocalDirectory(request.path)
  }
```

```ts
// packages/quote/src/remote.ts:21-23
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { QuoteAddRefOutcome, QuoteAddRefRequest, QuoteRef } from './types.ts'
```

```ts
// packages/quote/src/remote.ts:54-61
export class QuoteRemoteService extends TypertRemoteService<QuoteRemoteConfig> {
  /**
   * @param ctx - host context (the side-chat service is probed, never injected).
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: QuoteRemoteConfig = {}) {
    super(ctx, 'quoteRemote', { namespace: 'quote' })
  }
```

```ts
// packages/quote/src/remote.ts:68-69
  @Remote('addRef')
  async addRef(request: QuoteAddRefRequest): Promise<QuoteAddRefOutcome> {
```

A sweep of every remote-bearing plugin in this repo shows **one** mechanism, no second
idiom, and no legacy RPC path in force:

```
$ grep -rn "TypertRemoteService\|RemoteScope\|@Remote\|remote.\$mount\|registerRemote" \
    --include=*.ts --include=*.tsx packages/*/src | awk -F: '{print $1}' | sort | uniq -c | sort -rn
  29 packages/eval/src/remote.ts
  19 packages/capability-catalog/src/index.ts
  19 packages/canvas/src/remote.ts
  18 packages/worktrees/src/remote.ts
  16 packages/room/src/index.ts
  16 packages/datasets/src/remote.ts
  12 packages/local-agent/src/gateway.ts
   9 packages/dsh-rss-reader/src/remote.ts
   8 packages/mission/src/remote.ts
   8 packages/file-preview/src/index.ts
   7 packages/sidechat/src/remote.ts
   5 packages/message-tools/src/index.ts
   4 packages/local-files/src/remote.ts
   3 packages/quote/src/remote.ts
  ... (every remaining line is a client `$mount` call)
```

**No package in this repo uses anything else.** The `@deepseek-ai/dsh-api-remotes` peer
dependency that the stub declares is **not** a competing wire — it is the Host BFF that
forwards selected Cordis *events*, and it injects the Typert gateway:

```ts
// packages/api/remotes/src/index.ts:35-40
export const inject = ['typertGateway']

/** Host plugin body registering this application's selected Cordis event source. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }),
    'api-remotes: forwarded Cordis event source',
  )
}
```

### 4.2 The host contract

```ts
// packages/typert/protocol/src/index.ts:134-150
export function bindTypertRemote<Service extends object>(
  service: Service,
  serviceKey: string,
  options: TypertGatewayBindingOptions = {},
): TypertGatewayBinding<Service> {
  validateName('service key', serviceKey)
  const namespace = options.namespace ?? serviceKey
  validateName('namespace', namespace)
  return Object.freeze({ service, serviceKey, namespace })
}
```

```ts
// packages/typert/protocol/src/index.ts:152-167
/** Cordis Service base that exposes its registered name through Typert Gateway. */
export abstract class TypertRemoteService<out T = never> extends Service<T> {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  readonly typertRemote: TypertGatewayBinding<this>
  ...
  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
    super(ctx, serviceKey)
    this.typertRemote = bindTypertRemote(this, this.name, options)
  }
}
```

```ts
// packages/typert/protocol/src/index.ts:169-183
/**
 * Mark one public instance method as a direct Remote invocation.
 * ...
 */
export function Remote<This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
/**
 * Mark one public instance method under an exported name or as a logical stream.
 * @param option - endpoint method name or stream delivery mode.
 * @returns a standard method decorator.
 */
export function Remote(option: string | RemoteMethodOptions): RemoteMethodDecorator
```

The browser-side capability the generated artifact is mounted into:

```ts
// packages/typert/protocol/src/types.ts:306-313
/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
export interface TypertClientRemote extends TypertRemoteNamespaceMap {
  ...
  /**
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
```

### 4.3 The `ctx.remote.$mount` implementation (client half)

```ts
// packages/api/gateway/src/client/index.ts:125-130
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by the Client assembly. */
    remote: ClientRemote
  }
}
```

```ts
// packages/api/gateway/src/client/index.ts:132-141
/** Required Client services: the Typert registry and the existing Connection carrier. */
export const inject = ['typert', 'connection']

/**
 * Install the typed Client Remote service.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  new ClientRemoteService(ctx)
}
```

```ts
// packages/api/gateway/src/client/index.ts:152-153
  constructor(ctx: Context) {
    super(ctx, 'remote')
```

```ts
// packages/api/gateway/src/client/index.ts:201-209
  async $mount(contribution: TypertRemoteContribution): ReturnType<TypertClientRemote['$mount']> {
    const callerCtx = this.ctx
    const owned = callerCtx.effect(async () => {
      const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution))
      return () => this.enqueue(dispose)
    }, `api-gateway.client.$mount(${JSON.stringify(contribution.package)})`)
    await owned
    return async () => { await owned() }
  }
```

### 4.4 Three real, working registrations (all shipped or in the prod tarball set)

**(a) sidechat** — the fullest example, including the agent-scoped caller convention:

```ts
// packages/sidechat/src/remote.ts:37-50
export class SideChatRemoteService extends TypertRemoteService<SideChatRemoteConfig> {
  static inject = ['sideChat']
  ...
  constructor(ctx: Context, _config: SideChatRemoteConfig = {}) {
    super(ctx, 'sidechatRemote', { namespace: 'sidechat' })
  }

  private get sideChat(): SideChatService {
    return this.ctx.sideChat
  }
```

```ts
// packages/sidechat/src/remote.ts:76-79
  @Remote('send')
  send(agent: Agent, request: SideChatSendRequest): Promise<SideChatSendOutcome> {
    return this.sideChat.send(agent, request)
  }
```

**(b) quote** — the probe-and-refuse shape the RSS plugin should copy for `sideChat`:

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

**(c) local-files** — quoted in §4.1.

### 4.5 The `$mount` counterpart on the client half (three real ones)

```ts
// packages/local-files/src/client/index.ts:39-50
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
```

```ts
// packages/quote/src/client/index.ts:76
    disposers.push(await ctx.remote.$mount(quoteRemote))
```

```ts
// packages/sidechat/src/client/index.ts:98
    disposers.push(await ctx.remote.$mount(sidechatRemote))
```

…and note the deliberate `ctx.get` — **not** `ctx.remote.<ns>` — when reading the namespace
back after the mount settles (the namespace lives in the sibling fiber `$mount` spawned):

```ts
// packages/sidechat/src/client/index.ts:108-114
  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the view reports that instead of the plugin
  // pending forever on an inject it cannot satisfy.
  const requireRemote = (): SideChatRemote => {
    const mounted = ctx.get('remote.sidechat') as SideChatRemote | undefined
    if (mounted === undefined) throw new Error('sidechat: the host half is not installed')
    return mounted
  }
```

### 4.6 The generated artifacts

Names are fixed by the generator and validated at analysis time:

```ts
// packages/typert/generator/src/workspace.ts:96-114
    const subpath = artifact.face === 'host' ? './typert' : './client/typert'
    const expected = {
      types: `./lib/typert.${artifact.face}.d.ts`,
      default: `./lib/typert.${artifact.face}.js`,
    }
    ...
      throw new TypertAnalysisError(
        `typert(${artifact.face}): ${artifact.package} must export ${subpath} as ${JSON.stringify(expected)}`,
      )
    }
    const files = Array.isArray(manifest.files) ? manifest.files : []
    for (const file of [`lib/typert.${artifact.face}.js`, `lib/typert.${artifact.face}.d.ts`]) {
      if (!files.includes(file)) {
        throw new TypertAnalysisError(`typert(${artifact.face}): ${artifact.package} package files must include ${file}`)
      }
    }
```

```ts
// packages/typert/generator/src/workspace.ts:116-147
    const remoteExpected = {
      types: './lib/typert.remote-client.d.ts',
      default: './lib/typert.remote-client.js',
    }
    const remoteActual = manifest.exports !== null && typeof manifest.exports === 'object'
      ? (manifest.exports as Record<string, unknown>)['./remote']
      : undefined
    // The declaration map is emitted beside these two but never published: it
    // serves editor navigation in the workspace, where the package link
    // resolves its source.
    const remoteFiles = [
      'lib/typert.remote-client.js',
      'lib/typert.remote-client.d.ts',
    ]
    if (artifact.remote === undefined) {
      if (remoteActual !== undefined || remoteFiles.some(file => files.includes(file))) {
        throw new TypertAnalysisError(
          `typert(host): ${artifact.package} publishes Remote artifacts but has no Remote methods`,
        )
      }
      return
    }
    if (!sameExport(remoteActual, remoteExpected)) {
      throw new TypertAnalysisError(
        `typert(host): ${artifact.package} must export ./remote as ${JSON.stringify(remoteExpected)}`,
      )
    }
```

The expected `package.json` export block (present in the stub already — keep it):

```json
// packages/dsh-rss-reader/package.json:33-40
    "./typert": {
      "types": "./lib/typert.host.d.ts",
      "default": "./lib/typert.host.js"
    },
    "./remote": {
      "types": "./lib/typert.remote-client.d.ts",
      "default": "./lib/typert.remote-client.js"
    },
```

A real generated host artifact (zod schemas mirroring every `@Remote` signature):

```js
// packages/local-files/lib/typert.host.js:1-10
/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */
import { z } from 'zod'

const _khorsheed_dsh_local_files_localFiles_listDirectory_parameter_0$schema = z.object({
  'path': z.string(),
})
const _khorsheed_dsh_local_files_localFiles_listDirectory_result$schema = z.object({
  'path': z.string(),
  'parent': z.string(),
  'entries': z.array(z.object({
```

A real generated client artifact (declaration merging is what types `remote.<ns>`):

```ts
// packages/local-files/lib/typert.remote-client.d.ts (the complete body; header comment elided)
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFilesRead, ReadLocalFileRequest } from '@khorsheed/dsh-local-files/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6c6f63616c46696c6573 {
    listDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
    readFile: (request: ReadLocalFileRequest) => Promise<RemoteResult<LocalFilesRead>>
  }
  interface TypertRemoteMap {
    'localFiles/listDirectory': (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
    'localFiles/readFile': (request: ReadLocalFileRequest) => Promise<RemoteResult<LocalFilesRead>>
  }
  interface TypertRemoteNamespaceMap {
    'localFiles': TypertRemoteNamespace$6c6f63616c46696c6573
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
```

**The RSS reader's own generated artifact exists and is installed in prod** — proof that
the stub's `remote.ts` shape is *accepted by the generator* even though its bodies are
empty:

```ts
// $DSH_HOME/profiles/web/node_modules/@khorsheed/dsh-rss-reader/lib/typert.remote-client.d.ts
/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$727373526561646572 {
    capabilities: () => Promise<RemoteResult<{ protocolVersion: 1; namespace: string; }>>
    deleteFeed: (_request: RssDeleteFeedRequest) => Promise<RemoteResult<RssDeleteFeedOutcome>>
    generateRef: (request: RssGenerateRefRequest) => Promise<RemoteResult<RssGenerateRefOutcome>>
    listEntries: (_request: RssListEntriesRequest) => Promise<RemoteResult<RssListEntriesOutcome>>
    listFeeds: () => Promise<RemoteResult<RssListFeedsOutcome>>
    refresh: (request: RssRefreshRequest) => Promise<RemoteResult<RssRefreshOutcome>>
    updateFeed: (_request: RssUpdateFeedRequest) => Promise<RemoteResult<RssUpdateFeedOutcome>>
  }
  interface TypertRemoteMap { 'rssReader/capabilities': ...; /* … */ }
  interface TypertRemoteNamespaceMap { 'rssReader': TypertRemoteNamespace$727373526561646572 }
}
```

and the running host-half class also ships the decorators:

```
$ grep -n "TypertRemoteService\|rssReaderRemote\|Remote(" \
    "$DSH_HOME/profiles/web/node_modules/@khorsheed/dsh-rss-reader/lib/index.js"
1:import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
45:	let _classSuper = TypertRemoteService;
57:			_capabilities_decorators = [Remote("capabilities")];
149:			super(ctx, "rssReaderRemote", { namespace: "rssReader" });
```

### 4.7 What the stub's Remote face gets wrong (host-API facts only)

Quoted from `packages/dsh-rss-reader/src/remote.ts`:

```ts
// packages/dsh-rss-reader/src/remote.ts:35-44
export interface FsMirror {
  /** Read a text file at the given absolute path. */
  readText(path: string, signal?: AbortSignal): Promise<string>
  /** Write text to the given absolute path, creating parent directories. */
  writeText(path: string, content: string, signal?: AbortSignal): Promise<void>
  /** Check whether a file exists and read its stat info. */
  stat(path: string, signal?: AbortSignal): Promise<{ type: 'file' | 'directory'; size?: number } | undefined>
  /** Resolve a path relative to a base directory. */
  resolve(display: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<string>
}
```

```ts
// packages/dsh-rss-reader/src/remote.ts:46-49
/** The probed fetch capability: never injected, probed per call. */
export interface FetchMirror {
  fetch(url: string, options?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number }): Promise<Response>
}
```

```ts
// packages/dsh-rss-reader/src/remote.ts:104-106
    const ctx = (this as unknown as { ctx: Context }).ctx
    const fetchService = ctx?.get('fetch') as FetchMirror | undefined
    if (fetchService === undefined) {
```

- `FsMirror` matches **no** host API: the real `readText`/`writeText`/`stat` take an
  `FsTarget` from `resolve()` (§2.2), not a path string, and there is no
  `writeText(path, content, signal)` overload.
- `FetchMirror` is invented: **`ctx.get('fetch')` is always `undefined`** — there is no
  service keyed `fetch` (§1.4). The sanctioned fetch service is `ctx.web` (§1.1).
- `(this as unknown as { ctx: Context }).ctx` is unnecessary: `TypertRemoteService extends
  Service<T>` and `this.ctx` is available on the subclass (`packages/quote/src/remote.ts:73`
  uses `this.ctx.get('sideChat')` with no cast) — but this is a pattern point already
  covered by the sibling `patterns` task.

### 4.8 Verdict for Q4

**`TypertRemoteService` + `@Remote` + client `ctx.remote.$mount(<pkg>/remote)` is the one
in-force idiom for host `0.1.5-rc.1` (and it is what `local-files`, `quote`, `sidechat`,
`canvas`, `datasets`, `mission`, `room`, `worktrees`, `eval`, `message-tools`,
`capability-catalog`, `file-preview`, `local-agent` all use). There is no coexisting second
idiom.** The stub's `remote.ts` is structurally correct as a Remote face and its generated
artifacts already ship — only its probe targets (`ctx.get('fetch')`, `FsMirror`) and its
method bodies are wrong.

---

## 5. XML / DOM parsing on the host

### 5.1 There is no XML parser seam, and `DOMParser` is browser-only

`DOMParser` is not a Node global. Checked on the host's own runtime binary:

```
$ node -e "console.log('DOMParser' in globalThis, typeof globalThis.DOMParser, process.version)"
false undefined v22.21.1
```

Every `DOMParser` use in the harness lives in the **client** face or in browser tests:

```
$ grep -rin "domparser" --include=* packages/ apps/ vendor/ | grep -v node_modules | grep -v /lib/
packages/client/ui-sidebar-documentpreview/src/client/html/bootstrap.ts:35:  const parsed=new DOMParser().parseFromString(html,'text/html');
packages/client/ui-sidebar-documentpreview/tests/html-bootstrap.client.spec.ts:17:    document: { open, write, close }, URL: { createObjectURL }, Blob, DOMParser, atob, TextDecoder,
packages/client/ui-sidebar-documentpreview/tests/html-bootstrap.client.spec.ts:19:  return { ... document: new DOMParser().parseFromString(...) }
packages/client/ui-primitives/src/markdown/katex.tsx:88:  const parsed = new DOMParser().parseFromString(html, 'text/html')
apps/web/tests/present-svg.e2e.ts:82:      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
```

(One more hit, `apps/web/dist/assets/index-*.js`, is a built browser bundle — same face.)

### 5.2 No XML library is installed or exposed

```
$ grep -rn "fast-xml-parser\|xml2js\|linkedom\|jsdom\|sax\b\|xmlbuilder" packages/*/*/package.json
packages/test-support/client-runtime/package.json:3:  "description": "jsdom slot test runtime: ..."

$ grep -rn '"jsdom"\|"turndown"\|"domino"\|"@xmldom' package.json packages/*/*/package.json
package.json:207:    "jsdom": "29.1.1",
packages/web/tool-web/package.json:40:    "turndown": "^7.2.4"

$ ls ~/code/deepseek-harness/node_modules | grep -i -E "xml|dom|sax|cheerio"
jsdom
```

`jsdom` is a **root devDependency** (test plane), not a runtime service. The only HTML
parser at runtime is inside `tool-web`'s `turndown`:

```ts
// packages/web/tool-web/src/fetch.ts:20-28
/**
 * The shared HTML→markdown converter: turndown over its bundled domino DOM,
 * with GitHub-flavored tables/strikethrough (`@joplin/turndown-plugin-gfm`).
 * ...
 */
const turndown = new TurndownService({
```

`turndown`/`domino` is **not exported** — it is a private detail of `tool-web`'s
presentation layer, it is HTML-only (it is not an RSS/Atom XML parser), and it is not
reachable from a plugin context. There is no `ctx.xml`, `ctx.dom`, or parser service in the
service-key sweep, and `docs/capability-seams.md` lists none.

### 5.3 Verdict for Q5

**The host gives a plugin no XML/DOM parser. `DOMParser` exists only in the browser half.**
The host half must therefore parse the feed string itself — either a hand-rolled minimal
parser over the raw text (the stub's `types.ts` header already says it carries "its own
minimal feed vocabulary (RSS 2.0 / Atom 0.3)"), or a plugin-local npm dependency it packs
into its own tarball. `ctx.web.fetch` delivers the raw XML as `WebFetchBody`
`{ kind: 'text', content }` (§1.6a), so the string is available — the parse is the
plugin's own problem.

---

## 6. Uncertainty ledger, corrections, and the exact searches that found nothing

### Corrections to the brief's premises (each proved above)

1. **"the installed prod packages under `$DSH_HOME/profiles/web/node_modules/@deepseek-ai/`"**
   — the host service packages are not installed there. Searches that returned nothing:

   ```
   $ find "$DSH_HOME/profiles/web" -type d -name 'dsh-web'             -> (no output)
   $ find "$DSH_HOME/profiles/web" -type d -name 'dsh-typert-protocol' -> (no output)
   $ find "$DSH_HOME/profiles/web" -type d -name 'dsh-fs'              -> (no output)
   ```

   The host is the checkout (`$DSH_HOME/state/launch-spec.json` → `harnessRoot:
   ~/code/deepseek-harness`).

2. **"`TypertRemoteService` + `@Remote` … versus the pattern used by `local-files` and
   `quote`"** — they are the same pattern (§4.1). There is no second idiom to choose
   between.

3. **"probed `ctx.get('fetch')`"** (stated in the stub's source comment and, incidentally,
   in the sibling `patterns` report §4) — **no such service exists** (§1.4). The fetch seam
   is `ctx.web`.

4. **Q3's `ctx.on('dispose')` option does not exist** — the cordis `Events` interface has
   no `dispose` event (§3.3).

### Explicitly unresolved / not verified

- **`$DSH_HOME` effectively-bound layer set beyond the two files I read.** I read
  `$DSH_HOME/profiles/web/package.json`, `cordis.patch.yml`, `cordis.yml`, and
  `$DSH_HOME/state/last-good-composition/{package.json,cordis.patch.yml}`. A `--patch`
  overlay passed on the live command line could alter rows; the launch spec's command
  (`... bin.js web --no-open --trusted-host ...`) carries no `--patch`. I did **not**
  boot `dsh web --dump-config` (that would execute the host).
- **The running profile's effective `patchReload`** (`'startup'` vs `'live'`) — the profile
  manifest has no `dsh.profile.patchReload` field; the migration default is at
  `packages/boot/app-boot/src/profile.ts:701-710`, which I did not execute. Irrelevant for
  the bundle-mounted rows, relevant only for live edits to the user layer.
- **Whether any *non*-candidate service can be induced to make an outbound request.**
  My sweep was signature-level (`grep` for `undici` / `globalThis.fetch` / `fetch(` in
  non-test, non-lib sources). A service that constructs HTTP through a third-party SDK
  (like `e2b` via the `e2b` package, `packages/e2b/e2b/src/index.ts:11`) is captured only
  where the import is visible; an SDK that internally fetches without a local `fetch(` call
  would not be. I found no such case beyond `e2b` and the MCP client.

### Searches that returned no evidence (verbatim)

```
$ grep -rn "super(ctx, 'fetch'" --include=*.ts packages/                       # no output
$ grep -rn "super(ctx, '" --include=*.ts packages/ | grep -v node_modules \
    | grep -v /lib/ | grep -v /tests/                                          # no `timer`/`schedule`/`xml` service key
$ grep -rn "on('dispose')\|emit('dispose')" vendor/cordis/src/*.ts             # no output
$ grep -rn "on('dispose')" packages/*/src/*.ts                                 # no output (dsh-plugins)
$ grep -rln "fast-xml-parser\|xml2js\|linkedom\|@xmldom" packages/ apps/       # no output
$ grep -n "timer" docs/capability-seams.md                                     # no output
$ ls "$DSH_HOME/cordis.patch.yml"                                              # no such file
```

### Two host facts the Lead should weigh as design constraints (not defects)

- **Cross-origin feed redirects are refused with a throw and no recoverable target**
  (§1.6b). A large share of real-world feeds live behind redirects; the sync/refresh verb
  must report this per feed, and the user may have to paste the final URL.
- **`maxBodyChars` default 100 000 silently truncates and then the XML will not parse**
  (§1.6c). Very large feeds will fail at parse; `truncated: true` is the only signal.
