# iOS blank-page recovery — 2026-09-13

## Environment

Signed Debug iOS app on the existing physical iPhone, using the deployed HTTPS entrance to production 3080. This repair did not restart the Host or change its source/profile. It follows the [HTTP/2 cutover](mobile-http2-cutover-2026-09-13.md); process-launch success in that record did not establish successful phone authentication.

## Observations and results

- The physical Web Inspector reported `about:blank`, document ready state `complete`, and a 39-character empty HTML document. The user could see the native connection strip but no Host UI.
- Fresh native navigation returned HTTP 401, followed by WebKit cancellation code 102. The old error handler replaced the login explanation with a generic connection failure. Reload previously cleared the explanation and called reload on the blank view, without requesting the configured Host URL.
- The final native source centralizes retry, preserves the 401 explanation, and bounds incomplete navigation to 30 seconds. Signed device builds pass; the existing Foundation HostAddress checks pass (26 checks).
- The existing official public browser session remained valid (HTTP 200). A one-time local device recovery build restored that same authority-scoped official cookie through WKHTTPCookieStore. No authentication validation was disabled, no new server credential was issued, and no Host restart was used. Cookie values stayed in the helper process environment; they are absent from this record and source.
- The recovery instrumentation was removed from source and is absent from the final app binary. The final ordinary app was reinstalled and launched without recovery environment variables. Its saved official login survived that installation.
- Final physical navigation returned HTTP 200. Native diagnostics reported mobile frame, toolbar and library mounted, chrome visible, and no slot errors. A DVT screenshot confirmed the real conversation list behind the first-origin internal-test notice with its Continue button. This is physical visual evidence, not just devicectl launch acknowledgement.
- Simulator build passes. With a separate loopback fixture, a 401 response keeps the explicit login-expired explanation visible, and a response that never finishes produces the 30-second timeout explanation with both recovery buttons. Both screens were visually inspected; these checks made no production/model requests.
- The scoped repository gate passed all 11 applicable steps. Docker-dependent integration suites were skipped because Docker was unavailable; the native checks above ran separately.

## Limits

The user still needs to acknowledge the first-origin internal-test notice. Fresh model streaming, attachment flows and all gestures are outside this repair's acceptance. Restoring a development-device session is not a shipping pairing mechanism: a user whose official login has expired must still provide a valid official login or QR link.
