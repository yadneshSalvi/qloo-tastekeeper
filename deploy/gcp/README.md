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

`deploy.sh` applies the private request-URL exclusion before exposing the services, deploys worker and Scheduler first, deploys web and three clients, then resolves their canonical service URLs and updates all cross-service origin settings. Owner and each client use distinct HTTPS browser hosts. The web service has one minimum and two maximum instances; each client has zero minimum and one maximum instance. Clients have no database credentials, provider credentials, or VPC attachment.

The private worker requires Cloud Run IAM and permits only `tastekeeper-invoker` to invoke it. It has zero minimum and one maximum instance, one concurrent request, and a 240-second timeout. Web enqueues named OIDC tasks for decisions and reference searches; no provider keys are present on web. Queue dispatch rate and concurrency are one, with three attempts. Scheduler invokes `/tasks/maintenance` every minute with an OIDC audience equal to the worker's base origin, supporting recovery and expired demo erasure.

The worker explicitly sets daily Qloo limits of 120 global, 8 per tenant, and 6 searches per tenant; OpenAI limits are 240 global and 16 per tenant. A decision permits at most one Qloo request and two model requests. Reservations happen before dispatch; uncertain provider outcomes are not refunded. These caps do not cover infrastructure costs. Delete or scale down resources explicitly when a demo ends; SQL deletion protection requires a separate deliberate change.

The logging exclusion omits private gateway/client request paths and query-bearing URLs from the default request-log sink, while preserving unrelated exclusions and sinks. Invitation possession tokens use URL fragments and must never be copied into deployment output or logs. Never use provider requests as deployment probes.
