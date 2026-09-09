# 我和你和我和你... / You and Me

p5.js webcam sculpture. The original OBJ, black background, video strips and
network-driven sphere text are retained. `npm start` serves the artwork;
`npm test` verifies TURN configuration and WebRTC connection cleanup.

## Cross-network video requires TURN

The public room uses `https://p5livemedia.itp.io/` for signaling. Video and
participant presence (language, color, network speed) use WebRTC. STUN-only
direct connections cannot cover restrictive NATs used by mobile operators.
The same-Wi-Fi or same-computer test is **not** a cross-network acceptance test.

The app now fetches `/api/rtc-config` before joining. If TURN is not configured,
the endpoint explicitly returns `relayConfigured: false`; LAN/direct viewing
continues, but the mobile-network issue remains unresolved.

### Enable a relay on Vercel

Choose one option in **younme → Settings → Environment Variables → Production**,
then redeploy. Do not put provider keys in browser JavaScript or GitHub.

- Cloudflare Realtime TURN: set `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` using a
  TURN key created in your own Cloudflare account. The server exchanges these
  for per-visitor credentials valid for 24 hours; the long-term token is never
  sent to visitors. The supplied UDP, TCP and TLS/443 relay URLs are retained.
- Self-hosted coturn: set `TURN_URLS` (comma-separated `turn:` / `turns:` URLs)
  and `TURN_SHARED_SECRET` matching coturn's `static-auth-secret`. The server
  signs unique, expiring TURN REST credentials. Configure a valid TLS
  certificate and reachable UDP and TLS/TCP relay ports on that server.

No relay account has been provisioned by this repository. Provider billing and
quotas must be configured in the owner's account. The artwork is public, so
short-lived relay credentials are available to visitors; same-site checks are
not authentication or a spending limit. Apply provider usage limits and
deployment rate limits before broadly advertising the site. Sessions longer
than 24 hours should reload to obtain fresh credentials.

Provider documentation:
https://developers.cloudflare.com/realtime/turn/generate-credentials/

### Acceptance checks

1. Load `/api/rtc-status`. It reports only whether credentials were obtained
   and the enabled protocols; it never returns TURN credentials. A result of
   `relayConfigured: true` means credentials were obtained, **not** that media
   has successfully traversed a relay.
2. Open the site in two clients with `?relay=1`. This diagnostic mode enforces
   `iceTransportPolicy: "relay"`; a successful local direct path cannot mask
   a broken TURN service. Both clients must show remote video and each should
   report a `media-route` event with `route: "relay"`.
3. Use a phone with Wi-Fi off and a computer on Wi-Fi. Verify both see the
   other's moving video strips and participant-colored sphere text.
4. Close/reopen a participant. Verify remote video and peer state are cleared,
   then reconnect successfully. Verify switching networks separately.

Browser console events are prefixed `[younme:connection]`. The bounded
`window.younmeConnection` diagnostic object contains signaling state, whether
TURN is configured, ICE state, received-stream state and selected route. It
does not contain video content, SDP, IP addresses or credentials. Canvas
`data-relay` and `data-relay-peers` expose the relay state for browser checks.

Local synthetic-camera testing (no real camera permission required):
`/__preview?participants=1&network=1&seed=2` and another tab with `seed=4`.
Add `&signaling=public` to test the production signaling service, or `&relay=1`
to disallow direct connections. Preview routes are disabled in production.

## Current verification (2026-09-09)

- TURN credential construction, invalid-provider handling, bounded retries and
  disconnect cleanup: automated tests passed.
- Browser synthetic video over direct WebRTC: both clients received one remote
  video; rendering remained active and no browser errors were reported.
- Production TURN configuration: absent when inspected. Mobile-to-Wi-Fi and
  real relay transport are still pending a provisioned TURN service.
