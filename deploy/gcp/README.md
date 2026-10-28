# TASTEKEEPER on Google Cloud

Run these scripts from the `tastekeeper` directory. Select the authorized account explicitly with `TASTEKEEPER_GCP_ACCOUNT`. Set `GCLOUD_BIN` and `CLOUDSDK_CONFIG` for an isolated CLI installation/configuration if required. `TASTEKEEPER_GCLOUD_WRAPPER` may instead name an absolute path to a private account/project wrapper.

The deployment uses project `tastekeeper-choice-20261027`, region `us-central1`, VPC `tastekeeper-private`, subnet `tastekeeper-run`, private PostgreSQL 17 instance `tastekeeper-db`, database `tastekeeper`, Artifact Registry repository `tastekeeper-images`, and Cloud Tasks queue `tastekeeper-decisions`. The SQL instance has no public IP and uses its own Google managed internal CA. Database jobs, web, and worker mount that exact CA and select `DATABASE_TLS_IDENTITY=instance-ca`: certificate verification stays enabled, and the unique pinned instance CA supplies database identity for the private IP connection. Other deployments default to full hostname verification. The cloud smoke check requires a successful pinned-CA connection and rejection of an unrelated CA.

Use separate migration and runtime SQL credentials. The migration service account alone receives `tastekeeper-migration-database-url`; its jobs set `DATABASE_MIGRATION_URL`, never the runtime variable. The runtime SQL login `tastekeeper_app` belongs only to `tastekeeper_runtime`. It has no administrative, inventory-role, schema-creation, or migration-ledger access. The inventory role is a separate `NOLOGIN NOBYPASSRLS` owner for narrow maintenance functions. The runtime smoke verifies explicit table grants, append-only provider-attempt grants, forced tenant RLS, and empty unscoped context reads.

Secret Manager access is scoped per secret:

| Secret                                                   | Service accounts                 |
| -------------------------------------------------------- | -------------------------------- |
| `tastekeeper-database-url`                               | web, worker                      |
| `tastekeeper-migration-database-url`                     | migrator                         |
| `tastekeeper-sql-ca`                                     | web, worker, migrator            |
| `tastekeeper-context-key`, `tastekeeper-qloo-mappings`   | web, worker                      |
| `tastekeeper-qloo-api-key`, `tastekeeper-openai-api-key` | worker                           |
| `tastekeeper-{books,media,places}-client-secret`         | web and the corresponding client |
| `tastekeeper-{books,media,places}-session-secret`        | corresponding client only        |

All service account names have the `tastekeeper-` prefix. The `tastekeeper-media` account runs the Tonight client; film hosting must use a separate roleless account. Provider credentials, encryption keys, client credentials, reviewed canonical IDs, and runtime secret values must remain outside source, images, build contexts, logs, and browser bundles. Mount the CA at `/secrets/sql-ca.pem` and reviewed mappings at `/cultural/mappings.json`; Cloud Run mounts separate secret files in separate directories.

After local tests and the actual-provider flow are approved for release:

1. Set `TASTEKEEPER_IMAGE` to a unique release tag under `us-central1-docker.pkg.dev/tastekeeper-choice-20261027/tastekeeper-images/app` and run `./deploy/gcp/build.sh`. Builds receive no runtime credentials. Resolve the resulting immutable digest and use it for subsequent steps.
2. Set numeric `TASTEKEEPER_MIGRATION_SECRET_VERSION`, `TASTEKEEPER_DB_SECRET_VERSION`, and `TASTEKEEPER_CA_SECRET_VERSION`. Run `migrate.sh`, `grant-runtime.sh`, and `verify-runtime.sh` in that order.
3. Set numeric versions for `TASTEKEEPER_CONTEXT_SECRET_VERSION`, `TASTEKEEPER_QLOO_SECRET_VERSION`, `TASTEKEEPER_OPENAI_SECRET_VERSION`, `TASTEKEEPER_MAPPINGS_SECRET_VERSION`, and the six `TASTEKEEPER_{BOOKS,MEDIA,PLACES}_{CLIENT,SESSION}_SECRET_VERSION` variables. Run `deploy.sh` with the immutable image digest.
4. Verify owner `/api/health` and each client `/health`, authenticated worker `/health`, anonymous worker rejection, and automatic Scheduler maintenance. Perform the released browser journey, including independent client hosts, server authorization after revocation, and actual Cloud Tasks dispatch. Health checks do not call providers.

