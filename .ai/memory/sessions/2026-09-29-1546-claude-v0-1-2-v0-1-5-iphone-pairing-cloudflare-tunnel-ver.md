# v0.1.2-v0.1.5: iPhone pairing + Cloudflare tunnel verified live

- **Fecha**: 2026-09-29 15:46
- **Agente**: claude
- **Rama**: main @ fbbaffa

Cut v0.1.2-v0.1.5: native iPhone pairing on the desktop host, Cloudflare token validation, on-demand cloudflared download, tunnel public hostname in the QR. Owner verified LAN and tunnel pairing on the iPhone.

## Done
- v0.1.2 ported the openbot-ios host protocol; v0.1.3 token format; v0.1.4 cloudflared auto-download (pinned SHA-256); v0.1.5 hostname field + log parsing + atomic network.json.
- Each release: full checks, tag, workflow green, checksum verified, installed with no active turns.

## Next
- Unpaired-device screen for 401s; persist tunnel token (vault) so it survives restarts; E2E recovery after restart; test cloudflared download on macOS/Linux.

## Retro
- Worked: real end-to-end tests with the owner each release exposed the next blocker quickly; pinning hashes from release digests.
- Failed: assumed a log format for hostname detection I could not verify, and my early claim that the phone flow was missing was wrong; also python heredoc edits with backslashes failed repeatedly - use Edit for those.
- Improve: prefer an explicit owner-entered setting over scraping third-party logs; verify format assumptions with real output before shipping.
