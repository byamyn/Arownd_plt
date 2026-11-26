# Arownd self-hosted routing

Arownd uses OpenStreetMap road data and a self-hosted Valhalla engine. The default extract set covers Algeria, Morocco and Egypt, plus the Geofabrik GCC States extract for Saudi Arabia and the UAE. MapLibre remains the mobile map renderer; this service is responsible only for route calculation and turn-by-turn instructions.

## Components

- **Valhalla**: builds a local road graph from the configured OSM PBF extract and serves driving routes on the private Docker network.
- **Nginx gateway**: exposes only `POST /route`, applies per-IP request/connection limits, caps request size, and hides the Valhalla service.
- **Caddy**: terminates HTTPS for the public routing hostname and proxies to the gateway.
- **Persistent volumes**: retain Valhalla graph data and Caddy certificates across restarts.

The Valhalla port is not published to the host or the public internet.

## Initial deployment

1. Provision a Linux VPS with Docker Engine and the Docker Compose plugin. Point a DNS A/AAAA record for the routing hostname to the server.
2. Copy `.env.example` to `.env` and set `ROUTING_DOMAIN`. Keep `.env` private.
3. Review and pin `VALHALLA_IMAGE` to a tested release or image digest before production.
4. Start the stack:

   ```sh
   cd routing
   cp .env.example .env
   # Edit .env before starting.
   docker compose up -d
   docker compose logs -f valhalla
   ```

5. Wait for the first graph build to finish. Do not send production traffic until a route smoke test succeeds.
6. Verify the public gateway:

   ```sh
   curl -fsS https://$ROUTING_DOMAIN/healthz
   curl -fsS -X POST "https://$ROUTING_DOMAIN/route" \
     -H 'Content-Type: application/json' \
     -d '{"locations":[{"lat":36.7538,"lon":3.0588},{"lat":36.3650,"lon":6.6147}],"costing":"auto","units":"kilometers","shape_format":"polyline6"}'
   ```

   The route request is a smoke test between Algiers and Constantine; the returned route must contain a trip summary and at least one leg with a shape.

## Mobile configuration

Set `EXPO_PUBLIC_ROUTING_URL=https://<your-routing-domain>` in the EAS environment used for the target build/update. The app sends route requests to `POST /route`.

This variable is public app configuration, not a secret. Never put server credentials in an `EXPO_PUBLIC_*` variable. Build or publish the mobile bundle with the correct environment after the server is reachable. Until this variable is configured, the app retains the existing OSRM demo fallback for development only; it must not be treated as the production routing backend.

## Operations

- Keep the Valhalla graph volume persistent. Rebuilding or deleting it triggers a full graph build.
- Monitor CPU, memory, disk, response latency, HTTP 429/5xx rates, and Valhalla logs during graph builds and route traffic.
- Back up the `valhalla_data` volume and test restoration before production.
- Update the OSM extract on a controlled schedule. Stage the new PBF, rebuild the graph, run route smoke tests, then switch traffic. Avoid rebuilding the live graph in place during peak usage.
- Pin and test image versions rather than relying on `latest` indefinitely.
- The default extracts cover the five currently active Arownd markets. Valhalla scripted accepts multiple PBF URLs, but the upstream Docker guide does not recommend multi-URL builds for every workload. Measure build memory/time and validate routing in each market and at country boundaries before production. Add future markets by extending the extract set and repeating those tests.

## Security and capacity notes

The gateway rate limit is an initial conservative setting, not a final capacity guarantee. Tune it from observed traffic and protect the host with firewall rules, SSH hardening, monitoring, and regular security updates. The public endpoint intentionally has no embedded API secret because a mobile binary cannot keep one confidential.

## Data attribution

OpenStreetMap data is © OpenStreetMap contributors and is available under the Open Database License (ODbL). Arownd must provide visible attribution and link to the OSM copyright/licence information in its map/about experience. Map tile/style attribution remains separately controlled by the tile/style provider.
