# CCTV Relay

The web build reads the public camera API URL from `camera-relay.json`.
An explicit `PARKVIEW_CAMERA_API_BASE_URL` environment variable overrides it.
The Pages workflow no longer injects the obsolete localtunnel secret.
Never put camera credentials or the admin token in this JSON or web config.

The current Cloudflare Quick Tunnel is temporary. Keep its process and the
local API running. A new Quick Tunnel gets a new URL, requiring this JSON
and the web deployment to be updated. This is not an always-on production
deployment. A named Cloudflare Tunnel with a fixed hostname and a continuously
running camera host is required for that.

The API must run with `PARKVIEW_PUBLIC_RELAY=true` and listen on localhost.
Keep administrator authentication enabled. Only API routes are exposed;
the repository, `.env` and saved debug captures must remain inaccessible.

Before changing the public URL, check OPTIONS for the GitHub Pages origin,
health GET, and that unauthenticated region requests return 401.

Official reference:
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
