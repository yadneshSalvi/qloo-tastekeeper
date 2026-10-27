#!/usr/bin/env bash
set -euo pipefail
: "${TASTEKEEPER_IMAGE:?Set TASTEKEEPER_IMAGE to the immutable release image}"
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
: "${TASTEKEEPER_REGION:=us-central1}"
: "${TASTEKEEPER_DB_SECRET_VERSION:?Set the runtime database secret version}"
: "${TASTEKEEPER_CA_SECRET_VERSION:?Set the database CA secret version}"
[[ "$TASTEKEEPER_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Use an immutable image digest.' >&2; exit 1; }
[[ "$TASTEKEEPER_DB_SECRET_VERSION" =~ ^[1-9][0-9]*$ ]] || { echo 'Use a numeric secret version for TASTEKEEPER_DB_SECRET_VERSION.' >&2; exit 1; }
[[ "$TASTEKEEPER_CA_SECRET_VERSION" =~ ^[1-9][0-9]*$ ]] || { echo 'Use a numeric secret version for TASTEKEEPER_CA_SECRET_VERSION.' >&2; exit 1; }
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-./deploy/gcp/gcloud.sh}
"$gc" run jobs deploy tastekeeper-runtime-smoke --region="$TASTEKEEPER_REGION" --image="$TASTEKEEPER_IMAGE" \
  --service-account="tastekeeper-worker@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com" \
  --network=tastekeeper-private --subnet=tastekeeper-run --vpc-egress=private-ranges-only \
  --cpu=1 --memory=512Mi --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=120s \
  --command=node --args=--import,tsx,deploy/gcp/verify-runtime.mjs \
  --set-env-vars=DATABASE_TLS_IDENTITY=instance-ca,DATABASE_CA_FILE=/secrets/sql-ca.pem \
  --set-secrets="DATABASE_URL=tastekeeper-database-url:$TASTEKEEPER_DB_SECRET_VERSION,/secrets/sql-ca.pem=tastekeeper-sql-ca:$TASTEKEEPER_CA_SECRET_VERSION" --quiet
"$gc" run jobs execute tastekeeper-runtime-smoke --region="$TASTEKEEPER_REGION" --wait --quiet
"$gc" run jobs delete tastekeeper-runtime-smoke --region="$TASTEKEEPER_REGION" --quiet
