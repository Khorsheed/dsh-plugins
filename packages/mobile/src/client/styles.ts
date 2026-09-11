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

/* The library is a mobile-owned page over the retained official conversation. */
[data-mobile-library] {
  position: absolute; inset: var(--mobile-bar, 56px) 0 0; overflow-y: auto; pointer-events: auto;
  display: flex; flex-direction: column; background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #17213a); overscroll-behavior: contain;
  padding: 22px 24px max(20px, env(safe-area-inset-bottom)); box-sizing: border-box;
}
[data-mobile-library] button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
[data-mobile-library-header] { padding: 10px 0 20px; }
[data-mobile-eyebrow] { font-size: 11px; font-weight: 600; letter-spacing: .16em; color: var(--mobile-accent); }
[data-mobile-library] h1 { font-size: clamp(27px, 7.8vw, 36px); font-weight: 500; letter-spacing: -.06em; line-height: 1.25; margin: 17px 0 12px; }
[data-mobile-library-header] p { color: var(--dsw-alias-label-tertiary, #798194); font-size: 14px; line-height: 1.7; margin: 0 0 28px; }
[data-mobile-new] { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; border-radius: 20px; padding: 17px 19px; min-height: 60px; text-align: left; background: #4d6bfe; color: #fff; box-shadow: 0 8px 24px #4d6bfe25; }
[data-mobile-new] span:first-child { font-size: 25px; font-weight: 300; }
[data-mobile-new] span:last-child { margin-left: auto; font-size: 21px; opacity: .8; }
[data-mobile-search] { display: flex; align-items: center; gap: 10px; padding: 0 16px; margin-top: 24px; min-height: 48px; border-radius: 16px; background: var(--dsw-alias-bg-l1, #f5f6f9); color: #8991a2; }
[data-mobile-search] input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: var(--dsw-alias-label-primary, #17213a); font: inherit; font-size: 16px; padding: 12px 0; }
[data-mobile-search]:focus-within { outline: 2px solid #4d6bfe65; outline-offset: 2px; }
[data-mobile-recents] { flex: 1; }
[data-mobile-section-title] { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
[data-mobile-section-title] h2 { font-size: 13px; font-weight: 500; margin: 0; color: var(--dsw-alias-label-tertiary, #798194); }
[data-mobile-section-title] button, [data-mobile-library-footer] button { border: 0; background: none; color: var(--mobile-accent); min-height: 44px; padding: 8px 0 8px 12px; font-size: 12px; }
[data-mobile-recents] ul { list-style: none; padding: 0; margin: 4px -10px 0; }
[data-mobile-session] { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 80px; text-align: left; border: 0; border-radius: 18px; padding: 14px 10px; background: none; color: inherit; }
[data-mobile-session][aria-current="page"] { background: #4d6bfe08; }
[data-mobile-session]:active { background: #4d6bfe12; }
[data-mobile-session-icon] { width: 38px; height: 42px; display: grid; place-items: center; color: #7888b0; background: #7189c70a; border-radius: 13px; flex-shrink: 0; }
[data-mobile-session-copy] { min-width: 0; flex: 1; }
[data-mobile-session-copy] strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 500; line-height: 1.6; }
[data-mobile-session-copy] small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 5px; color: var(--dsw-alias-label-tertiary, #798194); font-size: 11px; }
[data-mobile-row-arrow] { color: #aeb5c5; font-size: 23px; }
[data-mobile-activity] { color: #4d6bfe; font-size: 10px; white-space: nowrap; }
[data-mobile-completed] { width: 6px; height: 6px; background: #26a782; border-radius: 50%; }
[data-mobile-empty] { color: #8991a2; font-size: 14px; padding: 36px 0; text-align: center; }
[data-mobile-library-footer] { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-top: 26px; }
[data-mobile-library-footer] > span { font-size: 10px; color: #8991a2; }
[data-mobile-library] button:focus-visible, [data-mobile-toolbar] button:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
html[data-dsh-mobile] [data-mobile-toolbar] { border-bottom: 0; padding: 0 16px; }
html[data-dsh-mobile] [data-mobile-toolbar] strong { font-size: 17px; letter-spacing: -.4px; }
html[data-dsh-mobile] [data-conversation-scroll] { padding-inline: 4px; }
html[data-dsh-mobile] [data-composer-card] { border: 1px solid var(--dsw-alias-border-l3, #e7eaf2); border-radius: 22px; box-shadow: 0 4px 22px #25335b09; }
html[data-dsh-mobile] [data-composer-card] [data-input-scroll] { max-height: min(28dvh, 220px); }
html[data-dsh-mobile] [data-composer-card] > div:last-child { flex-wrap: wrap; gap: 8px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div { flex-wrap: wrap; min-width: 0; gap: 6px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child { margin-left: auto; }
html[data-dsh-mobile] [data-composer-card] > div:last-child button { min-height: 40px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div > button { min-width: 40px; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { min-width: 0; max-width: min(62vw, 270px); }
@media (prefers-reduced-motion: reduce) { [data-mobile-frame] * { scroll-behavior: auto !important; } }
`
