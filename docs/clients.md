# Independent reference clients

TASTEKEEPER includes three applications built by this project: The Reading Room (`books`), Tonight (`media`), and A Good Afternoon (`places`). These are reference integrations, not claimed partnerships. Each has a separate backend process, client credential, public browser origin, catalog, and opaque browser session.

Run `pnpm demo:setup` first, then keep the gateway, worker, and three clients running in separate terminals:

```sh
pnpm dev
pnpm worker
pnpm client:books
pnpm client:media
pnpm client:places
```

The local browser addresses are:

| Application      | Browser origin                 |
| ---------------- | ------------------------------ |
| The Reading Room | `http://books.localhost:3114`  |
| Tonight          | `http://media.localhost:3115`  |
| A Good Afternoon | `http://places.localhost:3116` |

Chromium resolves these localhost subdomains to the loopback interface. The servers bind to `127.0.0.1`. Each browser request must use the configured host; opening a client on `127.0.0.1` is intentionally rejected. The owner workspace uses a different host, so its host-only cookies are not sent to the client applications.

Each generated `.env.<client>.local` supplies `CLIENT_ID`, `CLIENT_SECRET`, `SESSION_SECRET`, `PORT`, `PUBLIC_ORIGIN`, `GATEWAY_ORIGIN`, and `OWNER_ORIGIN`. Secrets have no built-in fallback. `CLIENT_HOST` defaults to `127.0.0.1`; configure it explicitly when deploying behind a proxy. Set a distinct HTTPS `PUBLIC_ORIGIN` for every deployed client and preserve its Host header through the proxy. HTTPS origins receive Secure session cookies. Do not put these environment files in source control.

## Connecting and making a choice

Create an invitation for the desired application in the isolated owner demo. Open its client claim link, which has the shape `/claim#token=…`. The browser immediately removes the fragment, posts the invitation to the client’s own `/api/claim`, and receives only public session metadata. This role-play demo does not verify a person’s identity.

Use the application’s brief to narrow the approved catalog. The client backend derives the gateway’s grant, context, purpose, target type, snapshot, candidate identifiers, and output fields from its server-side session. The browser cannot substitute them. Each app displays the gateway’s result order without independently ranking or generating explanations. Public artwork and catalog facts are joined by item identifier.

“Keep this choice” records a selection through the gateway. The shortlist reloads from the gateway session. Public source links and the source-facts drawer provide handoff information; no purchase or booking occurs. Opening times, stock, merchant prices, streaming service availability, and current admission prices are not verified.

Authored sample mode is explicitly labeled. Its returned order and illustrative USD budgets are demonstration data, not live Qloo results or measured preference predictions. The Qloo live control makes an actual gateway request and shows its unavailable response when no key is configured; it does not silently substitute sample results.

## Client boundary

- All outbound server requests go to the single configured gateway origin. Client servers do not import or query a database.
- Gateway credentials are stored only in an in-memory server map. Browser cookies hold signed random session identifiers, with HttpOnly, SameSite=Lax, Path=/, no Domain, and Secure on HTTPS.
- A client cookie cannot authorize another client. Browser mutations require the exact `PUBLIC_ORIGIN`; static files, pages, and APIs require its Host header.
- The server explicitly projects public session, catalog, result, receipt, and selection fields before responding. Gateway credentials and unknown fields are stripped.
- Results, sessions, and selections are checked through the gateway on every access. Revocation, expiry, and changed access are displayed with a retry and owner-workspace recovery path.
- Gateway credentials are renewed before expiry. Restarting a client process loses its in-memory sessions; create a new invitation to reconnect. Idle sessions expire after 24 hours.
- Sensitive HTTP responses use `private, no-store`. CSP restricts scripts, styles, fonts, images, and browser API traffic to the client itself. Original artwork is generated locally; no remote image scraping is used.

`GET /health` can be checked on the loopback listener without the public Host header. It returns only service health and the public client identifier.

## Verification

```sh
pnpm exec tsx --test tests/clients.node.test.ts
pnpm exec eslint clients/server.ts clients/view.ts clients/client.js tests/clients.node.test.ts --max-warnings=0
pnpm typecheck
```

The client tests cover secret stripping, opaque cookies, host/origin enforcement, cross-client isolation, scope construction, strict input rejection, preservation of gateway order, persisted selection calls, credential renewal, real unavailable errors, and rejection of stored-result reads and selections after revocation.

With those five services running, `pnpm test:e2e tests/e2e.client.spec.ts` exercises every client at 1440 and 390 pixels in isolated browser contexts. It checks source facts, handoff links, saved selections in the owner API and after client reload, no owner/client credential crossover, public-only responses, touch target sizes, WCAG A/AA axe rules, explicit Qloo failure and sample retry, place constraints, and revoked-access recovery. Screenshots are written to the ignored `.artifacts/clients/` directory.
