# AgentGuard AI

Automated agents fail silently. AgentGuard makes heartbeats observable, turns repeated failures into a single deduplicated incident, and keeps a human-approved audit trail.

**Live application: https://bamaboy101.github.io/agentguard-ai/** — open it in any browser. No login, no installation, no local server.

| | |
|---|---|
| Frontend | https://bamaboy101.github.io/agentguard-ai/ |
| Backend API | https://agentguard-api.marketmesh-api.workers.dev |
| API health | https://agentguard-api.marketmesh-api.workers.dev/api/health |

## Architecture

```mermaid
flowchart LR
  B[Browser] --> P["GitHub Pages<br/>apps/web/index.html"]
  P -->|"HTTPS + x-demo-session"| W["Cloudflare Worker<br/>Hono API"]
  W --> D[("Cloudflare D1")]
```

The frontend is a single self-contained `apps/web/index.html` (React and Tailwind from CDN). There is **no build step**, so the committed file is exactly what is served — this removes any drift between source and deployment.

Three independent GitHub Actions workflows:

| Workflow | Purpose |
|---|---|
| `pages.yml` | Publishes `apps/web/index.html` to GitHub Pages and verifies the *published* HTML references the Worker |
| `ci.yml` | API typecheck (`tsc --noEmit`) and unit tests (`vitest`) with committed lockfiles |
| `e2e.yml` | Headless Chromium against the **live public URL**; uploads desktop + mobile screenshots, Playwright report, network/console diagnostics |

Frontend deployment is deliberately decoupled from backend tests, so a failing test can never take the public site down.

## Verified features

- Service registry with last-seen heartbeat state
- Controlled heartbeat, stop and failure actions against seeded demo services
- Burst-failure detection: three failures inside ten minutes open exactly one incident (deduplicated)
- Acknowledge → Resolve lifecycle; Resolve stays reachable after acknowledgement
- Audit trail of every acknowledgement and resolution, persisted per visitor

## Technologies

React (CDN) + Tailwind standalone frontend · Cloudflare Worker (Hono) · Cloudflare D1

## Running locally

```bash
git clone https://github.com/Bamaboy101/agentguard-ai.git
cd agentguard-ai/apps/api
npm ci
npm test            # unit tests
npm run build       # typecheck
npx wrangler dev    # API on http://localhost:8787
```

Serve `apps/web/index.html` with any static server to run the frontend locally.

### Browser acceptance tests

```bash
cd e2e
npm ci
npx playwright install chromium
APP_NAME=agentguard-ai WORKER_BASE=https://agentguard-api.marketmesh-api.workers.dev npx playwright test
```

Tests run against the deployed public URL by default and write screenshots to `e2e/screenshots/`.

## Security and data isolation

- **Anonymous sessions.** The Worker issues an opaque UUID session id; the browser stores it in `localStorage` and sends it as `x-demo-session`. Every record is stamped with that id and every read is filtered by it, so two different browsers never see each other's records, while a reload keeps your own history. Verified with two independent browser contexts.
- **Rate limiting.** 120 requests/minute per session; exceeding it returns `429` with `Retry-After`.
- **Request size ceiling.** Bodies above 512 KiB are rejected with `413`.
- **CORS allowlist.** Only the published GitHub Pages origin (and local dev origins) receive `Access-Control-Allow-Origin`; arbitrary origins receive none.
- **Input validation.** All write endpoints validate required fields and return `400` with a JSON error.
- **No secrets in the frontend.** The published HTML contains no API keys, tokens or credentials.

## Limitations and honest scope

- Demo controls only ever address seeded `svc-demo-*` services. No private or production infrastructure is reachable.
- No remote shell, reboot or automatic remediation — recovery is a human decision recorded in the audit log.
- Missed-heartbeat state is derived from recorded heartbeats; the demo does not run background schedulers.

## Test evidence

CI, deployment and browser-acceptance runs — including screenshots and Playwright reports — are published as GitHub Actions artifacts on every run:
**https://github.com/Bamaboy101/agentguard-ai/actions**

## License

MIT
