# v0.1.2 released; iPhone pairing verified live

- **Fecha**: 2026-09-29 14:51
- **Agente**: claude
- **Rama**: main @ 61e6fe6

Cut v0.1.2 (native iPhone pairing protocol ported onto the desktop host, QR link scheme fix), installed it on Windows; the owner confirmed the iPhone connects.

## Done
- Ported crypto/framing/index/integration (remote) and auth/server/ws (core) from openbot-ios; kept the http/https QR fix + test.
- Verified: build, typecheck, lint, format, mh check, 845 unit tests, 18 integration E2E; release green; installer checksum verified and installed.
- Handoff plan written in openbot-ios.

## Next
- Unpaired-device screen for 401s; atomic network.json write; verify E2E recovery after harness restart.

## Retro
- Worked: diffing the two checkouts per file isolated the protocol files; verifying release + checksum before install.
- Failed: I first told the owner the phone flow did not exist, without checking that the iPhone app lives in another repo; cost two rounds.
- Improve: at the start of any cross-device task, list sibling repos (gh repo list) before diagnosing.
