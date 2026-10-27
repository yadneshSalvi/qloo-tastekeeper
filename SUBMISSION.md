# TASTEKEEPER

**Thoughtful choices. Your terms.**

[Try TASTEKEEPER](https://tastekeeper-web-hqzgkrycbq-uc.a.run.app) · [Public source](https://github.com/yadneshSalvi/qloo-tastekeeper) · [Watch the three-minute film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app)

TASTEKEEPER is a recipient-owned preference gateway for independent agents and apps. A giver can receive a useful book suggestion without receiving the recipient's reference list. The recipient selects the context, references, client, purpose, duration, and request allowance, and approves the client’s fixed public fields and named catalog. Corrections affect future choices; revocation is checked again before a result or saved choice can be released.

## The demonstration

Mira is a fictional recipient in an isolated guest workspace. Alex is the fictional giver. Mira approves a limited connection to **The Reading Room**, which asks Qloo to rank a fixed five-book inventory. A bounded AI concierge inspects public inventory facts and prepares supported explanations. Its model context excludes Mira's private references, cultural identifiers, and profile.

Mira can correct the Gift context without silently changing her Personal context. The next authorized request uses the correction. She can then revoke the connection, after which the gateway denies future recommendation requests, result reads, and selections. Information already shown cannot be recalled, and recommendations themselves can reveal something about taste.

The same gateway serves two separately hosted clients: **Tonight**, for films, and **A Good Afternoon**, for London outings. Each has distinct server credentials, its own browser session, a named catalog, and its own constraints. This is a working integration boundary rather than three skins over a shared browser profile.

The owner can also search Qloo for a different cultural reference, inspect namesakes, and explicitly confirm an identity. Adding a reference creates a new context revision. Existing permissions retain their approved reference subset; a new reference requires a new invitation before a client may use it.

## Why Qloo matters

Qloo supplies cross-domain cultural affinity within each predeclared candidate pool. The application does not invent scores for missing results, blend scores from different calls, or substitute sample rankings after a live failure. Operator-reviewed mappings distinguish creators, editions, film years, and venue branches. Live identity search requires a human confirmation instead of automatically accepting the first result.

The production adapter makes one metered Insights request per decision, with no automatic retry. The official Qloo harness was used to verify identities and the candidate-restricted query contract. An independently selectable authored sample mode remains visibly labeled.

## Agent behavior and boundaries

The concierge performs two sequential function-tool steps over authorized public inventory facts. Deterministic code owns the candidate set, hard constraints, Qloo order, field projection, request allowances, permission revisions, and final release. The model cannot grant access, choose outside the catalog, or change the ranking.

A PostgreSQL worker records durable runs, idempotency keys, provider reservations, leases, and release receipts. Client sessions survive process restarts through an encrypted gateway-held credential and an opaque browser handle. Reauthorization checks current permission before renewal. Tenant isolation, revocation races, stale workers, and immutable evidence are covered by database tests.

## Design and intended impact

The product makes authorization understandable at the moment of a personal choice: a short invitation, an explicit review, a public-only result, and a visible way to correct or end the connection. Warm typography, original illustrations, separate client identities, keyboard-accessible dialogs, and responsive layouts support that flow.

The intended benefit is useful personalization with less unnecessary disclosure and clearer recipient control. No human preference, conversion, purchase, or privacy-outcome study is claimed. The working demo is guest role-play, not verified identity management or a production merchant marketplace.

## Evidence and limits

See [verification](docs/verification.md) for reproducible technical checks and [live observations](docs/live-observations.md) for measured provider calls. These are separate from authored examples and intended outcomes.

The hosted demonstration completed four live decisions on their first worker attempts, with two completed AI tool steps per decision. Request creation to first authorized release took 4.88–5.99 seconds in those four runs. A separate 26-case hosted suite passed across desktop and mobile; actual request, result-read, and selection attempts after revocation returned `403 GRANT_REVOKED` on all three clients. These technical results do not establish recipient preference or real-world conversion.

All catalog amounts are illustrative USD values. Publisher, studio, and venue links identify the public item; stock, prices, streaming rights, opening hours, admission, purchase, and booking are not verified. One book mapping is explicitly work-level rather than an exact edition match. Guest workspaces expire after 24 hours and are purged by maintenance; this is not durable account storage.

Source is licensed under [MIT](LICENSE). The repository excludes secrets, canonical provider mappings, raw provider responses, temporary invitation capabilities, and private planning material.
