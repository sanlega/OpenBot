# Native iPhone protocol compatibility

## Goal
Allow the native iPhone app to pair securely with this desktop host on Windows
and continue using its encrypted HTTP and WebSocket connections.

## Scope
- Accept the native client's sealed QR completion request and send a sealed
  response containing device credentials.
- Support independent, scoped E2E streams for HTTP and WebSocket reconnects.
- Preserve existing supported PWA pairing and connection behavior.
- Rebuild the Windows app and verify on a physical iPhone.

## Outside scope
- Changing the QR secret lifetime, adding a relay, or redesigning desktop UI.
- Publishing a release before host and client interoperability is verified.

## Acceptance
1. A native-format sealed pairing request with a fresh QR creates a device and
   returns encrypted credentials; an invalid payload fails without disclosing
   secrets.
2. Encrypted HTTP and WebSocket requests work across separate sessions and
   reconnects after pairing.
3. Existing PWA pairing and connected flows still work.
4. A rebuilt Windows app pairs with the physical iPhone and shows live host
   data. Relevant checks pass.

## Tasks
- [ ] T1: Compare `packages/remote/src/{integration,framing,crypto,wire}.ts`,
  `packages/core/src/http/{auth,server}.ts`, and PWA/client code against the
  native client in the companion checkout. Document exact wire differences and
  compatibility requirements. Verify with a minimal native-format request.
- [ ] T2: Implement sealed pairing in the host with regression coverage for
  valid, malformed, expired, and reused requests. Verify focused remote/core
  tests, typecheck, and lint.
- [ ] T3: Implement scoped E2E stream lifecycle for HTTP and WebSocket while
  preserving existing PWA behavior. Verify encrypted connected flows and
  reconnects with integration tests.
- [ ] T4: Run build, typecheck, lint, formatting, and relevant suites; rebuild
  and install the Windows app; scan a fresh QR and verify connected flows on
  the physical iPhone. Update project memory and commit.

## Risks
- A partial pairing-only fix will leave connected API calls unable to decrypt.
- Legacy PWA clients depend on the old response and session shape; keep an
  explicit compatibility path until their migration is verified.
- A QR is single use and expires; generate a fresh one for every live attempt.
- Source changes do not affect an already installed Windows binary until it is
  rebuilt and installed.
