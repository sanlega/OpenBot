# Native iPhone pairing diagnosis

## Findings
- The native phone reaches the Windows host over its LAN status endpoint, but
  scanning a fresh QR inside the app returns `invalid_request`.
- A harmless malformed sealed POST reaches this host's pairing route and
  returns `invalid_request`; the compatible macOS companion host returns a
  decrypt failure for the same request. This host expects a clear JSON body
  with `pairSecret`, `devicePub`, and `name` in
  `packages/remote/src/integration.ts`. The native client instead sends
  `{sealed}` with `x-openbot-pair-pub` and expects sealed credentials.
- `packages/remote/src/framing.ts` also uses a legacy per-device session. The
  native client uses independent scope IDs for HTTP and WebSocket streams.
  Pairing alone will not complete the interoperability fix.
- No code in this repository was changed during diagnosis. The companion
  iPhone repo has a verified macOS pairing path and pending small client fixes.

## Next
- Execute `.ai/memory/plans/2026-09-29-native-iphone-protocol.md` in order.
  Preserve existing PWA clients. Rebuild the Windows binary before retrying a
  fresh QR, because the installed app still runs the old protocol.

## Retro
- A minimal malformed request confirmed the server's routing behavior
  without sending a real pairing secret or recording a QR.
- The first timeout report suggested LAN trouble; checking Safari reachability
  and the specific server error separated network access from protocol parsing.
- The compatibility check must include post-pair encrypted requests, not only
  the pairing response.
