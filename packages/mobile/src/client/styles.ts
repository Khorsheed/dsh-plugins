export const ORDINARY_TITLE = '[data-slot="main.conversation"] header:has([data-conversation-header-corner]) nav:has(> span:only-child > button:disabled + [data-slot="conversation.session.header.lineage"]:empty)'
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

/* Only the checked rc1 single, ordinary breadcrumb is redundant with our title.
   Keep child lineage, ancestor navigation, actions, utilities and tabs untouched. */
html[data-dsh-mobile]:has([data-mobile-session-title]) ${ORDINARY_TITLE} { display:none; }
[data-mobile-restore] { position:fixed; right:16px; bottom:max(16px,env(safe-area-inset-bottom)); z-index:1200; pointer-events:auto; min-height:44px; padding:10px 18px; border:1px solid #4d6bfe40; border-radius:24px; background:var(--dsw-alias-bg-base,white); color:#4d6bfe; font:inherit; box-shadow:0 3px 18px #15244318; }

/* Mobile-owned library: scrolling content and a separate keyboard-aware search dock. */
[data-mobile-library] { position:absolute; inset:var(--mobile-bar,56px) 0 0; display:flex; flex-direction:column; overflow:hidden; pointer-events:auto; background:var(--dsw-alias-bg-base,white); color:var(--dsw-alias-label-primary,#181a20); }
[data-mobile-library] button { font:inherit; cursor:pointer; color:inherit; -webkit-tap-highlight-color:transparent; }
[data-mobile-library-header] { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; gap:12px; padding:12px 22px 14px; }
[data-mobile-library] h1 { margin:0; font-size:30px; font-weight:600; letter-spacing:-1px; }
[data-mobile-grouping] { display:flex; padding:3px; border-radius:13px; background:var(--dsw-alias-bg-module-platform,#f2f3f6); }
[data-mobile-grouping] button { border:0; border-radius:10px; min-height:44px; padding:0 12px; font-size:12px; background:none; }
[data-mobile-grouping] button[aria-pressed=true] { background:var(--dsw-alias-button-floating-fill,white); box-shadow:0 1px 4px #17203815; }
[data-mobile-recents] { flex:1; min-height:0; overflow-y:auto; padding:0 22px 12px; overscroll-behavior:contain; }
[data-mobile-session-group] h2 { color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; font-weight:500; margin:16px 0 4px; }
[data-mobile-session-group] ul { list-style:none; padding:0; margin:0; }
[data-mobile-workspace-group] { display:grid; grid-template-columns:18px minmax(0,1fr) auto 18px; align-items:center; width:100%; gap:9px; padding:14px 0; min-height:48px; text-align:left; background:none; border:0; }
[data-mobile-workspace-group] svg { display:block; }
[data-mobile-workspace-group] strong, [data-mobile-workspace-group] small { line-height:20px; margin:0; }
[data-mobile-workspace-group] strong { min-width:0; overflow-wrap:anywhere; font-size:14px; font-weight:500; }
[data-mobile-workspace-group] small { color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; }
[data-mobile-session] { display:flex; align-items:center; gap:12px; width:100%; min-height:78px; padding:16px 0; text-align:left; border:0; border-bottom:1px solid var(--dsw-alias-border-l3,#e8e9ee); background:none; }
[data-mobile-session-copy] { min-width:0; flex:1; }
[data-mobile-session-copy] strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; line-height:1.5; font-weight:500; }
[data-mobile-session-copy] small { display:block; color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-mobile-session] time { font-size:11px; color:var(--dsw-alias-label-tertiary,#727680); flex-shrink:0; }
[data-mobile-session]:active { background:#4d6bfe0a; }
[data-mobile-activity] { font-size:11px; color:var(--mobile-accent,#4d6bfe); white-space:nowrap; }
[data-mobile-activity]::before { content:''; display:inline-block; width:5px; height:5px; margin-right:5px; vertical-align:middle; border-radius:50%; background:currentColor; }
[data-mobile-empty] { color:var(--dsw-alias-label-tertiary,#727680); padding:32px 0; text-align:center; font-size:14px; }
[data-mobile-search-dock] { display:flex; flex-shrink:0; align-items:center; gap:10px; padding:12px 16px max(10px,env(safe-area-inset-bottom)); background:var(--dsw-alias-bg-base,white); }
[data-mobile-search] { display:flex; flex:1; min-width:0; align-items:center; gap:8px; min-height:50px; border:1px solid var(--dsw-alias-border-l3,#e8e9ee); border-radius:28px; padding:0 16px; background:var(--dsw-alias-bg-module-platform,#f2f3f6); color:var(--dsw-alias-label-tertiary,#727680); }
[data-mobile-search] svg { flex-shrink:0; }
[data-mobile-search] input { width:100%; min-width:0; border:0; background:none; color:var(--dsw-alias-label-primary,#181a20); font:inherit; font-size:16px; padding:12px 0; }
[data-mobile-search]:focus-within { outline:2px solid #4d6bfe65; outline-offset:2px; }
[data-mobile-scan] { display:grid; place-items:center; width:50px; height:50px; flex-shrink:0; border:1px solid var(--dsw-alias-border-l3,#e8e9ee); background:var(--dsw-alias-bg-module-platform,#f2f3f6); border-radius:50%; }
[data-mobile-search-cancel] { min-height:50px; min-width:44px; color:var(--mobile-accent,#4d6bfe) !important; background:none; border:0; font-size:14px; }
[data-mobile-nav-title] { flex:1; min-width:0; text-align:center; }
[data-mobile-nav-title] strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-primary,#181a20); font-size:16px; }
html[data-dsh-mobile] [data-mobile-toolbar] { border-bottom:0; padding:0 12px; }
[data-mobile-toolbar] button { color:var(--mobile-accent,#4d6bfe); }
[data-mobile-connection-status] { position:absolute; top:var(--mobile-bar); left:12px; right:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-radius:12px; padding:0 12px; font-size:12px; background:var(--dsw-alias-bg-module-platform,#f2f3f6); pointer-events:auto; z-index:1; }
[data-mobile-connection-status] button { border:0; background:none; color:var(--mobile-accent,#4d6bfe); min-height:40px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) { --mobile-bar:96px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-toolbar] { height:56px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-connection-status] { top:56px; }
[data-mobile-dialog] { margin:auto 0 0; width:100%; max-width:none; max-height:75dvh; border-radius:26px 26px 0 0; padding-bottom:max(24px,env(safe-area-inset-bottom)); }
[data-mobile-dialog] [data-mobile-option] { width:100%; display:block; text-align:left; border-radius:0; border-bottom:1px solid var(--dsw-alias-border-l3,#e8e9ee); padding:14px 0; }
/* Preserve the official composer, controls, confirmations and message actions. */
html[data-dsh-mobile] [data-composer-card] { border-radius:20px; box-shadow:none; background:var(--dsw-alias-bg-module-platform,#f2f3f6); }
html[data-dsh-mobile] [data-composer-card] [data-input-scroll] { max-height:min(28dvh,220px); }
html[data-dsh-mobile] [data-composer-card] > div:last-child { flex-wrap:wrap; gap:8px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div { flex-wrap:wrap; min-width:0; gap:6px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child { margin-left:auto; }
html[data-dsh-mobile] [data-composer-card] > div:last-child button { min-height:44px; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { min-width:0; max-width:min(62vw,270px); }
/* Dock the same blank-session composer; the checked hero mark anchors its optional headline. */
html[data-dsh-mobile] [data-slot="main.conversation"] [data-phase="hero"] [data-conversation-scroll] { justify-content:flex-end; }
html[data-dsh-mobile] [data-slot="main.conversation"] [data-phase="hero"] [data-composer-seat] { flex:1; min-height:0; }
html[data-dsh-mobile] [data-phase="hero"] [data-composer-seat] > div:has([data-slot="conversation.hero.brand.mark"]) { flex:1; align-self:stretch; padding-bottom:8px; }
html[data-dsh-mobile] [data-phase="hero"] [data-composer-seat] > div > div:first-child:has([data-slot="conversation.hero.brand.mark"]) { flex:1; min-height:100px; justify-content:center; }
/* rc1 semantic menu anchors, only inside the official composer/hero seats. */
html[data-dsh-mobile] :is([data-composer-card],[data-slot="conversation.hero.agentPreset"],[data-slot="conversation.hero.workspace"]) [role="menu"]:not([role="menu"] [role="menu"]) {
  position:fixed !important; inset:auto 12px max(12px,env(safe-area-inset-bottom)) !important; width:auto !important; min-width:0; max-width:none; max-height:min(65dvh,520px); overflow-y:auto; border-radius:24px; padding:12px; z-index:1100;
}
html[data-dsh-mobile] :is([data-composer-card],[data-slot="conversation.hero.agentPreset"],[data-slot="conversation.hero.workspace"]) [role="menuitem"] { min-height:48px; }
/* Approved mobile visual system. Native SwiftUI owns its safe area; Safari owns its own. */
/* Resolve aliases on body: the official theme presenter publishes its palette there.
   Root aliases resolve before body tokens exist and freeze their light fallbacks. */
html[data-dsh-mobile] body { --mobile-face:var(--dsw-alias-button-floating-fill,#fff); --mobile-soft:var(--dsw-alias-bg-module-platform,#f3f4f6); --mobile-line:var(--dsw-alias-border-l3,#eceef1); --mobile-accent:var(--dsw-alias-state-business-primary,#4d6bfe); --mobile-shadow:0 6px 24px #1823380b; }
html[data-mobile-native-insets] [data-mobile-frame] { padding-bottom:0; }
html[data-mobile-native-insets] :is([data-mobile-search-dock],[data-mobile-dialog]) { padding-bottom:8px; }
html[data-dsh-mobile] [data-mobile-toolbar] { height:64px; padding:8px 16px; }
html[data-dsh-mobile] { --mobile-bar:64px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) { --mobile-bar:104px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-toolbar] { height:64px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-connection-status] { top:64px; }
[data-mobile-toolbar] button { display:grid; place-items:center; width:44px; height:44px; padding:0; border-radius:50%; corner-shape:round; background:var(--mobile-face); box-shadow:var(--mobile-shadow); color:var(--dsw-alias-label-primary,#202226); }
[data-mobile-nav-title] strong { font-weight:500; letter-spacing:0; }
[data-mobile-library] h1 { font-size:26px; font-weight:500; letter-spacing:-.7px; }
[data-mobile-grouping] { border-radius:19px; }
[data-mobile-grouping] button { border-radius:16px; min-height:38px; }
[data-mobile-library-header] { padding:16px 20px; }
[data-mobile-recents] { padding:0 12px 12px; }
[data-mobile-workspace-group] { padding:12px 10px; color:var(--dsw-alias-label-tertiary,#74767c)!important; }
[data-mobile-workspace-group] strong { font-size:13px; font-weight:400; }
[data-mobile-session-group] h2 { padding:0 10px; }
[data-mobile-session] { border:0; border-radius:16px; padding:14px 12px; min-height:68px; }
[data-mobile-session][aria-current=page] { background:var(--mobile-soft); }
[data-mobile-session-copy] strong { font-size:15px; font-weight:400; }
[data-mobile-session-copy] small:empty { display:none; }
[data-mobile-search-dock] { padding:12px 14px max(8px,env(safe-area-inset-bottom)); gap:8px; }
[data-mobile-search] { min-height:50px; background:var(--mobile-face); border:1px solid var(--mobile-line); box-shadow:var(--mobile-shadow); }
[data-mobile-search]:focus-within { outline:none; }
[data-mobile-search] input:focus, html[data-dsh-mobile] [data-composer-card] [contenteditable]:focus { outline:none!important; box-shadow:none!important; }
[data-mobile-search] input::placeholder { color:var(--dsw-alias-label-secondary,#61666b); opacity:1; }
html[data-dsh-mobile] [data-composer-placeholder] { color:var(--dsw-alias-label-secondary,#61666b); }
[data-mobile-search] input, html[data-dsh-mobile] [data-composer-card] [contenteditable] { caret-color:var(--mobile-accent); }
html[data-mobile-input=keyboard] [data-mobile-search]:focus-within, html[data-mobile-input=keyboard] [data-composer-card]:has([contenteditable]:focus) { outline:2px solid var(--mobile-accent); outline-offset:3px; }
[data-mobile-scan], [data-mobile-search-cancel] { display:grid; place-items:center; min-width:50px; width:50px; height:50px; border:1px solid var(--mobile-line); background:var(--mobile-face); box-shadow:var(--mobile-shadow); border-radius:50%; corner-shape:round; color:var(--dsw-alias-label-primary,#202226)!important; }
html[data-dsh-mobile] [data-composer-card] { border-radius:25px; border:1px solid var(--mobile-line); background:var(--mobile-face); box-shadow:var(--mobile-shadow); }
html[data-dsh-mobile] [data-composer-card] > div:last-child { gap:4px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div { gap:3px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child button { min-height:40px; }
/* rc1's two direct toolbar buttons precede the hidden attachment input.
   Scope narrowly so plugin buttons, permission menus and send retain their own states. */
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:first-child > button:has(~ input[type=file][hidden]) { width:40px; height:40px; min-width:40px; padding:0; background:transparent; border-radius:50%; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:first-child > button:has(~ input[type=file][hidden]):active:not(:disabled) { background:var(--dsw-alias-interactive-bg-active); }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { max-width:min(43vw,210px); }
html[data-dsh-mobile] [data-composer-seat] { padding-bottom:2px; }
html[data-dsh-mobile] [data-composer-stats] { padding:4px 12px 0; gap:10px; font-size:11px; }
html[data-dsh-mobile] [data-composer-stats] button { min-height:32px; }
/* Follow the real chain fallback -> stack -> HeroShell path, not display:contents wrappers. */
html[data-dsh-mobile] [data-phase=hero] [data-composer-seat] { flex:1 0 auto; }
html[data-dsh-mobile] [data-phase=hero] [data-chain-overlay-fallback="conversation.composer"] > div:has([data-mobile-welcome]) { flex:1; align-self:stretch; padding-bottom:0; width:100%; }
html[data-dsh-mobile] [data-phase=hero] [data-chain-overlay-fallback="conversation.composer"] > div > div:has([data-mobile-welcome]) { flex:1; height:auto; min-height:160px; padding:24px 16px 40px; }
html[data-dsh-mobile] [data-phase=hero] span:has(> [data-slot="conversation.hero.brand.mark"]):has([data-mobile-welcome]) + span { display:none; }
[data-mobile-welcome] { text-align:center; }
[data-mobile-welcome] small { color:var(--mobile-accent); letter-spacing:3px; font-size:13px; }
[data-mobile-welcome] h2 { font-size:25px; font-weight:500; line-height:1.4; margin:16px 0 9px; letter-spacing:-.6px; }
[data-mobile-welcome] p { font-size:13px; line-height:1.6; margin:0; color:var(--dsw-alias-label-tertiary,#74767c); }
html[data-dsh-mobile]:has([data-phase=hero]) [data-mobile-toolbar][data-library=false] [data-mobile-new=true] { visibility:hidden; }
html[data-dsh-mobile] [data-phase=hero] div:has(> [data-slot="conversation.hero.workspace"]) { gap:6px; padding:6px 18px; flex-wrap:wrap; }
html[data-dsh-mobile] [data-phase=hero] div:has(> [data-slot="conversation.hero.workspace"]) > button, html[data-dsh-mobile] [data-slot="conversation.hero.agentPreset"] button[aria-haspopup] { border-radius:18px; min-height:40px; font-size:13px; background:var(--mobile-soft); }
/* Quiet, read-only metadata below the mobile title. */
[data-mobile-subtitle] { display:flex; justify-content:center; align-items:center; gap:5px; margin-top:3px; font-size:11px; line-height:16px; color:var(--dsw-alias-label-secondary,#61666b); }
[data-mobile-subtitle] > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-mobile-subtitle] > span:last-child:not(:first-child) { flex-shrink:0; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
html[data-dsh-mobile]:has([data-mobile-session-title]) [data-mobile-header-hidden], [data-mobile-hidden-tab] { display:none!important; }
/* Fold only the identified official trigger buttons, not their menus or owners. */
[data-mobile-folded-action] { display:none!important; }
[data-mobile-tools-seat] { display:contents; }
html[data-dsh-mobile] [data-mobile-tools-open] { display:grid; place-items:center; width:44px; height:44px; min-width:44px; padding:0; border:0; border-radius:50%; corner-shape:round; color:var(--dsw-alias-label-primary); background:var(--mobile-soft); }
[data-mobile-tools-dialog] { box-sizing:border-box; margin:auto auto 0; width:min(100%,520px); max-width:100%; max-height:75dvh; overflow-y:auto; padding:16px 20px max(20px,env(safe-area-inset-bottom)); border:1px solid var(--mobile-line); border-bottom:0; border-radius:26px 26px 0 0; background:var(--mobile-face); color:var(--dsw-alias-label-primary); box-shadow:0 -8px 40px #0002; }
[data-mobile-tools-dialog]::backdrop { background:#0005; }
[data-mobile-tools-dialog] [data-mobile-tools-handle] { width:34px; height:4px; margin:0 auto 12px; border-radius:4px; background:var(--dsw-alias-label-tertiary); opacity:.5; }
[data-mobile-tools-dialog] header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
[data-mobile-tools-dialog] strong { font-size:16px; font-weight:500; }
[data-mobile-tools-dialog] button { font:inherit; color:inherit; cursor:pointer; border:0; background:transparent; -webkit-tap-highlight-color:transparent; }
[data-mobile-tools-dialog] button:disabled { opacity:.45; cursor:default; }
[data-mobile-tools-dialog] header button { width:44px; height:44px; display:grid; place-items:center; border-radius:50%; padding:0; }
[data-mobile-tools-grid] { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
[data-mobile-tools-grid] button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; min-height:92px; padding:12px; border-radius:20px; background:var(--mobile-soft); font-size:14px; }
[data-mobile-tools-permission] { display:flex; align-items:center; width:100%; gap:10px; margin-top:12px; min-height:64px; padding:12px 0; text-align:left; font-size:14px!important; }
[data-mobile-tools-permission] > span { flex-shrink:0; }
[data-mobile-tools-permission] > small { margin-left:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--dsw-alias-label-secondary); }
[data-mobile-tools-dialog] svg { flex:none; }
html[data-mobile-input=pointer] [data-mobile-tools-dialog] button:focus { outline:none; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child > button:has(>svg):not([aria-haspopup]) { width:44px; height:44px; min-width:44px; padding:0; border-radius:50%; corner-shape:round; transform:none; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child > button:has(>svg):not([aria-haspopup]) > svg { width:20px; height:20px; flex:none; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { max-width:min(56vw,260px); }
/* Keep the host context meter immediately before Send in the same flex row. */
html[data-dsh-mobile] [data-composer-card] > div:last-child, html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child { flex-wrap:nowrap; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { min-width:0; max-width:min(43vw,210px); flex:1 1 auto; }
/* rc1's model slot uses display:contents. Size its root and restore the label
   after folding the other input controls; unknown renderers keep their markup. */
html[data-dsh-mobile] [data-slot="conversation.input.model"] > div { min-width:0; max-width:min(43vw,210px); }
html[data-dsh-mobile] [data-slot="conversation.input.model"] > div > button[aria-haspopup="menu"]:has(> svg:first-child + span) { max-width:100%; height:44px; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] > div > button[aria-haspopup="menu"] > svg:first-child:has(+ span) { display:none; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] > div > button[aria-haspopup="menu"] > svg:first-child + span { display:block; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child > span:has(> button[aria-haspopup="dialog"] > svg > circle) { position:static; flex:0 0 auto; }
/* Translucency belongs to surfaces. Foreground colors remain fully opaque. */
html[data-dsh-mobile] body { --mobile-shadow:0 6px 22px color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent); --mobile-glass:color-mix(in srgb,var(--mobile-face) 86%,transparent); --mobile-edge:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent); }
html[data-dsh-mobile] :is([data-mobile-toolbar] button,[data-mobile-scan],[data-mobile-search-cancel],[data-mobile-search],[data-mobile-tools-open],[data-composer-card]) {
  background:var(--mobile-glass); border:1px solid var(--mobile-edge); box-shadow:inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent),var(--mobile-shadow);
  -webkit-backdrop-filter:blur(18px) saturate(1.25); backdrop-filter:blur(18px) saturate(1.25);
}
html[data-dsh-mobile] :is([data-mobile-toolbar] button,[data-mobile-scan],[data-mobile-tools-open]):active { background:var(--mobile-soft); transform:scale(.97); }
html[data-dsh-mobile] [data-mobile-icon] { flex-shrink:0; aspect-ratio:1; }
@media (prefers-reduced-transparency: reduce) { html[data-dsh-mobile] body { --mobile-glass:var(--mobile-face); } }
@supports not (backdrop-filter:blur(1px)) { html[data-dsh-mobile] body { --mobile-glass:var(--mobile-face); } }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child { flex:1 1 0; justify-content:flex-end; }
html[data-dsh-mobile] [data-composer-seat] div:has(> textarea):has(> div > button[aria-label]) { border-radius:25px; background:var(--mobile-glass); border:1px solid var(--mobile-edge); box-shadow:var(--mobile-shadow); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px); }
html[data-dsh-mobile] [data-composer-seat] textarea { font-size:16px; max-height:26dvh; }
html[data-dsh-mobile] [data-composer-seat] div:has(> textarea) > div > button[aria-label] { width:44px; height:44px; min-width:44px; padding:0; border-radius:50%; }
html[data-dsh-mobile] [data-composer-seat]:has([data-mobile-room-queue]) [data-testid="room-queue-strip"] { display:none; }
[data-mobile-room-queue] { padding:4px 16px; }
[data-mobile-queue-pill] { border:1px solid var(--mobile-edge); background:var(--mobile-glass); border-radius:20px; padding:8px 14px; min-height:36px; color:var(--dsw-alias-label-primary); }
[data-mobile-queue-row] { padding:8px 0; border-bottom:1px solid var(--mobile-line); }
[data-mobile-queue-row] p { overflow-wrap:anywhere; white-space:pre-wrap; font-size:14px; }
[data-mobile-queue-row] button { min-height:44px; padding:8px 12px; }
[data-mobile-queue-row] textarea { width:100%; background:var(--mobile-soft); color:var(--dsw-alias-label-primary); border:1px solid var(--mobile-line); border-radius:12px; padding:8px; }
/* Mobile action surfaces retain each plugin's controls and callback semantics. */
[data-mobile-message-menu] { position:fixed; margin:0; width:240px; max-width:calc(100vw - 24px); padding:8px; border-radius:22px; border:1px solid var(--mobile-edge); background:var(--mobile-glass); color:var(--dsw-alias-label-primary); box-shadow:var(--mobile-shadow); -webkit-backdrop-filter:blur(22px); backdrop-filter:blur(22px); }
[data-mobile-message-menu]::backdrop { background:#0002; }
[data-mobile-message-menu] button { display:flex; gap:14px; align-items:center; width:100%; min-height:48px; padding:8px 14px; border:0; border-radius:14px; background:none; color:inherit; font:inherit; text-align:left; }
[data-mobile-message-menu] button:active { background:var(--mobile-soft); }
[data-mobile-message-menu] svg { width:20px; height:20px; flex:none; }
[data-mobile-message-menu] button:disabled { opacity:.45; }
[data-mobile-toolbar]:has([data-mobile-members-open]) > [data-mobile-new] { display:none; }
[data-mobile-members-open] { position:relative; }
[data-mobile-members-open] small { position:absolute; bottom:-3px; right:-2px; min-width:16px; border-radius:10px; font-size:10px; background:var(--mobile-soft); color:var(--dsw-alias-label-primary); }
[data-mobile-room-dialog] { text-align:left; line-height:1.5; }
[data-mobile-room-dialog] header button { background:var(--mobile-soft); }
[data-mobile-room-dialog] label { display:block; font-size:13px; margin:16px 0; }
[data-mobile-room-dialog] :is(input,textarea,select) { display:block; width:100%; box-sizing:border-box; border:1px solid var(--mobile-line); border-radius:14px; padding:12px; margin-top:6px; font:inherit; font-size:16px; background:var(--mobile-soft); color:var(--dsw-alias-label-primary); }
[data-mobile-room-dialog] [role=alert] { color:var(--dsw-alias-state-danger-primary,#b73535); font-size:13px; }
[data-mobile-room-hint], [data-mobile-room-dialog] details { font-size:12px; color:var(--dsw-alias-label-secondary); }
[data-mobile-room-dialog] details { overflow-wrap:anywhere; }
[data-mobile-member-row] { display:flex; align-items:center; gap:8px; padding:6px 0; }
[data-mobile-member-chat] { display:flex!important; align-items:center; flex:1; min-width:0; gap:12px; text-align:left; padding:8px 0; }
[data-mobile-member-chat]:disabled { opacity:1!important; }
[data-mobile-member-chat] > span:last-child { min-width:0; }
[data-mobile-member-chat] strong, [data-mobile-member-chat] small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-mobile-member-chat] small { font-size:12px; color:var(--dsw-alias-label-secondary); }
[data-mobile-avatar] { display:grid; place-items:center; width:42px; height:42px; flex:none; border-radius:15px; background:var(--mobile-soft); }
[data-mobile-room-dialog] [data-mobile-room-primary] { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:46px; margin:18px 0 8px; border-radius:16px; background:var(--mobile-accent); color:var(--dsw-alias-bg-base); }
[data-mobile-room-dialog] :is([data-mobile-room-back],[data-mobile-room-secondary] button,[data-mobile-confirm] button) { min-height:44px; padding:8px 16px; }
[data-mobile-room-secondary] { display:flex; justify-content:space-between; }
html[data-dsh-mobile] [data-queue-dock] { max-width:100%; }
html[data-dsh-mobile] [data-queue-dock] button { min-height:40px; }
html[data-dsh-mobile] [data-slot="conversation.input.dock"] section:has(> button[aria-expanded]) > button { min-height:36px; border-radius:20px; }
html[data-dsh-mobile] [data-slot="conversation.input.dock"] section > ul[aria-label] { position:fixed; inset:auto 12px max(12px,env(safe-area-inset-bottom)); min-width:0; max-width:none; max-height:62dvh; border-radius:24px; padding:12px; z-index:1200; box-shadow:var(--mobile-shadow); }
html[data-dsh-mobile] [data-slot="conversation.input.dock"] section > ul[aria-label] button { min-height:44px; }
@media (prefers-reduced-motion: reduce) { [data-mobile-frame] * { scroll-behavior:auto !important; } }

/* One mobile reading scale; derived from host text size without writing its preference. */
html[data-dsh-mobile] body { --mobile-text:max(17px,var(--dsh-content-font-size,14px)); --mobile-caption:max(14px,var(--dsh-content-font-size-secondary,13px)); }
html[data-dsh-mobile] :is([data-mobile-library],[data-mobile-dialog],[data-mobile-tools-dialog],[data-mobile-message-menu]) { font-size:var(--mobile-text); line-height:1.55; }
html[data-dsh-mobile] :is([data-mobile-nav-title] strong,[data-mobile-session-copy] strong,[data-mobile-search] input,[data-composer-card] [contenteditable],[data-composer-seat] textarea,[data-mobile-member-chat] strong) { font-size:var(--mobile-text); line-height:1.55; }
html[data-dsh-mobile] :is([data-mobile-workspace-group] strong,[data-mobile-tools-grid] button,[data-mobile-tools-permission],[data-mobile-dialog] h3,[data-mobile-grouping] button) { font-size:16px!important; }
html[data-dsh-mobile] :is([data-mobile-subtitle],[data-mobile-nav-title] small,[data-mobile-session-copy] small,[data-mobile-session] time,[data-mobile-workspace-group] small,[data-mobile-session-group] h2,[data-mobile-activity],[data-mobile-room-hint],[data-mobile-member-chat] small,[data-mobile-tools-permission] small,[data-mobile-dialog] p) { font-size:var(--mobile-caption); line-height:1.5; color:var(--dsw-alias-label-secondary); }
html[data-dsh-mobile] [data-slot="conversation.input.model"] button { font-size:15px; }
html[data-dsh-mobile] [data-conversation-scroll] {
  --dsh-content-font-size:var(--mobile-text); --dsh-content-font-size-secondary:var(--mobile-caption);
  --dsw-font-markdown-base:var(--mobile-text)/1.65 var(--dsw-font-family);
  --dsw-font-markdown-base-font-size:var(--mobile-text); --dsw-font-markdown-base-line-height:1.65;
  --dsw-font-markdown-base-strong:600 var(--mobile-text)/1.65 var(--dsw-font-family);
  --dsw-font-markdown-base-strong-font-size:var(--mobile-text);
  --dsw-font-markdown-base-italic:italic var(--mobile-text)/1.65 var(--dsw-font-family);
  --dsw-font-markdown-base-italic-font-size:var(--mobile-text);
}
/* All Room invite/edit entry points retain the same React form and callbacks. */
html[data-dsh-mobile] [data-mobile-header-hidden]:has([data-mobile-room-form]) { display:contents!important; }
html[data-dsh-mobile] [data-mobile-room-overlay] { position:fixed; inset:0; height:var(--mobile-height,100dvh); z-index:1400; align-items:flex-end; justify-content:center; padding:8px; box-sizing:border-box; background:#0005; -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
html[data-dsh-mobile] [data-mobile-room-form] { box-sizing:border-box; width:100%; max-width:560px; max-height:calc(var(--mobile-height,100dvh) - 24px); margin:0; gap:16px; padding:20px 20px max(16px,env(safe-area-inset-bottom)); border-radius:28px; border:1px solid var(--mobile-edge); background:var(--mobile-face); color:var(--dsw-alias-label-primary); box-shadow:var(--mobile-shadow); text-align:left; overflow-y:auto; font-size:var(--mobile-text); }
html[data-dsh-mobile] [data-mobile-room-form]::before { content:''; display:block; flex:none; width:36px; height:4px; border-radius:4px; background:var(--dsw-alias-label-secondary); opacity:.35; align-self:center; margin:-10px 0 0; }
html[data-dsh-mobile] [data-mobile-room-form] > div:first-child { font-size:21px; line-height:1.4; font-weight:600; }
html[data-dsh-mobile] [data-mobile-room-form] > div:has(> div > label) { flex-direction:column; gap:16px; }
html[data-dsh-mobile] [data-mobile-room-form] > div > div:has(>label) { gap:18px; }
html[data-dsh-mobile] [data-mobile-room-form] > div > div:has(>[data-member]) { order:-1; width:auto; }
html[data-dsh-mobile] [data-mobile-room-form] > div > div:has(>[data-member]) > span { display:none; }
html[data-dsh-mobile] [data-mobile-room-form] [data-member] { border:0; background:var(--mobile-soft); border-radius:18px; padding:14px; }
html[data-dsh-mobile] [data-mobile-room-form] [data-member] p { font-size:14px; margin:6px 0 0; }
html[data-dsh-mobile] [data-mobile-room-form] label { gap:7px; }
html[data-dsh-mobile] [data-mobile-room-form] label > span:first-child { font-size:15px; line-height:1.5; font-weight:500; color:var(--dsw-alias-label-primary); }
html[data-dsh-mobile] [data-mobile-room-form] label > span:last-child:not(:first-child), html[data-dsh-mobile] [data-mobile-room-form] [role=status] { font-size:14px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
html[data-dsh-mobile] [data-mobile-room-form] :is(input,textarea,select) { box-sizing:border-box; min-width:0; min-height:48px; border-radius:14px; padding:11px 12px; font-size:17px; line-height:1.5; background:var(--mobile-soft); border:1px solid var(--mobile-edge); color:var(--dsw-alias-label-primary); }
html[data-dsh-mobile] [data-mobile-room-form] textarea { min-height:94px; resize:vertical; }
html[data-dsh-mobile] [data-mobile-room-form] button { min-height:44px; min-width:44px; font-size:16px; border-radius:14px; }
html[data-dsh-mobile] [data-mobile-room-form] summary { min-height:44px; padding:10px 0; font-size:16px; color:var(--dsw-alias-label-primary); }
html[data-dsh-mobile] [data-mobile-room-form] > div:last-child { position:sticky; bottom:-16px; background:var(--mobile-face); padding:12px 0 0; margin-top:0; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
html[data-dsh-mobile] [data-mobile-room-form] [role=alert] { font-size:15px; line-height:1.5; }
html[data-dsh-mobile] [data-member] { font-size:16px; }
html[data-dsh-mobile] [data-member] button { min-height:44px; font-size:15px; }
html[data-dsh-mobile] [data-mobile-room-form] [data-member] > div:first-child > span:nth-child(2) > span:first-child { font-size:16px; }
html[data-dsh-mobile] [data-mobile-room-form] [data-member] p { color:var(--dsw-alias-label-secondary); }
html[data-dsh-mobile] [data-mobile-room-form] > div:last-child button:disabled { opacity:1; color:var(--dsw-alias-label-secondary); background:var(--mobile-soft); border:1px solid var(--mobile-edge); cursor:default; }
html[data-dsh-mobile] [data-mobile-queue-row] p { font-size:var(--mobile-text); }
html[data-dsh-mobile] [data-mobile-members-open] small { font-size:12px; min-width:18px; }
`
