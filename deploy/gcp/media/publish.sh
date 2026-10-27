#!/usr/bin/env bash
set -euo pipefail
# Invoke only after the final staged media and publication have been approved.
: "${TASTEKEEPER_MEDIA_BUILD_DIR:?Set TASTEKEEPER_MEDIA_BUILD_DIR to the exact prepared build directory}"
: "${TASTEKEEPER_MEDIA_IMAGE:?Set TASTEKEEPER_MEDIA_IMAGE to a unique Artifact Registry release tag}"
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
: "${TASTEKEEPER_REGION:=us-central1}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-"$script_dir/../gcloud.sh"}
media_sa="tastekeeper-film@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com"
python3 - "$TASTEKEEPER_MEDIA_BUILD_DIR" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve(strict=True)
expected={'.gcloudignore','Dockerfile','TASTEKEEPER-demo.mp4','captions.vtt','cloudbuild.yaml','index.html','nginx.conf','poster'}
if {p.name for p in root.iterdir()} != expected or not all(p.is_file() and not p.is_symlink() for p in root.iterdir()):
    raise SystemExit('The media build directory must contain exactly the eight prepared regular files.')
if '__TASTEKEEPER_' in (root/'index.html').read_text():
    raise SystemExit('Fill the verified public application/source links before publishing.')
PY
# This identity must have no project roles or access to application secrets.
policy=$("$gc" projects get-iam-policy "$TASTEKEEPER_GCP_PROJECT" --format=json)
python3 -c 'import json,sys; p=json.load(sys.stdin); member="serviceAccount:"+sys.argv[1]; assert not any(member in b.get("members",[]) for b in p.get("bindings",[])), "The dedicated media account must have no project roles."' "$media_sa" <<<"$policy"
"$gc" builds submit "$TASTEKEEPER_MEDIA_BUILD_DIR" --config="$script_dir/cloudbuild.yaml" \
  --service-account="projects/$TASTEKEEPER_GCP_PROJECT/serviceAccounts/tastekeeper-build@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com" \
  --substitutions="_IMAGE=$TASTEKEEPER_MEDIA_IMAGE" --quiet
digest=$("$gc" artifacts docker images describe "$TASTEKEEPER_MEDIA_IMAGE" --format='value(image_summary.digest)')
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { printf '%s\n' 'An immutable image digest is required.' >&2; exit 1; }
image="${TASTEKEEPER_MEDIA_IMAGE%:*}@$digest"
"$gc" run deploy tastekeeper-demo --region="$TASTEKEEPER_REGION" --image="$image" \
  --service-account="$media_sa" --port=8080 --cpu=1 --memory=512Mi \
  --cpu-throttling --execution-environment=gen2 --min=0 --min-instances=0 \
  --max=1 --max-instances=1 --concurrency=40 --timeout=300 \
  --clear-network --clear-vpc-connector --clear-env-vars --clear-secrets \
  --no-invoker-iam-check --quiet
"$gc" run services describe tastekeeper-demo --region="$TASTEKEEPER_REGION" --format='value(status.url)'
