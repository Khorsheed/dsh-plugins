# Agent Note: Desktop Origin for the browser handoff

Status: implemented

## Problem

Desktop repeatedly showed the connection-interrupted notice while the Host and delegation worked. The ankh-guard handoff required an HTTP(S) Origin matching Host, but Desktop serves the application as `dsh-app://app` and strips Origin when forwarding the request. Every poll therefore returned 403, which the client surfaced as a disconnection after five seconds.

## Decision

The handoff recognizes two Desktop request forms: `Origin: dsh-app://app` and an omitted Origin. It maps either form to the request's actual HTTP(S) Host only when that Host is `localhost`, `127.0.0.1`, or `[::1]`. The socket's encrypted state selects HTTP or HTTPS. Registration and final-process URLs use that loopback origin, not the custom application scheme.

Ordinary Web Origin matching is unchanged. `null`, other application pages, non-loopback Hosts, and foreign HTTP Origins remain forbidden. JSON content type, cookie authentication, capability hashes, registration matching, and final acknowledgement requirements are unchanged. The client continues to report genuine transport failures and completed cutovers.

This is entirely a plugin change. Desktop forwarding and the Host account service are not modified.

## Alternatives considered

**Accept every missing or custom Origin.** Rejected: it would remove the Origin check for arbitrary deployments. Only the two Desktop forms on a loopback Host are admitted.

**Accept only `dsh-app://app`.** Rejected: Desktop removes Origin before forwarding, so the actual request would still fail. Both forms are required.

**Change Desktop to preserve Origin.** Rejected: the plugin owns the handoff's accepted protocol and can support the official forwarding behavior without a host change.

**Hide the notice.** Rejected: it would conceal the broken restart-recovery channel instead of restoring it.

## Consequences

Healthy Desktop sessions no longer misreport the handoff as a network outage, and restart recovery can use the same origin and capability flow as Web. No credential or new durable state is introduced. Non-loopback Desktop Hosts fail closed rather than weakening the check for remote Web deployments.

Protocol tests cover both accepted forms, the correct launch URL and authenticated acknowledgement, plus `null`, another application page, a foreign HTTP Origin and a forged non-loopback Host. The tests use a raw HTTP request for the forged Host because Fetch does not provide a reliable way to override that header.
