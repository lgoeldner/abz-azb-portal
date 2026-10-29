#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
MOCK_BIN="$WORK/bin"
CALL_LOG="$WORK/calls.log"
mkdir -p "$MOCK_BIN"

cat >"$MOCK_BIN/gcloud" <<'MOCK_GCLOUD'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'gcloud %s\n' "$*" >>"$CALL_LOG"
case "$*" in
  "projects describe demo-project --format=json")
    printf '{"projectId":"demo-project"}\n'
    ;;
  "services list --enabled --project=demo-project --format=json")
    printf '[{"config":{"name":"artifactregistry.googleapis.com"}},{"config":{"name":"cloudbuild.googleapis.com"}},{"config":{"name":"firebasehosting.googleapis.com"}},{"config":{"name":"logging.googleapis.com"}},{"config":{"name":"run.googleapis.com"}},{"config":{"name":"secretmanager.googleapis.com"}},{"config":{"name":"storage.googleapis.com"}}]\n'
    ;;
  "iam service-accounts describe portal-runtime@demo-project.iam.gserviceaccount.com --project=demo-project --format=json")
    printf '{"email":"portal-runtime@demo-project.iam.gserviceaccount.com"}\n'
    ;;
  "artifacts repositories describe portal-images --project=demo-project --location=europe-west1 --format=json")
    printf '{"format":"DOCKER"}\n'
    ;;
  "storage buckets describe gs://private-bucket --raw --format=json")
    if [[ ${MOCK_BUCKET_DELETE_RULE:-0} == 1 ]]; then
      printf '{"location":"%s","iamConfiguration":{"uniformBucketLevelAccess":{"enabled":true},"publicAccessPrevention":"enforced"},"lifecycle":{"rule":[{"action":{"type":"Delete"}}]}}\n' "${MOCK_BUCKET_LOCATION:-europe-west1}"
    else
      printf '{"location":"%s","iamConfiguration":{"uniformBucketLevelAccess":{"enabled":true},"publicAccessPrevention":"enforced"}}\n' "${MOCK_BUCKET_LOCATION:-europe-west1}"
    fi
    ;;
  "storage buckets get-iam-policy gs://private-bucket --format=json")
    printf '{"bindings":[{"role":"roles/storage.objectUser","members":["serviceAccount:portal-runtime@demo-project.iam.gserviceaccount.com"]}]}\n'
    ;;
  "secrets describe "*)
    printf '{}\n'
    ;;
  *"secrets versions describe latest"*)
    printf '{"state":"%s"}\n' "${MOCK_SECRET_VERSION_STATE:-ENABLED}"
    ;;
  "secrets get-iam-policy "*)
    printf '{"bindings":[{"role":"roles/secretmanager.secretAccessor","members":["serviceAccount:portal-runtime@demo-project.iam.gserviceaccount.com"]}]}\n'
    ;;
  "logging sinks describe _Default --project=demo-project --format=json")
    case ${MOCK_LOG_FILTER_MODE:-valid} in
      wrong-service) log_filter='resource.type="cloud_run_revision" AND resource.labels.service_name="other-service" AND httpRequest.requestUrl=~"/auth/callback"' ;;
      negated) log_filter='resource.type="cloud_run_revision" AND resource.labels.service_name="abizeitbetrug" AND NOT httpRequest.requestUrl=~"/auth/callback"' ;;
      *) log_filter='resource.type="cloud_run_revision" AND resource.labels.service_name="abizeitbetrug" AND httpRequest.requestUrl=~"/auth/callback"' ;;
    esac
    jq -n --arg filter "$log_filter" '{exclusions:[{name:"exclude-oidc-callback",filter:$filter}]}'
    ;;
  "builds submit "*)
    [[ ${MOCK_FULL_ROLLOUT:-0} == 1 ]] || { echo 'Unexpected build outside full mock rollout.' >&2; exit 97; }
    ;;
  "run jobs deploy "*)
    [[ ${MOCK_FULL_ROLLOUT:-0} == 1 ]] || { echo 'Unexpected job deployment outside full mock rollout.' >&2; exit 97; }
    ;;
  "run jobs execute "*)
    [[ ${MOCK_FULL_ROLLOUT:-0} == 1 ]] || { echo 'Unexpected job execution outside full mock rollout.' >&2; exit 97; }
    ;;
  "run deploy "*)
    [[ ${MOCK_FULL_ROLLOUT:-0} == 1 ]] || { echo 'Unexpected service deployment outside full mock rollout.' >&2; exit 97; }
    ;;
  "run services describe abizeitbetrug "*)
    [[ ${MOCK_FULL_ROLLOUT:-0} == 1 ]] || { echo 'Unexpected service lookup outside full mock rollout.' >&2; exit 97; }
    printf 'https://abizeitbetrug-example-ew.a.run.app\n'
    ;;
  *)
    printf 'Unexpected gcloud invocation in preflight-only test: %s\n' "$*" >&2
    exit 97
    ;;
