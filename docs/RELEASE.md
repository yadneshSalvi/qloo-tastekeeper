# TASTEKEEPER v0.1.0

The hosted application was verified on **27 October 2026**. The demonstration film was published separately after source, caption, decoded-frame, and audio checks.

| Item                        | Status or location                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Recipient workspace         | [Open TASTEKEEPER](https://tastekeeper-web-hqzgkrycbq-uc.a.run.app)                                           |
| Books client                | [The Reading Room](https://tastekeeper-books-hqzgkrycbq-uc.a.run.app)                                         |
| Films client                | [Tonight](https://tastekeeper-media-hqzgkrycbq-uc.a.run.app)                                                  |
| London outings client       | [A Good Afternoon](https://tastekeeper-places-hqzgkrycbq-uc.a.run.app)                                        |
| CI-verified source revision | [`5382923`](https://github.com/yadneshSalvi/qloo-tastekeeper/commit/538292394974f676cda6f66e2b23e34946e284c8) |
| GitHub CI                   | [Run 40434671565 — passed](https://github.com/yadneshSalvi/qloo-tastekeeper/actions/runs/40434671565)         |
| Demonstration film          | [Watch the three-minute film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app)                               |

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

## Observed live demonstration

A separate hosted walkthrough used fictional Mira and Alex. **All four live decisions completed on their first worker attempt**, each with one Qloo ranking request and two completed AI tool steps. No provider retry or authored replacement was used in these four decisions.

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

The [public film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app) follows the actual hosted fictional demonstration: explicit identity confirmation, scoped permission, live choices in three independent clients, a Gift-only correction, an owner receipt and a separately labelled public outing receipt, and denial after revocation. A separate technical-verification scene reports actual hosted HTTP denials from authored-sample test workspaces; it is not presented as the same live-provider walkthrough.

The final MP4 is **180 seconds**, **1920×1080**, **30 fps**, with H.264 video and stereo AAC audio at 48 kHz. Its 5,400 frames and complete audio track decoded without errors. Review covered the editable browser preview and 96 decoded evidence frames, including scene boundaries; no blank evidence frames were found. All 68 caption groups stay within the film without overlap. The last caption ends at 177.98 seconds, leaving a 2.02-second closing hold.

Narration uses the requested `gemini-3.1-flash-tts-preview` model and Kore voice. Four generated blocks retain the approved script. Deepgram supplied word timings in one full transcription plus one 7.5-second English excerpt that recovered the word “fifth”; no speech was regenerated for that correction and no word timing was invented. The score and restrained action sounds are original local synthesis. Encoded audio measured −15.77 LUFS integrated, −2.64 dBTP, and zero clipped samples. Audio was measured and transcript-checked, not independently listened to by a human reviewer.

| Published asset | Bytes     | SHA-256                                                            |
| --------------- | --------- | ------------------------------------------------------------------ |
| MP4             | 9,856,307 | `fde5672e371f72fe2e5317625967944318f67608b4b02acff15ff2671f771b29` |
| JPEG poster     | 86,023    | `88300080057487e0e91c3f7a045699fdfcf5dc672125736661dd529f81217af4` |
| WebVTT captions | 4,525     | `3ceaa3f7ca1778d8cb80af34f3ed9fa3a3b3935486b0757bb7ae640908675b53` |

The separate `tastekeeper-demo` service runs revision `tastekeeper-demo-00001-7x4`, built by `265f41cd-5fa9-483c-94cd-c4387a40282c` from immutable image digest `sha256:2f64c88520a55a67e804ee085a52ccc87bbbc1cd7fa39ebf7dd186c77f99985f`. It uses the dedicated roleless `tastekeeper-film` identity, no secrets, database, mounted volumes or VPC, and minimum zero / maximum one instance. The build context contained exactly eight allowlisted files. All five application service definitions and ready revisions remained unchanged.

Anonymous page and health requests returned HTTP 200. All three complete served assets matched the hashes above, with correct MIME types. Video HEAD returned the exact size and a bytes 0–1023 request returned HTTP 206 with the correct `Content-Range`. A fresh browser played the film from the beginning, sought to approximately 110.58 and 125.90 seconds, and displayed the optional native English captions. Playback reported ready state 4 with no media error and zero console errors. Captions were returned to their default off state because the film also includes embedded captions. The private editable project, raw captures, production transcripts and archive were not uploaded. See the [static hosting instructions](../deploy/gcp/media/README.md).