`deploy.sh` applies the private request-URL exclusion before exposing the services, deploys worker and Scheduler first, deploys web and three clients, then resolves their canonical service URLs and updates all cross-service origin settings. Owner and each client use distinct HTTPS browser hosts. The web service defaults to zero minimum and two maximum instances; each client has zero minimum and one maximum instance. Clients have no database credentials, provider credentials, or VPC attachment.

The private worker requires Cloud Run IAM and permits only `tastekeeper-invoker` to invoke it. It has zero minimum and one maximum instance, one concurrent request, and a 240-second timeout. Web enqueues named OIDC tasks for decisions and reference searches; no provider keys are present on web. Queue dispatch rate and concurrency are one, with three attempts. Scheduler invokes `/tasks/maintenance` every minute with an OIDC audience equal to the worker's base origin, supporting recovery and expired demo erasure.

The worker explicitly sets daily Qloo limits of 120 global, 8 per tenant, and 6 searches per tenant; OpenAI limits are 240 global and 16 per tenant. A decision permits at most one Qloo request and two model requests. Reservations happen before dispatch; uncertain provider outcomes are not refunded. These caps do not cover infrastructure costs. Delete or scale down resources explicitly when a demo ends; SQL deletion protection requires a separate deliberate change.

The logging exclusion omits private gateway/client request paths and query-bearing URLs from the default request-log sink, while preserving unrelated exclusions and sinks. Invitation possession tokens use URL fragments and must never be copied into deployment output or logs. Never use provider requests as deployment probes.

## Cost and scale-to-zero

The deployment script sets both service-level and revision-level minimum instances to zero for web, worker, and clients and retains request-based CPU billing. After idle instances are removed, the next visit or worker request can incur a cold start. On 28 October 2026, the live web service minimum was changed to zero without
changing its application revision, revision specification, or traffic assignment.
The deployment script preserves this setting for future releases.

Scale-to-zero removes the configured warm-instance baseline, not all costs. Provisioned Cloud SQL compute, database storage, and retained backups continue to incur charges. Active Cloud Run requests (including recovery requests), Tasks, Scheduler, Secret Manager, builds, artifact/media storage, logs, and network traffic add usage charges; provider API billing is separate. Actual charges depend on usage, retention, applicable free tiers and discounts. Instance and provider limits are not a hard spending cap. See [Cloud Run pricing](https://cloud.google.com/run/pricing) and [Cloud SQL pricing](https://cloud.google.com/sql/pricing).

Pricing examples checked 28 October 2026, conditional on the stated sizing rather
than a verified live configuration or current bill: at 730 hours, a warm 1-vCPU,
512-MiB web instance costs about US$9.86/month at idle CPU and memory rates of
US$0.0000025 per vCPU-second and GiB-second respectively, before shared free tiers
and discounts. Minimum zero removes that warm-instance baseline, not all charges.
An Iowa non-HA `db-f1-micro` at US$0.0105/hour plus 10 GiB SSD at
US$0.000232877/GiB-hour costs about US$9.37/month for compute and disk
(`730 × 0.0105 + 10 × 730 × 0.000232877`), excluding backups, other services,
provider usage, tax and discounts. See [Cloud Run rates](https://cloud.google.com/run/pricing)
and [Cloud SQL rates](https://cloud.google.com/sql/pricing).