esac
MOCK_GCLOUD
chmod +x "$MOCK_BIN/gcloud"

cat >"$MOCK_BIN/firebase" <<'MOCK_FIREBASE'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'firebase %s\n' "$*" >>"$CALL_LOG"
if [[ $1 == hosting:sites:list ]]; then
  printf '{"status":"success","result":{"sites":[{"name":"projects/demo-project/sites/demo-project","defaultUrl":"https://demo-project.web.app"}]}}\n'
  exit 0
fi
if [[ $1 == deploy && ${MOCK_FULL_ROLLOUT:-0} == 1 ]]; then
  printf 'cwd=%s\n' "$PWD" >>"$CALL_LOG"
  exit 0
fi
printf 'Unexpected Firebase invocation in preflight-only test: %s\n' "$*" >&2
exit 97
MOCK_FIREBASE
chmod +x "$MOCK_BIN/firebase"

cat >"$MOCK_BIN/npm" <<'MOCK_NPM'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'npm %s cwd=%s\n' "$*" "$PWD" >>"$CALL_LOG"
if [[ $1 == run && $2 == build ]]; then
  mkdir -p dist
  printf '<html></html>\n' >dist/index.html
fi
MOCK_NPM
chmod +x "$MOCK_BIN/npm"

cat >"$MOCK_BIN/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl %s\n' "$*" >>"$CALL_LOG"
MOCK_CURL
chmod +x "$MOCK_BIN/curl"

BASE_ENV=(
  PROJECT_ID=demo-project
  CLOUD_RUN_SERVICE_ACCOUNT=portal-runtime@demo-project.iam.gserviceaccount.com
  ARTIFACT_REGISTRY_REPOSITORY=portal-images
  UPLOAD_BUCKET=private-bucket
  PUBLIC_URL=https://demo-project.web.app
  OIDC_ISSUER=https://login.example.edu
  OIDC_CLIENT_ID=portal-production
  BOOTSTRAP_ADMIN_SUBJECT=oidc-subject-1
  DEPLOY_IMAGE_TAG=mock-tag
)
MOCK_PATH="$MOCK_BIN:$PATH"

: >"$CALL_LOG"
if PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "$ROOT/scripts/firebase-deploy.sh" >"$WORK/missing.out" 2>&1; then
  echo 'Expected missing-input validation to fail.' >&2
  exit 1
fi
[[ ! -s $CALL_LOG ]] || { echo 'Missing-input validation invoked a cloud CLI.' >&2; exit 1; }

: >"$CALL_LOG"
if env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=us-central1 "$ROOT/scripts/firebase-deploy.sh" >"$WORK/region.out" 2>&1; then
  echo 'Expected non-EU region validation to fail.' >&2
  exit 1
fi
[[ ! -s $CALL_LOG ]] || { echo 'Region validation invoked a cloud CLI.' >&2; exit 1; }

for bad_location in europe-west2 europe-west6 US; do
  : >"$CALL_LOG"
  if env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=1 MOCK_BUCKET_LOCATION="$bad_location" "$ROOT/scripts/firebase-deploy.sh" >"$WORK/bucket.out" 2>&1; then
    echo "Expected bucket location $bad_location to fail validation." >&2
    exit 1
  fi
  if grep -Eq 'gcloud builds submit|gcloud run jobs deploy|gcloud run deploy|firebase deploy' "$CALL_LOG"; then
    echo 'Bucket validation did not fail before a cloud mutation.' >&2
    exit 1
  fi
done

