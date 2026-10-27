# Gateway API

The canonical owner/gateway origin is `http://127.0.0.1:3104`. Route bodies are strict Zod contracts in [contracts.ts](../src/domain/contracts.ts). Private responses use `private, no-store`; they must not be cached in a CDN or service worker. Errors use `{ "error": { "code": "…", "message": "…" } }` with safe messages.

## Owner endpoints

Owner operations require the host-only HttpOnly `tastekeeper_owner` cookie. Every mutation also requires `Origin` to exactly match `APP_ORIGIN`. The browser never supplies an owner or tenant identifier. POST bodies are JSON unless the route explicitly needs no body.

| Method | Endpoint                      | Behavior                                                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/demo`                   | Resume a valid sample session or create an isolated 24-hour tenant; no body. Enabled by `DEMO_ENABLED=true`.             |
| POST   | `/api/logout`                 | Invalidate the owner session and clear its browser cookie; no body. It does not revoke existing client grants.           |
| GET    | `/api/workspace`              | Private owner contexts, signals, grants, decision history, selections, and journal.                                      |
| POST   | `/api/contexts`               | Create a context after explicit identity confirmation from the reviewed starter library.                                 |
| POST   | `/api/invitations`            | Create a specific grant and single-use claim URL after consent.                                                          |
| POST   | `/api/corrections/preview`    | Show the exact removal and affected connections without changing state.                                                  |
| POST   | `/api/corrections`            | Apply the reviewed correction at the expected revision.                                                                  |
| POST   | `/api/grants/:id/revoke`      | Append a grant revision and block future access; body `{}`.                                                              |
| POST   | `/api/clients/:id/disable`    | Disable the tenant’s client and advance its epoch; body `{}`. No owner UI is provided for this administrative operation. |
| GET    | `/api/decisions/:id/evidence` | Owner-only captured references and authorization receipts.                                                               |
| GET    | `/api/health`                 | Public database/worker readiness and Qloo availability state.                                                            |

Invitation input:

```json
{
  "contextId": "<owned context UUID>",
  "clientId": "books",
  "purpose": "gift",
  "signalIds": ["ref-forest", "ref-everyday", "ref-community"],
  "expiresInHours": 24,
  "requestLimit": 3,
  "snapshotMode": "pinned",
  "delegateName": "Alex Example",
  "acknowledged": true
}
```

The server selects the named client catalog and current immutable snapshot. Gift grants use books/pinned. Personal grants can use any of the three clients and opt into `follow_current`. Output fields and the rank operation are fixed by this first implementation; arbitrary browser permissions are not accepted.

Correction input is the same for preview and apply:

```json
{
  "contextId": "<owned context UUID>",
  "expectedRevision": 1,
  "removeSignalIds": ["ref-forest"],
  "reason": "wrong_situation"
}
```

Reasons are `no_longer_interested`, `wrong_reference`, `wrong_situation`, and `already_know_it`. This release supports explicit removal from one context. It does not silently infer feedback, add signals, replace entity mappings, or broaden existing grants. Concurrent edits return `CORRECTION_CONFLICT` and require reviewing the current revision.

## Authenticated client endpoints

Every `/v1` request requires server-only `X-Client-Id` and `X-Client-Secret`. Except for invitation claim, it also requires either `Authorization: Bearer <opaque scoped credential>` or the first-party durable `X-Client-Session: <opaque handle>`. Supplying both is rejected. Never send these headers from a browser or include them in screenshots, example logs, or source control.

| Method | Endpoint                      | Behavior                                                                                                                |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/invitations/claim`       | Claim `{ "token": "<single-use invitation>" }`; returns credential to client server plus public scope/catalog metadata. |
| GET    | `/v1/session`                 | Current permitted public session, saved selections, run IDs and last brief; excludes private references and credential. |
| POST   | `/v1/credentials/renew`       | Renew a still-valid authorized credential; body `{}`.                                                                   |
| POST   | `/v1/decisions`               | Atomically authorize/reserve/enqueue one decision or return a valid idempotent replay.                                  |
| GET    | `/v1/decisions/:id`           | Poll state; release public result only after the final live gate.                                                       |
| POST   | `/v1/decisions/:id/selection` | Save `{ "itemId": "<released candidate ID>" }` through the same live gate.                                              |

Canonical decision shape:

```json
{
  "grantId": "<claimed grant UUID>",
  "contextId": "<approved context UUID>",
  "purpose": "gift",
  "operation": "rank",
  "targetType": "book",
  "snapshotId": "<permitted snapshot UUID>",
  "candidateIds": ["book-trees", "book-gathering"],
  "fields": ["id", "title", "description", "creator", "url", "price"],
  "hardConstraints": { "maxPrice": 4000, "format": "any" },
  "mode": "qloo",
  "brief": { "occasion": "birthday", "note": "A thoughtful small gift" },
  "idempotencyKey": "<fresh UUID>"
}
```

Use actual item identifiers from the permitted session catalog; the example values above illustrate the shape. Constraints intersect: `maxPrice` is integer minor USD units in the authored sample; books accept `format`, films `maxMinutes`, and places `setting`. Unsupported type/constraint combinations and unknown fields are rejected. At most ten distinct candidate IDs and ten active selected references are allowed. The first-party clients submit only their approved catalog IDs.

