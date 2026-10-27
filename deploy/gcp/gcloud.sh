#!/usr/bin/env bash
set -euo pipefail
: "${GCLOUD_BIN:=gcloud}"
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
: "${TASTEKEEPER_GCP_ACCOUNT:?Set TASTEKEEPER_GCP_ACCOUNT to the authorized Google Cloud account}"
exec "$GCLOUD_BIN" --account="$TASTEKEEPER_GCP_ACCOUNT" --project="$TASTEKEEPER_GCP_PROJECT" --billing-project="$TASTEKEEPER_GCP_PROJECT" "$@"
