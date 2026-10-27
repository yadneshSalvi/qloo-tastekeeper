#!/usr/bin/env bash
set -euo pipefail
: "${TASTEKEEPER_IMAGE:?Set TASTEKEEPER_IMAGE to a unique Artifact Registry release tag}"
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-./deploy/gcp/gcloud.sh}
"$gc" builds submit . --config=deploy/gcp/cloudbuild.yaml \
  --service-account="projects/$TASTEKEEPER_GCP_PROJECT/serviceAccounts/tastekeeper-build@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com" \
  --substitutions="_IMAGE=$TASTEKEEPER_IMAGE" --quiet