A queued response is `{ "id": "…", "state": "queued", "replayed": false }`. A valid replay can report the run’s current state. A prepared result is not yet authority to release. Successful GETs include `state: "released"`, approved public `items`, provenance, and a receipt naming the grant/context revisions, authorized time, and exact permitted field names. The owner-only payload digest and reference inputs are omitted from client receipts. Selection responses contain only saved item identity, public title, and save time.

## Failures and recovery

| Code                                                 | Meaning and recovery                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `INVALID_REQUEST`                                    | Strict body validation failed; correct the request.                                  |
| `ORIGIN_DENIED`                                      | The owner mutation came from an unapproved browser origin.                           |
| `PRINCIPAL_DENIED`                                   | Wrong tenant/client/delegate/grant/owner binding or inaccessible identifier.         |
| `GRANT_REVOKED`, `GRANT_EXPIRED`                     | A new recipient-approved invitation is required.                                     |
| `TOKEN_EXPIRED`                                      | The short-lived credential is no longer valid; an expired token cannot renew itself. |
| `CLIENT_DISABLED`                                    | Current client status/epoch disallows access.                                        |
| `REVISION_CHANGED`                                   | The captured decision is stale; start a new request against current permission.      |
| `CATALOG_DENIED`, `CANDIDATE_DENIED`, `SCOPE_DENIED` | The request is outside one or more approved bounds.                                  |
| `IDEMPOTENCY_CONFLICT`                               | The same key was used with a different canonical body.                               |
| `BUDGET_EXHAUSTED`                                   | All permitted decision requests have already been reserved.                          |
| `SIGNAL_SELECTION_REQUIRED`, `NO_ELIGIBLE_OPTIONS`   | Current references or hard constraints leave no eligible decision.                   |
| `UPSTREAM_UNAVAILABLE`                               | No live Qloo key/available call; authored mode requires a separate explicit choice.  |
| `UNMAPPED_CANDIDATES`                                | Sample identities have not been verified against Qloo. A key alone is insufficient.  |
| `RATE_LIMITED`                                       | The database-backed local request window has been exceeded.                          |

The six Qloo adapter statuses are separate from durable run states. `partial` and `degraded` retain those provenance labels when candidate results can be returned; empty, missing-input, and error outcomes do not silently become successful sample recommendations. See [architecture.md](architecture.md) for release serialization and failure semantics.

The browser-facing `/api/*` endpoints of each separate reference client deliberately accept a much narrower brief than `/v1/decisions`; see [clients.md](clients.md). There is no general proxy, arbitrary destination URL, delegated owner-context read, or browser credential endpoint.

## Durable browser sessions, search and deletion

`POST /v1/browser-sessions/claim` accepts the same single-use invitation body and returns public session metadata plus a random session handle only to the authenticated client backend. The backend places that handle in a signed, HttpOnly host-only cookie; it sends the handle server-to-server thereafter. The gateway stores the credential encrypted, renews it only under the original grant/client binding, and persists the last public brief and run membership. `POST /v1/browser-sessions/disconnect` with `{}` deletes the handle.

Owner search contracts (owner cookie and exact Origin required for mutations):

| Method | Endpoint                       | Body / behavior                                                                                                                                                      |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/reference-searches`      | `{query,type}` where query has 2–100 characters and type is `book`, `movie`, `place`, `person`, or `artist`. Returns `{id,state}`.                                   |
| GET    | `/api/reference-searches/:id`  | Owner-only state (`queued`, `searching`, `complete`, `failed`) and up to five projected candidates with opaque `id`, title, subtitle, type and optional safe source. |
| POST   | `/api/contexts/:id/references` | `{expectedRevision,searchId,candidateId}` explicitly confirms one unexpired result. Appends a context revision; existing grant signal IDs remain unchanged.          |
| DELETE | `/api/contexts/:id`            | Erase retained private profile/run payloads and end future access to this context.                                                                                   |
| DELETE | `/api/workspace`               | Erase this guest workspace’s application records and clear its owner cookie.                                                                                         |

A search failure is never filled with authored alternatives. `CORRECTION_CONFLICT` requires refreshing the context and reviewing the intended addition again. `REFERENCE_ALREADY_ADDED` identifies an already active exact identity. Search results expire after 30 minutes. Contexts support up to 30 active references, but every grant still requires an explicit subset of at most ten.

The optional client decision `brief` contains `occasion` (`birthday`, `thank_you`, `just_because`, `for_me`) and an optional note of at most 240 characters. It is public task input for the explanation agent, never an authorization argument. Released responses may include `explanations: [{itemId,text}]`, `provenance.mappedCount/unmappedCount`, and a labelled `provenance.agent` status. Owner evidence separately includes provider attempt counts and safe agent checkpoints.

## Private worker contract

The task worker requires Cloud Run IAM in production; it is not an unauthenticated public API. `GET /health` is provider-free. `POST /tasks/decision` accepts `{tenantId,runId}`; `POST /tasks/reference-search` accepts `{tenantId,searchId}`; `POST /tasks/maintenance` accepts `{}`. The tenant/job IDs locate durable work and do not confer scope: worker and final-release authorization still re-read PostgreSQL. Only a dedicated task/scheduler service account receives worker invocation permission.
