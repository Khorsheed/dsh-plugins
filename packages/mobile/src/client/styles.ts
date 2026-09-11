/** Local overrides target official slot anchors; frame attributes are verified before activation. */
export const MOBILE_CSS = `
html[data-dsh-mobile] { --mobile-bar: 56px; --mobile-accent: #4d6bfe; }
html[data-dsh-mobile] body { overscroll-behavior: none; }
html[data-dsh-mobile] [data-mobile-frame] {
  box-sizing: border-box; height: var(--mobile-height, 100dvh) !important;
  padding-top: var(--mobile-bar); padding-bottom: env(safe-area-inset-bottom, 0px);
  grid-template-columns: 0px minmax(0, 1fr) 0px !important;
  grid-template-rows: minmax(0, 1fr); transition: none !important;
}
html[data-dsh-mobile] [data-mobile-frame] > div:has(> [data-slot="sidebar"]) {
  position: absolute; inset: var(--mobile-bar) auto 0 0; z-index: 22;
  width: min(88vw, 360px); border-radius: 0 24px 24px 0;
  box-shadow: 16px 0 60px #15244320;
}
html[data-dsh-mobile] [data-mobile-frame][data-sidebar-collapsed] > div:has(> [data-slot="sidebar"]) { display: none; }
html[data-dsh-mobile] [data-mobile-frame] > div:has(> [data-slot="main"]) { grid-column: 2; grid-row: 1; min-width: 0; }
html[data-dsh-mobile] [data-mobile-frame] > [data-rightbar-col] { grid-column: 3; grid-row: 1; }
html[data-dsh-mobile] [data-mobile-frame]:not([data-rightbar-collapsed]) > [data-rightbar-col] {
  position: absolute; inset: var(--mobile-bar) 0 0; z-index: 24; width: 100%;
  background: var(--dsw-alias-bg-base, white); min-width: 0;
}
html[data-dsh-mobile] [data-mobile-frame] > [data-side] { display: none; }
html[data-dsh-mobile] [data-mobile-frame] > [data-shell-overlay] { z-index: 23; pointer-events: none; }
html[data-dsh-mobile] [data-slot="main.conversation"] > div {
  --dsh-chat-content-width: calc(100vw - 48px);
  --dsh-composer-side-clearance: 12px;
}
html[data-dsh-mobile] [data-composer-card] { border-radius: 24px; }
html[data-dsh-mobile] [data-composer-card] [contenteditable="true"] { font-size: 16px; }
html[data-dsh-mobile] [data-width-handle] { display: none; }
html[data-dsh-mobile] [data-composer-seat] { padding-bottom: 8px; }
html[data-dsh-mobile] [data-conversation-scroll] { overscroll-behavior-y: contain; }
html[data-dsh-mobile] [data-slot="conversation.header.tabs"] { overflow-x: auto; }
html[data-dsh-mobile] [data-slot="conversation.input.left"],
html[data-dsh-mobile] [data-slot="conversation.input.right"] { max-width: 100%; }
[data-mobile-toolbar] {
  position: absolute; inset: 0 0 auto; height: var(--mobile-bar, 56px); display: flex;
  align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px;
  box-sizing: border-box; background: var(--dsw-alias-bg-base, #fff);
  border-bottom: 1px solid var(--dsw-alias-border-l3, #edf0f5); pointer-events: auto;
}
[data-mobile-toolbar] button, [data-mobile-dialog] button {
  border: 0; border-radius: 16px; min-height: 44px; min-width: 44px;
  padding: 10px 14px; font: inherit; cursor: pointer;
  color: var(--dsw-alias-label-primary, #152443); background: transparent;
  -webkit-tap-highlight-color: transparent;
}
[data-mobile-toolbar] button:hover, [data-mobile-dialog] button:hover { background: #4d6bfe12; }
[data-mobile-toolbar] strong { font-size: 18px; font-weight: 600; letter-spacing: -0.6px; color: var(--mobile-accent, #4d6bfe); }
[data-mobile-toolbar] small { color: var(--dsw-alias-label-tertiary, #778195); font-size: 11px; display: block; text-align: center; }
[data-mobile-toolbar] svg { display: block; }
[data-mobile-shade] { position: absolute; inset: var(--mobile-bar) 0 0 min(88vw, 360px); border: 0; background: #15244330; pointer-events: auto; }
[data-mobile-dialog] {
  color: var(--dsw-alias-label-primary, #152443); background: var(--dsw-alias-bg-base, white);
  border: 1px solid var(--dsw-alias-border-l3, #e6eaf2); border-radius: 28px;
  width: min(440px, calc(100vw - 32px)); box-sizing: border-box; padding: 24px;
  max-height: calc(100dvh - 48px); overflow-y: auto; box-shadow: 0 24px 90px #15244325;
}
[data-mobile-dialog] input { box-sizing: border-box; width: 100%; margin-top: 12px; padding: 14px; border: 1px solid #ccd3df; border-radius: 14px; font: inherit; font-size: 16px; }
[data-mobile-dialog] button:disabled { opacity: .4; cursor: default; }
[data-mobile-dialog]::backdrop { background: #15244355; backdrop-filter: blur(8px); }
[data-mobile-dialog] h2 { margin: 0 0 24px; font-size: 24px; font-weight: 500; }
[data-mobile-dialog] h3 { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-tertiary, #778195); margin: 24px 0 10px; }
[data-mobile-dialog] p { font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-tertiary, #778195); overflow-wrap: anywhere; }
[data-mobile-dialog] [role="group"] { display: flex; flex-wrap: wrap; gap: 6px; }
[data-mobile-dialog] button[aria-pressed="true"] { color: #4d6bfe; background: #4d6bfe12; }
[data-mobile-dialog] [data-mobile-done] { display: block; width: 100%; margin-top: 24px; background: #4d6bfe; color: white; border-radius: 100px; }
@media (prefers-reduced-motion: reduce) { [data-mobile-frame] * { scroll-behavior: auto !important; } }
`
