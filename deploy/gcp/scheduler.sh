#!/usr/bin/env bash
set -euo pipefail
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
: "${TASTEKEEPER_REGION:=us-central1}"
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-./deploy/gcp/gcloud.sh}
worker_url=$("$gc" run services describe tastekeeper-worker --region="$TASTEKEEPER_REGION" --format='value(status.url)')
if "$gc" scheduler jobs describe tastekeeper-worker-recovery --location="$TASTEKEEPER_REGION" --format='value(name)' >/dev/null 2>&1; then
  mode=update; headers=(--update-headers=Content-Type=application/json)
else
  mode=create; headers=(--headers=Content-Type=application/json)
fi
"$gc" scheduler jobs "$mode" http tastekeeper-worker-recovery --location="$TASTEKEEPER_REGION" \
  --schedule='* * * * *' --time-zone=Etc/UTC --uri="$worker_url/tasks/maintenance" --http-method=POST \
  "${headers[@]}" --message-body='{}' \
  --oidc-service-account-email="tastekeeper-invoker@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com" \
  --oidc-token-audience="$worker_url" --attempt-deadline=240s \
  --max-retry-attempts=1 --min-backoff=30s --max-backoff=300s --quiet
