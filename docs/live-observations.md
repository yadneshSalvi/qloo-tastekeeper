# Live provider observations

These measurements concern provider integration, separate from the authored sample profiles, inventory facts, authorization tests, and any preference-quality claim. Application walkthroughs are recorded separately as they are completed.

## Catalog verification — 27 October 2026 UTC

Twenty bounded searches through the installed official Qloo harness reviewed six reference identities and fourteen inventory identities. The previously reviewed 2014 identity of _The Grand Budapest Hotel_ was reused with its provenance; it did not incur another search. The reviewed inventory contains five books, five films and five London places.

Ambiguous results were resolved explicitly. The selected Agnes Martin is the painter born in 1912, represented as a **person**, rather than the novelist or other namesakes. Kew's gardens were selected rather than the restaurant or attractions inside them. The Marylebone branch of Daunt Books was distinguished from its other locations. Film years distinguish the original _Kiki's Delivery Service_ and the 2013 _The Secret Life of Walter Mitty_ from other versions.

Four book mappings match the reference catalog ISBN directly, including the hardcover of _A Psalm for the Wild-Built_ rather than the first ebook alternative. _The Art of Gathering_ is mapped at the **work** level: Qloo's reviewed record is hardcover ISBN 9781594634925, while the reference catalog identifies paperback ISBN 9781594634932. Cultural ranking of that work is not an exact-edition affinity, current price, stock, or purchase guarantee. Inventory prices remain explicitly illustrative; publisher, studio and venue links establish identity rather than availability.

## Candidate-restricted ranking

Four separate Insights requests used the predeclared five-item catalog for each target type. Each request supplied its complete comparable candidate pool in one call. Scores from different calls or types were not combined.

The fictional Gift context began with _Braiding Sweetgrass_, _Perfect Days_, and _A Man Called Ove_. The second book request removed only _Braiding Sweetgrass_, keeping the identical five-book pool:

| Position | Before removal           | After removal            |
| -------- | ------------------------ | ------------------------ |
| 1        | The Hidden Life of Trees | The Art of Gathering     |
| 2        | The Book of Delights     | The Hidden Life of Trees |
| 3        | The Art of Gathering     | The Book of Delights     |
| 4        | The Creative Act         | The Creative Act         |

Both book requests returned four of the five supplied candidates. Qloo did not return the mapped _A Psalm for the Wild-Built_ edition. No rank or score was invented for it. The changed first choice is an observed provider response, not a hard-coded application transition or evidence that a real recipient prefers the replacement.

The fictional Personal context used _Braiding Sweetgrass_, _Perfect Days_, and _Arrival_. Its film request returned all five supplied titles, in this order: _Paterson_, _Kiki's Delivery Service_, _Moonrise Kingdom_, _The Secret Life of Walter Mitty_, and _The Grand Budapest Hotel_.

Its place request returned three of five supplied locations: Tate Modern, Daunt Books Marylebone, and Royal Botanic Gardens, Kew. BFI Southbank and St Dunstan in the East were absent from this result. Partial coverage is preserved; absent candidates are not filled in using sample scores.

## Usage and interpretation

The initial verification consumed **24 observed Qloo HTTP requests: 20 catalog searches and four restricted rankings**. Every request returned HTTP 200, with observed fetch elapsed times between 1.332 and 1.949 seconds. Each probe process permitted one request, with a fixed timeout and no redirect or retry. Those timings are measurements of these checks, not a service-level guarantee.

No remaining-credit or rate-limit headers were provided. Application counters cannot reveal the hackathon credential's remaining balance. Credentials, canonical mappings and raw provider responses remain outside the public repository.

These provider checks establish identity coverage, candidate membership and observed ranking changes. They do not establish the completed hosted application flow, independent recipient preference, merchant partnerships, conversion, purchase, attendance or causal benefit. Those claims require separate evidence.

## Local application rehearsal

The first real book request used the fictional Gift context and the full five-book inventory. It released _The Hidden Life of Trees_, _The Book of Delights_, and _The Art of Gathering_. Saving the first choice persisted it in the independent client’s shortlist without purchasing anything.

The initial AI response failed an exact-quotation check. Qloo ordering was preserved and the UI explicitly reported the AI explanation unavailable. One bounded, public-only diagnostic run reproduced the mismatch: the model’s prose contained a short quotation while its evidence cited a longer span. The revised second tool selects exact inspected facts; deterministic code constructs the displayed rationale from validated spans. The model no longer supplies free-form explanation prose.

After the recipient explicitly removed _Braiding Sweetgrass_ from Gift, the next real request released _The Art of Gathering_, _The Hidden Life of Trees_, and _The Book of Delights_, preserving the same candidate pool. Its two model tool steps completed in 3.883 seconds, and the displayed facts passed validation. The owner’s Personal references remained unchanged. The client receipt recorded context revision 2, grant version 1, and the allowed public fields. This is an observed ranking change, not a preference study.

A separate owner search for Agnes Martin returned five matches. The UI distinguished the novelist from namesakes and the person born on 22 March 1912. Explicit confirmation added that identity to a separate “Studio Sundays” context at revision 2. No existing permission was widened.

A first film request exposed a response-size assumption: the legitimate five-film Qloo envelope was larger than the generic JSON reader’s 128 KiB cap. The request failed visibly, without an authored substitute or model call. Qloo ranking and search now use a bounded 1 MiB reader, with exact-limit, oversized-stream, cancellation, and deadline regressions; model responses retain the smaller limit. An explicit new film request then succeeded.

| Local application request           | Qloo returned / supplied | Public choices, in order                            | Model result                                           | Request to first authorized release |
| ----------------------------------- | ------------------------ | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| Gift before correction              | 4 / 5                    | Trees; Delights; Gathering                          | Initial quotation contract rejected; ranking preserved | 7.209 s                             |
| Gift after correction               | 4 / 5                    | Gathering; Trees; Delights                          | Two tool steps, three validated facts                  | 6.392 s                             |
| Personal films, after reader repair | 5 / 5                    | Paterson; Kiki’s Delivery Service; Moonrise Kingdom | Two tool steps, six validated facts                    | 7.099 s                             |
| Personal London places              | 3 / 5                    | Tate Modern; Daunt Books Marylebone; Kew Gardens    | Two tool steps, three validated facts                  | 7.086 s                             |

These elapsed times include local queue/polling and provider work. They are measured from persisted request creation to the earliest release receipt; later result reads create additional authorization receipts and are not counted as initial latency. No timing or recommendation-quality guarantee follows from four requests.

The independent clients saved Trees, Gathering, Paterson, and Tate Modern. Restarting the three client servers with the same server secrets restored the book session’s two saved selections and latest result, and the film session’s 150-minute/quiet-Sunday brief. This recovery did not require another provider call.

After the owner ended Alex’s book connection, a new request in the already-open client returned `GRANT_REVOKED`. The UI removed actionable results and explained the denied future access. The two Personal client connections remained active. Separate database/browser regressions cover revoked result reads and selection writes; the local visible action specifically tested a new request.

The complete local verification consumed **30 Qloo HTTP requests**: the initial 24 probes, five application decisions (including the visibly failed first film attempt), and one owner identity search. It consumed **10 OpenAI HTTP requests**: eight across the four application calls that reached the model, and two in the bounded public-only diagnostic. Every successful final-contract decision used one Qloo request and two model requests. The failed film request used no model calls; revocation and restored result reads caused no additional provider calls.

Hosted deployment and final browser evidence are recorded separately after release.
