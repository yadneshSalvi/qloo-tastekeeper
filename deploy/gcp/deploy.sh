#!/usr/bin/env bash
set -euo pipefail
# Run from TASTEKEEPER after release freeze, migration, grants, and runtime verification.
: "${TASTEKEEPER_IMAGE:?Set TASTEKEEPER_IMAGE to the immutable release image}"
: "${TASTEKEEPER_GCP_PROJECT:=tastekeeper-choice-20261027}"
: "${TASTEKEEPER_GCP_PROJECT_NUMBER:=407087788778}"
: "${TASTEKEEPER_REGION:=us-central1}"
: "${TASTEKEEPER_DB_SECRET_VERSION:?Set runtime database secret version}"
: "${TASTEKEEPER_CA_SECRET_VERSION:?Set database CA secret version}"
: "${TASTEKEEPER_CONTEXT_SECRET_VERSION:?Set context encryption secret version}"
: "${TASTEKEEPER_QLOO_SECRET_VERSION:?Set Qloo secret version}"
: "${TASTEKEEPER_OPENAI_SECRET_VERSION:?Set OpenAI secret version}"
: "${TASTEKEEPER_MAPPINGS_SECRET_VERSION:?Set reviewed mapping secret version}"
: "${TASTEKEEPER_BOOKS_CLIENT_SECRET_VERSION:?Set books client secret version}"
: "${TASTEKEEPER_BOOKS_SESSION_SECRET_VERSION:?Set books session secret version}"
: "${TASTEKEEPER_MEDIA_CLIENT_SECRET_VERSION:?Set media client secret version}"
: "${TASTEKEEPER_MEDIA_SESSION_SECRET_VERSION:?Set media session secret version}"
: "${TASTEKEEPER_PLACES_CLIENT_SECRET_VERSION:?Set places client secret version}"
: "${TASTEKEEPER_PLACES_SESSION_SECRET_VERSION:?Set places session secret version}"
[[ "$TASTEKEEPER_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Use an immutable image digest.' >&2; exit 1; }
for name in ${!TASTEKEEPER_@}; do
  if [[ "$name" == *_SECRET_VERSION ]]; then
    [[ "${!name}" =~ ^[1-9][0-9]*$ ]] || { echo "Use a numeric secret version for $name." >&2; exit 1; }
  fi
done
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-./deploy/gcp/gcloud.sh}
worker_sa="tastekeeper-worker@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com"
web_sa="tastekeeper-web@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com"
invoker_sa="tastekeeper-invoker@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com"
db_secrets="DATABASE_URL=tastekeeper-database-url:$TASTEKEEPER_DB_SECRET_VERSION,/secrets/sql-ca.pem=tastekeeper-sql-ca:$TASTEKEEPER_CA_SECRET_VERSION,CONTEXT_ENCRYPTION_KEY=tastekeeper-context-key:$TASTEKEEPER_CONTEXT_SECRET_VERSION,/cultural/mappings.json=tastekeeper-qloo-mappings:$TASTEKEEPER_MAPPINGS_SECRET_VERSION"
./deploy/gcp/configure-logging.sh
common=(--image="$TASTEKEEPER_IMAGE" --region="$TASTEKEEPER_REGION" --cpu=1 --cpu-throttling --execution-environment=gen2 --min-instances=0 --quiet)
private_network=(--network=tastekeeper-private --subnet=tastekeeper-run --vpc-egress=private-ranges-only)
"$gc" run deploy tastekeeper-worker "${common[@]}" "${private_network[@]}" \
  --service-account="$worker_sa" --memory=1Gi --min=0 --max=1 --max-instances=1 --concurrency=1 --timeout=240 \
  --startup-probe=httpGet.path=/health,httpGet.port=8080,timeoutSeconds=5,periodSeconds=10,failureThreshold=24 \
  --invoker-iam-check --no-allow-unauthenticated --command=node --args=--import,tsx,scripts/worker-http.ts \
  --set-env-vars=DATABASE_TLS_IDENTITY=instance-ca,DATABASE_CA_FILE=/secrets/sql-ca.pem,QLOO_MAPPINGS_FILE=/cultural/mappings.json,QLOO_ENABLED=true,AGENT_ENABLED=true,QLOO_TRANSPORT=insights,MODEL_ID=gpt-6.1-sol,WORKER_AUTH_MODE=cloud-run-iam,QLOO_GLOBAL_DAILY_LIMIT=120,QLOO_TENANT_DAILY_LIMIT=8,QLOO_SEARCH_TENANT_DAILY_LIMIT=6,OPENAI_GLOBAL_DAILY_LIMIT=240,OPENAI_TENANT_DAILY_LIMIT=16 \
  --set-secrets="$db_secrets,QLOO_API_KEY=tastekeeper-qloo-api-key:$TASTEKEEPER_QLOO_SECRET_VERSION,OPENAI_API_KEY=tastekeeper-openai-api-key:$TASTEKEEPER_OPENAI_SECRET_VERSION"
"$gc" run services add-iam-policy-binding tastekeeper-worker --region="$TASTEKEEPER_REGION" --member="serviceAccount:$invoker_sa" --role=roles/run.invoker --quiet
worker_url=$("$gc" run services describe tastekeeper-worker --region="$TASTEKEEPER_REGION" --format='value(status.url)')
./deploy/gcp/scheduler.sh
# Stable Cloud Run service aliases are valid during initial creation. Replace them
# with each service's canonical status.url before performing browser acceptance.
books_url="https://tastekeeper-books-$TASTEKEEPER_GCP_PROJECT_NUMBER.$TASTEKEEPER_REGION.run.app"
media_url="https://tastekeeper-media-$TASTEKEEPER_GCP_PROJECT_NUMBER.$TASTEKEEPER_REGION.run.app"
places_url="https://tastekeeper-places-$TASTEKEEPER_GCP_PROJECT_NUMBER.$TASTEKEEPER_REGION.run.app"
"$gc" run deploy tastekeeper-web "${common[@]}" "${private_network[@]}" \
  --service-account="$web_sa" --memory=512Mi --min=1 --max=2 --max-instances=2 --concurrency=20 --timeout=60 \
  --startup-probe=tcpSocket.port=8080,timeoutSeconds=1,periodSeconds=10,failureThreshold=24 \
  --no-invoker-iam-check --command=node --args=node_modules/next/dist/bin/next,start,--hostname,0.0.0.0 \
  --set-secrets="$db_secrets,CLIENT_BOOKS_SECRET=tastekeeper-books-client-secret:$TASTEKEEPER_BOOKS_CLIENT_SECRET_VERSION,CLIENT_MEDIA_SECRET=tastekeeper-media-client-secret:$TASTEKEEPER_MEDIA_CLIENT_SECRET_VERSION,CLIENT_PLACES_SECRET=tastekeeper-places-client-secret:$TASTEKEEPER_PLACES_CLIENT_SECRET_VERSION" \
  --set-env-vars="DATABASE_TLS_IDENTITY=instance-ca,DATABASE_CA_FILE=/secrets/sql-ca.pem,QLOO_MAPPINGS_FILE=/cultural/mappings.json,QLOO_ENABLED=true,AGENT_ENABLED=true,DEMO_ENABLED=true,GOOGLE_CLOUD_PROJECT=$TASTEKEEPER_GCP_PROJECT,CLOUD_TASKS_LOCATION=$TASTEKEEPER_REGION,CLOUD_TASKS_QUEUE=tastekeeper-decisions,WORKER_ORIGIN=$worker_url,WORKER_INVOKER_SERVICE_ACCOUNT=$invoker_sa,CLIENT_BOOKS_ORIGIN=$books_url,CLIENT_MEDIA_ORIGIN=$media_url,CLIENT_PLACES_ORIGIN=$places_url"
web_url=$("$gc" run services describe tastekeeper-web --region="$TASTEKEEPER_REGION" --format='value(status.url)')
for client in books media places; do
  case "$client" in books) upper=BOOKS ;; media) upper=MEDIA ;; places) upper=PLACES ;; esac
  client_version_name="TASTEKEEPER_${upper}_CLIENT_SECRET_VERSION"
  session_version_name="TASTEKEEPER_${upper}_SESSION_SECRET_VERSION"
  client_url="https://tastekeeper-$client-$TASTEKEEPER_GCP_PROJECT_NUMBER.$TASTEKEEPER_REGION.run.app"
  "$gc" run deploy "tastekeeper-$client" "${common[@]}" --clear-network \
    --service-account="tastekeeper-$client@$TASTEKEEPER_GCP_PROJECT.iam.gserviceaccount.com" \
    --memory=512Mi --min=0 --max=1 --max-instances=1 --concurrency=20 --timeout=60 \
    --startup-probe=httpGet.path=/health,httpGet.port=8080,timeoutSeconds=5,periodSeconds=10,failureThreshold=24 \
    --no-invoker-iam-check --command=node --args=--import,tsx,clients/server.ts \
    --set-env-vars="CLIENT_ID=$client,CLIENT_HOST=0.0.0.0,PUBLIC_ORIGIN=$client_url,GATEWAY_ORIGIN=$web_url,OWNER_ORIGIN=$web_url" \
    --set-secrets="CLIENT_SECRET=tastekeeper-$client-client-secret:${!client_version_name},SESSION_SECRET=tastekeeper-$client-session-secret:${!session_version_name}"
  client_url=$("$gc" run services describe "tastekeeper-$client" --region="$TASTEKEEPER_REGION" --format='value(status.url)')
  "$gc" run services update "tastekeeper-$client" --region="$TASTEKEEPER_REGION" --update-env-vars="PUBLIC_ORIGIN=$client_url" --quiet
  printf -v "${client}_url" '%s' "$client_url"
done
"$gc" run services update tastekeeper-web --region="$TASTEKEEPER_REGION" --update-env-vars="APP_ORIGIN=$web_url,CLIENT_BOOKS_ORIGIN=$books_url,CLIENT_MEDIA_ORIGIN=$media_url,CLIENT_PLACES_ORIGIN=$places_url" --quiet
printf 'Owner: %s\nBooks: %s\nTonight: %s\nWeekends: %s\n' "$web_url" "$books_url" "$media_url" "$places_url"
