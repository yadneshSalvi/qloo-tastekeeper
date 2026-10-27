# TASTEKEEPER v0.2.0 — demonstration film

This media release replaces the demonstration film with recorded application interactions. The hosted application remains the v0.1.0 implementation verified on **27 October 2026**; no owner, client, gateway, or worker service is redeployed.

| Item                        | Status or location                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Recipient workspace         | [Open TASTEKEEPER](https://tastekeeper-web-hqzgkrycbq-uc.a.run.app)                                           |
| Books client                | [The Reading Room](https://tastekeeper-books-hqzgkrycbq-uc.a.run.app)                                         |
| Films client                | [Tonight](https://tastekeeper-media-hqzgkrycbq-uc.a.run.app)                                                  |
| London outings client       | [A Good Afternoon](https://tastekeeper-places-hqzgkrycbq-uc.a.run.app)                                        |
| Application source revision | [`5382923`](https://github.com/yadneshSalvi/qloo-tastekeeper/commit/538292394974f676cda6f66e2b23e34946e284c8) |
| Application verification CI | [Run 40434671565 — passed](https://github.com/yadneshSalvi/qloo-tastekeeper/actions/runs/40434671565)         |
| Demonstration film          | [Watch the 3:33 film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app)                                       |

Start in the recipient workspace, create an isolated guest demo, and approve a connection before opening its client invitation. The recipient and giver are fictional roles; the four applications have separate HTTPS hosts and host-only browser cookies.

## What is included

TASTEKEEPER lets a recipient approve a bounded choice without giving the client their private reference list. An invitation names one context, selected references, a client and purpose, the client's catalog and public response fields, a duration, and a request allowance. The recipient reviews and explicitly approves that scope. The three reference clients choose books, films, and London outings; they are applications created by this project, not merchant or venue partnerships.

Qloo ranks only the approved, eligible, reviewed catalog candidates. A separate OpenAI Responses agent performs two function-tool steps over authorized public inventory facts and the submitted brief: inspect the inventory, then select exact supporting facts. Deterministic code preserves Qloo order and candidate membership and renders the explanation from validated facts. Private recipient references and canonical cultural identifiers do not enter the explanation model. Permitted cultural identifiers are sent to Qloo for ranking.

The recipient can preview and apply a correction to one context, inspect owner-only authorization receipts, or end a connection. New requests, result reads, and saved choices repeat current authorization; an earlier successful computation does not override revocation or a changed context. Saving a choice persists a shortlist item without buying or booking anything.

Owner identity search returns disambiguated alternatives for explicit confirmation. Adding a reference appends a context revision without broadening any existing permission. The curated starting collection contains six references and fifteen catalog items: five books, five films, and five places. An explicitly selected authored sample mode runs without provider keys and remains labelled separately from live results.

## Verified behavior

| Check                                          | Observed result                                            |
| ---------------------------------------------- | ---------------------------------------------------------- |
| CI unit/domain tests                           | **89 passed**                                              |
| CI real PostgreSQL tests                       | **27 passed**                                              |
| CI production browser tests                    | **24 passed**                                              |
| Independent hosted suite                       | **26 passed**, without retries, at 1440×1000 and 390×844   |
| Hosted post-revocation requests                | **18 denials**, all HTTP `403` with `GRANT_REVOKED`        |
| Keyless production build                       | Passed with `DATABASE_URL` explicitly empty                |
| TypeScript, ESLint, formatting                 | Passed                                                     |
| Production worker and database boundary checks | Passed with verified TLS and a restricted runtime identity |

CI used PostgreSQL 17.6, a separate test database, and the production gateway behind local HTTPS fronts. The independent hosted suite contained twelve actual application journeys using authored rankings, twelve intercepted provider/search states, and two HTTP health/origin/IAM checks. It made no authenticated provider calls. All sixteen disposable workspaces were deleted: fourteen by cleanup and two through the tested owner interface.

After owner revocation, each of the three hosted clients denied a new request, a read of an existing result, and a selection save at both viewport sizes. Those six client/viewport combinations produced the eighteen observed denials. The evidence records actual HTTP responses with identifiers omitted; it does not simulate the live demonstration interface.

The hosted 390px owner home had no horizontal overflow, console errors, or page errors, and no axe WCAG A/AA violations in that tested state. A targeted check of the corrected receipt notice passed contrast at both viewport sizes in all three client themes. These are scoped automated checks, not a comprehensive accessibility audit. See [verification scope and results](verification.md).

## Earlier observed live demonstration

The earlier application-verification walkthrough used fictional Mira and Alex. **All four live decisions completed on their first worker attempt**, each with one Qloo ranking request and two completed AI tool steps. No provider retry or authored replacement was used in these four decisions.

| Hosted request         | First released choice    | Qloo returned / supplied | Creation to first authorized release |
| ---------------------- | ------------------------ | ------------------------ | ------------------------------------ |
| Gift before correction | The Hidden Life of Trees | 4 / 5                    | 4.951 s                              |
| Personal films         | Paterson                 | 5 / 5                    | 4.932 s                              |
| Personal London places | Tate Modern              | 3 / 5                    | 4.883 s                              |
| Gift after correction  | The Art of Gathering     | 4 / 5                    | 5.987 s                              |

The recipient explicitly removed only _Braiding Sweetgrass_ from Gift after reviewing the correction. The next book request kept the same five-item inventory and brief; its first choice changed from _The Hidden Life of Trees_ to _The Art of Gathering_. Personal remained unchanged. Unreturned candidates were not filled in, and the observed change does not establish a recipient preference or improvement.

The walkthrough saved all four first choices. A separate live search returned five Agnes Martin namesakes; the owner explicitly confirmed the painter born in 1912 into Studio Sundays, creating revision 2 without widening existing grants. The owner then revoked Alex's book connection with one request still unused. A new request in the already-open client was denied with `GRANT_REVOKED`, while the two Personal connections remained active. The four application tabs reported zero console errors in that rehearsal.

The timings above run from persisted request creation to the earliest authorization receipt, including application and provider work. They are four individual observations, not browser repaint timings, provider benchmarks, percentiles, or service guarantees. [Live observations](live-observations.md) records provider usage, partial coverage, identity review, and the earlier local failures and repairs separately from this successful hosted walkthrough.

## Deployment and boundaries

The release runs in Google Cloud `us-central1`: a public Cloud Run owner/gateway service, three independent public client services, an IAM-protected worker, Cloud Tasks and Scheduler, and private Cloud SQL PostgreSQL 17. Provider credentials belong only to the worker. Web and worker receive private reviewed mappings and restricted database credentials; clients receive only their own client/session secrets and have no database credentials, provider credentials, or VPC attachment.

Database connections validate the unique instance CA with certificate-chain verification enabled. A separate migration identity applies schema changes. Hosted smoke checks accepted the configured CA, rejected an unrelated CA, verified forced tenant RLS, and confirmed that the runtime identity lacked database-administration access.

The gateway encrypts private contexts and captured inputs with AES-256-GCM. Durable rows hold idempotency, allowance reservations, fenced worker leases, append-only revisions, and authorization receipts. Client sessions retain their briefs, run membership, and saved selections across independent client restarts through a gateway-held encrypted credential and an opaque browser handle. Every renewal and release rechecks current permission.

Named tasks dispatch durable work to the private worker; scheduled maintenance recovers pending work and erases expired guest workspaces. SQL reservations bound actual provider attempts before each HTTP request. A live decision allows at most one Qloo request and two model requests; an owner search allows one Qloo request. Uncertain paid outcomes are not silently refunded or repeated. See [architecture](architecture.md), [API contracts](api.md), and [deployment instructions](../deploy/gcp/README.md).

## Scope and limitations

This is a 24-hour guest role-play, not verified recipient/giver identity, persistent account storage, or cross-device sign-in. Owners can explicitly delete a context or workspace; maintenance physically purges expired workspaces. Context deletion erases retained private reference revisions and captured run payloads, while minimal redacted security records remain until workspace expiry. Previously delivered results, screenshots, provider-side retention, and infrastructure backup retention cannot be recalled by application deletion. Recommendations can themselves reveal something about taste.

Catalog amounts are illustrative USD values. Publisher, studio, and venue links identify works and places; stock, current prices, streaming availability, opening hours, admission, purchases, and bookings are not verified. The _Art of Gathering_ mapping is at work level rather than an exact edition match. See [catalog sources and limitations](catalog-sources.md).

The technical tests and fictional live walkthrough are not a human preference, conversion, purchase, privacy-outcome, or production-scale study. Qloo affinity is not individual certainty. Provider operations can fail or reach configured limits; authored mode remains a separate explicit choice. Arbitrary retail inventory, autonomous purchases, verified accounts, and retroactive recall are outside this implementation.

Application code and original SVG/CSS artwork are [MIT licensed](../LICENSE). Self-hosted fonts and dependency assets retain their own documented licenses. These licenses do not grant rights to Qloo data or referenced third-party works. Secrets, canonical provider mappings, raw provider responses, temporary invitation capabilities, and private production artifacts remain outside the public repository.

## Demonstration film

The [3:33 public film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app) follows Alex choosing a book for Mira in a fictional demonstration. Mira approves a Gift context for The Reading Room, with a 24-hour limit and three requests. Alex types a brief, inspects the live result and its public source facts, and saves _The Hidden Life of Trees_. Mira then previews and applies removal of _Braiding Sweetgrass_ only from Gift; Personal is unchanged. The same brief and catalog produce _The Art of Gathering_ first on the second request. Both live rankings return four of five eligible options; unreturned items are not filled in. The film compares the client and owner receipts, then shows a real `GRANT_REVOKED` denial after Mira ends access with one request unused. This is an observed fictional demonstration, not evidence of human preference or improved outcomes.

Eight actual hosted browser recordings supply the picture. The application fills the frame from the beginning. Retained typing, clicks, scrolling, loading and dialog transitions play at their recorded pace; inactive tool waits and navigation gaps are trimmed. The cursor follows measured pointer positions. One slow focus on the correction dialog returns to the full application before Apply. There are no presentation slides, title bands, or burned-in captions.

The final MP4 is **212.800 seconds**, **1920×1080**, **30 fps**, with H.264 video and stereo AAC audio at 48 kHz. All **6,384 frames** and the complete audio stream decoded without errors. Visual review covered the editable browser preview and **109 decoded frames**, including cut boundaries, the correction focus, result states and the ending. The **85 optional English caption cues** stay within the film without overlap. The last cue ends at 210.940 seconds, leaving 1.860 seconds for the music to resolve. Native captions are off by default.

The 455-word narration uses `gemini-3.1-flash-tts-preview` with Kore. Four cohesive acts retain the approved story, and Deepgram supplied actual word timings. Quiet gaps were trimmed without changing speech speed. The instrumental score was generated with Lyria; five understated clicks correspond to recorded actions. The final encoded mix measured **−14.03 LUFS integrated** and **−1.14 dBTP**. A full encoded-audio model audition passed intelligibility, continuity, pronunciation, music and ending checks; this was a model opinion, not human listening. Picture review and measured action alignment provide the separate visual evidence.

| Published asset |      Bytes | SHA-256                                                            |
| --------------- | ---------: | ------------------------------------------------------------------ |
| MP4             | 86,732,845 | `d3c333ddb08abdefc9b621070a7d83cd081fa64c817c95ce21bd61a2a771a6ce` |
| JPEG poster     |    118,714 | `af2fadfe09913d9e8f987a58b0e9440a4c42e1199c8605fa0fdc30435a0a84ca` |
| WebVTT captions |      9,502 | `4d3075f321bbe596a521bec3a80aae2715914197d64b98bb4f6386ea473ba68c` |

The separate `tastekeeper-demo` service runs revision `tastekeeper-demo-00002-62t`, built by `34c300a8-cdf7-4b09-b05e-9ee0beba1c56` from immutable image digest `sha256:58603e1798701a1a60b71b97173b0c3ca2b26c48c79fa34d1b94c928e7508c74`. It uses the dedicated roleless `tastekeeper-film` identity, no secrets, database, mounted volumes or VPC, and minimum zero / maximum one instance. The HTTP/2 connection to Nginx supports the full interaction recording. The build context contained exactly eight allowlisted files, with a bounded 128 MiB MP4 limit. All five application service definitions and ready revisions remained unchanged.

Eleven anonymous HTTP checks passed. Page and health requests returned 200. All three complete served assets matched the hashes above, with correct MIME types. Video HEAD returned the exact size; first and last byte ranges returned 206 with correct `Content-Range`, and an unsatisfiable range returned 416. Private capture and audio paths returned 404.

The public native player loaded the 212.800-second, 1920×1080 film at normal speed with captions initially disabled. Playback advanced from 0 to 7 seconds. Seeking to 119.55 seconds loaded the correct correction dialog; subsequent playback from 124.11 through 146 seconds displayed optional English captions. Seeking to 194.07 seconds showed the actual `GRANT_REVOKED` denial at ready state 4 with no media error. Reloading restored the paused opening with captions disabled.

The media workflow also validates shell and Python syntax and the pinned Nginx configuration in CI. The v0.2.0 release notes link the verification run for the published source revision.

The private editable project, raw captures, production transcripts, earlier attempts and history are not uploaded. See the [static hosting instructions](../deploy/gcp/media/README.md).
