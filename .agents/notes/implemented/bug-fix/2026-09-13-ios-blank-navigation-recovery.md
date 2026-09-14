# Agent Note: Recover an uncommitted iOS WebView

Status: implemented

## Problem

The physical app could remain on about:blank with only its native connection strip. A fresh navigation on that device returned HTTP 401. Rejecting that response generated a second WebKit policy error which overwrote the actionable login explanation. Both Reload buttons cleared the error and called WKWebView.reload(), which cannot navigate an uncommitted blank view to the configured Host.

## Decision

Use one BrowserState reload action: refresh an existing same-origin document, otherwise explicitly load the configured login URL. Preserve the authentication rejection through the policy-cancellation callback. Bound unfinished native navigation to 30 seconds and show recovery actions; cancel the deadline on completion, error, dismantle or WebContent termination. Keep DEBUG lifecycle diagnostics free of URLs, tokens and cookies.

WebKit completion is not the only readiness signal: a validated same-origin, main-frame mobile `ready` bridge message also cancels the load deadline, clears loading and clears a previous timeout. Otherwise slow subresources can leave a usable page behind a false timeout banner. Readiness cannot clear an explicit authentication rejection. The deadline checks readiness again before stopping WebKit, and a new navigation resets the old error. Regression acceptance covers ready-with-stalled-resource, readiness arriving after the deadline, genuinely stalled navigation and rejected login.

## Alternatives considered

Repeatedly restarting the Host would not repair the native retry action. Automatically clearing all website data would discard a usable login and unrelated app preferences. An unconditional reload loop could keep repeating an expired login without giving the user a way to replace it.

## Consequences

This requires a native app update, not a Host source change. A genuinely expired or missing official login still needs a valid session; the fix does not bypass authentication or issue credentials. A native load deadline is distinct from the subsequent plugin/large-conversation loading time. Physical evidence and remaining checks belong in the acceptance record.
