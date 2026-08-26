---
name: inline-html-card
description: Make a live, interactive HTML preview that appears right in the conversation. Use it whenever the user wants to see a result visually instead of reading about it — a sample UI, a component mockup, a color/spacing/design-token reference, a "what would this look like" idea, a small clickable widget, a before/after, a card showing the current state (like progress, stats, or a mini dashboard). This also covers design work: when the user is redesigning or optimizing something and you want to confirm a visual detail, show it inline and iterate — render just the changed part, not a whole deliverable. Default to an inline preview to confirm details with the user; only fall back to writing a full HTML file if the user asks for a file or the details are settled and they want a complete artifact. If the user says "show me", "make it look like", "render this", "preview", "compare a few visual options", or wants to confirm how a design change looks, this is the tool. It renders a self-contained HTML block inline and lets the user interact with it. Writes a ```dsh-card fenced block.
---

# inline-html-card — authoring a live inline HTML card

## When to load

Load this skill whenever the user wants to **see something visually, right here in the chat instead of just reading your reply** — a sample of a UI, a mockup, a color/typography/spacing reference, "what would this look like", a small interactive thing (a toggle, tabs, a live mini-chart), a before/after, or a card that summarizes the current state (progress, stats, a compact dashboard). This includes the user asking you to "render", "preview", "show me", "make it look like", or when they want to choose between a few visual options. It also covers **design work**: redesigning or optimizing a surface where you want to confirm a visual detail with the user. If it would help to draw a picture of the answer rather than describe it in words or ASCII, use this skill. Write the result as a ` ```dsh-card ```` fenced block (see below).

## Show it inline first — don't reach for a file

When the user wants to see or confirm how something **looks**, your default is an **inline preview** — not writing an HTML file to disk. Follow this order:

1. **Inline preview first (the default).** Render the thing with a ` ```dsh-card ```` block so the user sees it in the message and can react to it. For a **局部细节** (a changed section, a specific component, a single face of the redesign) render **just that part** — don't build a whole deliverable you're only trying to confirm.
2. **Iterate on the detail inline.** Confirm the visual, adjust, show again — all in the chat. Stay in the preview loop until the user is happy.
3. **Offer a full file only after the details are settled.** Once it's stable, you can ask the user whether they want a **complete HTML file** — or wait for them to ask.
4. **Only write a file when asked.** Generate `*.html` to the workspace **only** if the user explicitly requests a full HTML artifact (to reuse, edit, or ship). Don't default to a file for something you can confirm inline.

Reach for the file only when it's genuinely a deliverable, not when the goal is to show/confirm a look. If you're in doubt, show it inline and ask.

## The contract

Write exactly one fenced code block whose info string is `dsh-card`:

````
```dsh-card
...your HTML here...
```
````

Inside the fence, put a **fully self-contained HTML document** (fragment is fine; the renderer wraps missing `<html>`/`<head>` automatically). The browser half turns this into a sandboxed iframe and renders it inline where the block sits.

## The content IS the card — don't wrap it in a container

The user should see **the content itself**, not the content sitting inside another box you invented. Render the thing you're showing directly, at the width it needs, and let it sit naturally in the message.

- **Render the content, not a container.** Put your UI/text/visual directly in the body. Don't wrap it in an extra "window" (a title bar, ─ ✕ buttons, or a header row you added just to frame it) unless the user explicitly asked for a card/app window.
- **Width follows the content.** Let it be as wide as it needs to be (`width:100%` or a modest `max-width`, `margin:0`). Don't fix a narrow width and center it with large side margins — that leaves empty boxes around it.
- **No extra background box.** Don't give the top-level element a big solid background that spans the whole frame just for contrast; if you want contrast, color the content region itself, not a wrapper around it.
- **Height follows content, not a placeholder.** Don't set a large `min-height` just to fill space; let the layout be as tall as its real content.
- **Colors, theme, and fonts are yours to choose** — design them for the content and the user's intent, not for any assumed page background. Pick whatever palette/typography the thing itself calls for.

In short: what the block renders should be **exactly the content** — a mockup, a token reference, a mini dashboard — sized to itself and flush with the message, not a panel floating in a bigger box you added around it.

## The hard rules — violations fail silently (the #1 cause of "looks blank")

1. **Self-contained.** All CSS and JS inline. No external stylesheets, fonts, or scripts. Images as `data:` URIs.
2. **Zero runtime network.** No `fetch` / XHR / WebSocket / EventSource. The sandbox CSP sets `connect-src 'none'` — any network call just fails.
3. **No host access.** The frame is an opaque origin (`sandbox="allow-scripts"`, never `allow-same-origin`), so scripts cannot read parent DOM or cookies. The only way out is a tiny `window.dshBridge` (see below).
4. **No imposed look.** Style, colors, theme, and fonts are entirely up to you — design them for the content and the user's intent. What matters is that you render the content directly and don't add a meaningless container around it (no fixed narrow width centered with big margins, no extra solid-background wrapper). Leave the card's own design to the content, not to the surrounding chat.
5. **Size sane.** Keep the HTML small (a few KB). Avoid huge inline assets.

## Interactions that work

- **Want the card to respond to the user?** Add an **inline `<script>`** inside the card and bind with `addEventListener`. That's the normal, supported way to make buttons, tabs, timers, and state switches actually work — the card runs in a sandboxed iframe with scripts enabled (`allow-scripts`), so inline JS just works.
  - Example:
    ```html
    <button id="go">开始</button>
    <span id="out">未开始</span>
    <script>
      document.getElementById('go').addEventListener('click', function () {
        document.getElementById('out').textContent = '进行中…'
      })
    </script>
    ```
  - If the card should animate or count down (a timer, a breathing ball, progress), drive it from JS too — `setInterval` / `requestAnimationFrame` / updating the DOM are all fine inside the frame.
- Hover, click, toggling, tabs, and charts drawn with inline SVG/canvas also work under `allow-scripts`.
- To open a link, copy text, or download a file, use the bridge:
  - `await window.dshBridge.openLink('https://…')` (https: only)
  - `await window.dshBridge.copy('text')`
  - `await window.dshBridge.download('name.txt', 'data:…')`
  These route through the host's validated bridge; anything else is blocked.

## Recommended: embed this CSP meta in `<head>`

The renderer injects its own CSP if you omit it, but embedding the same one is harmless and keeps the artifact self-describing:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
```

## Self-check before finishing

- [ ] No external URL anywhere.
- [ ] No `fetch` / XHR / WebSocket.
- [ ] Fence info string is exactly `dsh-card`.
- [ ] Defaulted to an inline preview to confirm the look; only wrote an HTML file if the user asked for one or the details were settled and they wanted a complete artifact.
- [ ] For a local detail, rendered just that part, not a whole deliverable.
- [ ] The content IS the card — no fixed narrow width centered in a big panel, no extra solid-background "window" wrapper, no large empty `min-height`. You chose colors/theme/fonts for the content, not for the surrounding chat.
- [ ] If the card is meant to respond to the user, each interactive element has an inline `<script>` handler (`addEventListener`) wired to it — don't rely on CSS alone for click/state behavior.
- [ ] Without the plugin, the block degrades to a normal code block (never a crash).
