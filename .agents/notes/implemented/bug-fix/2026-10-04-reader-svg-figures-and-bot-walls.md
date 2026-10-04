# Agent Note: The reader keeps CSS-variable SVG figures and routes bot walls to the rendered fetch

Status: implemented

## Problem

Two kinds of article failed in the reader (`packages/dsh-reader`):

- **Inline SVG figures that are themed with CSS custom properties.** The figures in claude.dev blog posts (for example fig1 of *automating-eval-design-and-hillclimbing*) color their strokes, fills and text with `var(--…)`. The extractor's SVG subset kept those attribute values verbatim. The custom properties live in the source site's stylesheet, which the reader does not carry, so every `var()` resolved to nothing. The figure collapsed into its unthemed marker dots, with no lines, axes or labels. These pages also ship a desktop SVG and a narrow `mobile` duplicate side by side, and the reader rendered both. The page's own CSS normally hides one of them.
- **WeChat articles (`mp.weixin.qq.com`).** The host's `web-fetch-http` request (fixed harness UA, so no browser fingerprint) gets back an HTTP 200 「环境异常 … 完成验证后即可继续访问」 challenge page. The visible text of that page is about 65 characters. `captcha` appears only past character 8000, outside the preview window. So `BOT_WALL_PATTERN` missed it: the add dialog said "refuses automatic fetching", while the body fetch stored the challenge page as the article. Nothing escalated to the rendered fetch, because `maybeAutoRender` fired only for script-figure shells.

## Decision

**SVG figures.** In `src/client/extract-article.ts`:

- `resolveSvgVars` rewrites every `var(...)` in a kept SVG attribute (a paren-depth scan, guarded to 32 rounds):
  - a declared fallback wins;
  - a name that reads as a ground (`bg`/`background`/`surface`/`paper`/`canvas`/`page`, per `SVG_GROUND_VAR`) becomes `none`;
  - everything else becomes `currentColor`, so ink follows the reader theme.
- `isResponsiveAlternate` drops a top-level `<svg>` whose id/class names it as the narrow variant (`mobile|narrow|small|compact|sm|xs` tokens), but only when a sibling `<svg>` without such a name exists. A lone narrow-named SVG is kept.
- `ReaderPane.module.css` caps top-level SVGs at the column width: `.article :not(svg) > svg { max-width: 100%; height: auto }`.

**Bot walls.**

- `BOT_WALL_PATTERN` (`src/service.ts`) also matches `环境异常` and `完成验证后`.
- `fetchEntryBody` runs `inspectPreview` on the fetched body. A `blocked` verdict is recorded as a fetch failure with code `blocked` and returned as an error, instead of handing the challenge page over as the article.
- The client classifies such errors with `browserSolvable` (`bot challenge` or `HTTP 401/403`):
  - On open, an entry with no body and a browser-solvable error escalates through `maybeAutoRender`, which now takes a `wanted` boolean rather than a figure count. The escalation goes through the same capture path as the script-figure case.
  - The detail error line offers a 「渲染抓取」 button when the capture Remote is mounted.
  - The add dialog's blocked verdict adds `verdict.willRender` when it is mounted.
- Without `@khorsheed/dsh-capture` installed, nothing changes for the user: the article stays a plain refusal.

Verified by hand: the capture service (system Chrome) rendered the WeChat article in about 16s with `js_content` present, no challenge text, and loaded `mmbiz` images, which the extractor emits with `referrerpolicy="no-referrer"`.

**Follow-ups after the first 3080 deploy.**

- Bodies are cached as already-extracted HTML until their TTL, so the SVG rules above never reached a figure stored before the deploy (fig1 still showed dots). `repairStoredSvg` re-applies the `var()` resolution and the responsive-duplicate drop when a body is shown (`setArticle`). Old bodies are fixed without a refetch.
- The add path saved `fetched.url`. For WeChat that was the challenge landing (`/wappoc_appmsgcaptcha?…&target_url=…`), so the card's title and link pointed at the captcha page. The add path now keeps the requested URL. `normalizeSource` walks an already-saved link back through `challengeTarget` (a captcha/challenge path that carries `target_url`/`return_url`/`redirect_url`), and relabels it only when the label was the landing's default.
- The status was unclear: while the rendered fetch ran, the card mixed the refusal with the script-figure copy and a 「受限篇幅」 notice over an empty body. Now:
  - a dedicated spinner line, `detail.renderingWall`, replaces the refusal while the render runs; busy is tracked per entry;
  - a failed render says why (`detail.renderFailed`) and keeps the retry button;
  - the truncation notice appears only over a body;
  - a successful render updates the entry title from the extracted article.

## Alternatives considered

**Inline the source site's stylesheet values for the custom properties.** The values live in external CSS that the host fetch does not retrieve, and they are theme-dependent. `currentColor` keeps the figure legible in both reader themes without a second fetch.

**Hide the narrow duplicate with CSS instead of dropping it.** The extractor's whitelist strips the site's class-based media queries, so the reader has no reliable hook. Dropping the duplicate also keeps it out of the stored body and the translation input.

**Send a browser User-Agent from the host fetch.** `web-fetch-http` accepts only `{url}` from plugins. A UA change is a host change that would go through the upstream pipeline. WeChat's challenge also checks more than the UA. The rendered fetch already exists and solves the page.

## Consequences

- A custom property that really is a fill color with no fallback now draws as the text color rather than its brand color. That is legible, though not faithful.
- An SVG named `…-sm` that is not a responsive duplicate, but has a sibling SVG, is dropped.
- WeChat (and any page behind a recognizable 200 challenge) needs the capture plugin. Without it, the reader now tells the truth ("blocked") instead of saving the challenge page as the body.
- Tests: `tests/extract-article.spec.ts` (var resolution, responsive drop, lone narrow kept, display-time repair of a cached body), `tests/boot.spec.ts` (200 challenge recorded as blocked, requested URL kept), `tests/host-pure.spec.ts` (challenge-landing link migrated), `tests/ReaderPane.client.spec.tsx` (auto-render on a WeChat wall; plain refusal without capture; render progress line and failure reason).
