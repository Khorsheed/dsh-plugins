# Mobile HTTP/2 cutover acceptance — 2026-09-13

## Environment

- Production web profile on port 3080; plugin source commit `d679c4b3` merged into main. Host `0.1.5-rc.1`, source commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`; no Host source edits.
- User explicitly approved restarting after the active task finished. The preceding status inspection found 405 sessions and no running sessions or background jobs.
- Standard `deploy:3080 --package packages/mobile --no-restart` staged the tarball/profile update during the maintenance window. Installed ankh-guard then performed the trusted-host launch reconfiguration with required browser handoff and `restore-previous` recovery. The staging command alone was not treated as completed deployment.
- Installed ingress on port 3182 uses `MOBILE_SAFARI_COMPAT=1`; Cloudflare tunnel transport is HTTP/2. The old owned QUIC tunnel was retired after public conversation verification.

## Results

| Check | Result | Evidence |
|---|---|---|
| Merge gate | Pass | 14 steps passed before main merge. Mobile build and 74 tests passed in the deployment flow. |
| Guard preflight | Pass | Built runner, isolated candidate probe and composition checks passed. |
| Guard cutover | Ready | Receipt `1789228720718-28499`; target succeeded on attempt 1, zero target/previous failures, recovery not needed. |
| Process ownership | Pass | Previous supervisor retired by validated identity. Target direct child 30231 / listener 30240 remained stable for 3000 ms; readiness retry count 0. |
| Canary and browser handoff | Pass | Canary passed; original-tab existing-cookie handoff acknowledged. Auth transport 401, exchange 303, authenticated response 200. |
| Public mobile list | Pass | Actual public WebKit mobile context authenticated and rendered 182 session rows. This DOM count is not the total session count. |
| Public conversation | Pass | Existing large conversation opened, rendering 28,819 normalized characters. Reload rendered 28,820 characters with the same normalized tail hash. No page errors, window scroll offset 0, editor unfocused. |
| Installed Safari compatibility | Pass | Public JS response reported `safari-json-v1; patched; count=2`. Patched response and large UI response used gzip (416,103 and 4,200,814 bytes respectively). No local asset routing was used for this public check. |
| Native installation | Pass | Signed iOS app with the AppIcon asset catalog installed successfully through devicectl. Native builds and 26 HostAddress checks were recorded in the preceding acceptance. |
| Physical launch | Pass | After the user unlocked the device, devicectl launched the installed app with the new public entry successfully (exit 0, locked false). The authenticated retry link remained only in helper process memory. This confirms process launch, not visual or live-stream acceptance. |

Guard artifact fingerprints:

- Runner SHA-256: `876e9a6f0c27752d19288302be0c8c2a90bda04cc4d8cd81408f2b679fa659cc`
- Install anchor SHA-256: `413ce32db388f4cbd6a18ab791699dd6228abc118e11f92ec8e14fba1c18d013`
- Target command SHA-256: `f2158bee9921136edca06ba27e943cc90f95a910724540e26b6cbc41dac74263`
- Candidate probe SHA-256: `f01cc4b80d806ecced7ad7e2d30396c3d28f351e56d656dbecfb126c442c1abe`

## Limits and follow-up

- A new public origin displayed the official internal-test notice. The first automated conversation click was blocked by that modal; clicking Continue allowed the final public check to complete. The phone may need the same acknowledgement once.
- Initial public loading took about 39 seconds and the large conversation reached the verification point after about 45 seconds. This proves successful loading, not an acceptable latency budget. A concurrent local Chromium comparison opened the conversation but timed out on reload; exact cross-engine transcript parity was not established in this maintenance check.
- No new model request was submitted for this deployment verification. The earlier deterministic Safari replay/continuation checks remain the evidence for the live-stream compatibility fix; a fresh Web-to-phone live run and physical navigation/icon inspection remain user acceptance items.
- Temporary login links, cookies, public tunnel credentials and private conversation text are excluded from this record.
