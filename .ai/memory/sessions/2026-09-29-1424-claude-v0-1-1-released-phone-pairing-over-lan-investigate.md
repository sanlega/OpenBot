# v0.1.1 released; phone pairing over LAN investigated (QR scheme fixed, phone flow missing)

- **Fecha**: 2026-09-29 14:24
- **Agente**: claude
- **Rama**: main @ d778a21

Released v0.1.1 (tag, installers, installed locally) and investigated phone pairing over LAN. Fixed the QR link scheme (http for LAN-only); found the UI has no phone-side pairing flow and that 401s render as 'Can't reach OpenBot'.

## Done
- v0.1.1 cut: versions bumped, CHANGELOG entry, tag pushed, release workflow green, installer checksum verified and installed.
- QR scheme fix in packages/remote (pairing.ts, integration.ts, test) — local, not pushed.

## Next
- plan-feature: phone pairing flow (#pair= handling, device key, pair/complete, token, E2E) + unpaired-device screen; secure-context question for crypto.subtle on HTTP LAN.
- Investigate torn read of network.json causing a 127.0.0.1 first bind.

## Retro
- Worked: checking the API by curl on both addresses separated server faults from UI faults quickly; verifying release checksums before installing.
- Failed: I told the owner to scan the QR before reading the client side; the missing phone flow only surfaced after two rounds of live testing.
- Improve: for any end-to-end flow, grep for the client of each server route before asking the human to test on hardware.