: >"$CALL_LOG"
if env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=1 MOCK_BUCKET_DELETE_RULE=1 "$ROOT/scripts/firebase-deploy.sh" >"$WORK/lifecycle.out" 2>&1; then
  echo 'Expected a bucket lifecycle Delete rule to fail validation.' >&2
  exit 1
fi

for bad_filter in wrong-service negated; do
  : >"$CALL_LOG"
  if env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=1 MOCK_LOG_FILTER_MODE="$bad_filter" "$ROOT/scripts/firebase-deploy.sh" >"$WORK/log-filter.out" 2>&1; then
    echo "Expected callback log filter $bad_filter to fail validation." >&2
    exit 1
  fi
  if grep -Eq 'gcloud builds submit|gcloud run jobs deploy|gcloud run deploy|firebase deploy' "$CALL_LOG"; then
    echo 'Callback log filter validation did not fail before a cloud mutation.' >&2
    exit 1
  fi
done

: >"$CALL_LOG"
if env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=1 MOCK_SECRET_VERSION_STATE=DISABLED "$ROOT/scripts/firebase-deploy.sh" >"$WORK/secret-version.out" 2>&1; then
  echo 'Expected a disabled latest secret version to fail validation.' >&2
  exit 1
fi

: >"$CALL_LOG"
env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=1 "$ROOT/scripts/firebase-deploy.sh" >"$WORK/dry-run.out"
grep -q 'Preflight passed. Dry run:' "$WORK/dry-run.out"
if grep -Eq 'gcloud builds submit|gcloud run jobs deploy|gcloud run deploy|firebase deploy' "$CALL_LOG"; then
  echo 'Dry run invoked a cloud mutation.' >&2
  exit 1
fi
if grep -q 'DATABASE_URL=.*://' "$CALL_LOG"; then
  echo 'A database credential appeared in the CLI log.' >&2
  exit 1
fi

: >"$CALL_LOG"
# Keep the fake npm build away from the developer's real dist/ output.
ROLLOUT_ROOT="$WORK/rollout"
mkdir -p "$ROLLOUT_ROOT/scripts" "$ROLLOUT_ROOT/deployables/portal/web"
cp "$ROOT/scripts/firebase-deploy.sh" "$ROLLOUT_ROOT/scripts/"
cp "$ROOT/deployables/portal/web/package-lock.json" "$ROLLOUT_ROOT/deployables/portal/web/"
cp "$ROOT/firebase.json" "$ROLLOUT_ROOT/"
env PATH="$MOCK_PATH" CALL_LOG="$CALL_LOG" MOCK_FULL_ROLLOUT=1 "${BASE_ENV[@]}" CLOUD_RUN_REGION=europe-west1 DEPLOY_DRY_RUN=0 "$ROLLOUT_ROOT/scripts/firebase-deploy.sh" >"$WORK/full-rollout.out"
grep -q 'Deployment complete:' "$WORK/full-rollout.out"
build_line=$(grep -n '^gcloud builds submit ' "$CALL_LOG" | cut -d: -f1)
migrate_deploy_line=$(grep -n '^gcloud run jobs deploy ' "$CALL_LOG" | cut -d: -f1)
migrate_execute_line=$(grep -n '^gcloud run jobs execute ' "$CALL_LOG" | cut -d: -f1)
service_deploy_line=$(grep -n '^gcloud run deploy ' "$CALL_LOG" | cut -d: -f1)
hosting_line=$(grep -n '^firebase deploy --only hosting ' "$CALL_LOG" | cut -d: -f1)
(( build_line < migrate_deploy_line && migrate_deploy_line < migrate_execute_line && migrate_execute_line < service_deploy_line && service_deploy_line < hosting_line )) || {
  echo 'Full mock rollout did not build, migrate, serve, then deploy Hosting in order.' >&2
  exit 1
}
grep -Fx "cwd=$ROLLOUT_ROOT" "$CALL_LOG" >/dev/null || { echo 'Firebase Hosting deploy did not run from the repository root.' >&2; exit 1; }
if grep -q 'DATABASE_URL=.*://' "$CALL_LOG"; then
  echo 'A database credential appeared in the full rollout CLI log.' >&2
  exit 1
fi

printf 'Firebase deployment mock tests passed (preflight and full rollout; no project was contacted).\n'

