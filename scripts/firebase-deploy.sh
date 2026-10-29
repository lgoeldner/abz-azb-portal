#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
REGION=${CLOUD_RUN_REGION:-europe-west1}
SERVICE=${CLOUD_RUN_SERVICE:-abizeitbetrug}
MIGRATION_JOB=abizeitbetrug-migrate
SECRETS="DATABASE_URL OIDC_CLIENT_SECRET SESSION_SECRET"
REQUIRED_APIS="artifactregistry.googleapis.com cloudbuild.googleapis.com firebasehosting.googleapis.com logging.googleapis.com run.googleapis.com secretmanager.googleapis.com storage.googleapis.com"

die() {
  printf 'firebase-deploy: %s\n' "$1" >&2
  exit 2
}

require_value() {
  local name=$1 value
  value=$(printenv "$name" || true)
  [[ -n $value ]] || die "Set $name (see deploy/firebase/cloud-run.env.example)."
}

no_commas() {
  local name=$1 value
  value=$(printenv "$name")
  [[ $value != *,* ]] || die "$name cannot contain a comma because it is passed as a Cloud Run environment setting."
}

has_member_role() {
  local policy=$1 role=$2 member=$3
  jq -e --arg role "$role" --arg member "$member" \
    'any(.bindings[]?; .role == $role and any(.members[]?; . == $member))' \
    <<<"$policy" >/dev/null
}

for name in PROJECT_ID CLOUD_RUN_SERVICE_ACCOUNT ARTIFACT_REGISTRY_REPOSITORY UPLOAD_BUCKET PUBLIC_URL OIDC_ISSUER OIDC_CLIENT_ID BOOTSTRAP_ADMIN_SUBJECT; do
  require_value "$name"
done

[[ $REGION == europe-west1 ]] || die 'CLOUD_RUN_REGION is fixed to europe-west1 because firebase.json targets that region.'
[[ $SERVICE == abizeitbetrug ]] || die 'CLOUD_RUN_SERVICE is fixed to abizeitbetrug because firebase.json targets that service.'
[[ $PROJECT_ID =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die 'PROJECT_ID must be a valid Google Cloud project ID.'
[[ $ARTIFACT_REGISTRY_REPOSITORY =~ ^[a-z][a-z0-9-]{0,62}$ ]] || die 'ARTIFACT_REGISTRY_REPOSITORY must be an existing Artifact Registry repository name.'
[[ $UPLOAD_BUCKET =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || die 'UPLOAD_BUCKET must be a bucket name, without gs://.'
[[ $CLOUD_RUN_SERVICE_ACCOUNT == *@"$PROJECT_ID".iam.gserviceaccount.com ]] || die 'CLOUD_RUN_SERVICE_ACCOUNT must be an existing service account in PROJECT_ID.'
[[ $PUBLIC_URL =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || die 'PUBLIC_URL must be an HTTPS origin without a path, query or fragment.'
[[ $OIDC_ISSUER == https://* ]] || die 'OIDC_ISSUER must use HTTPS.'
[[ $OIDC_CLIENT_ID != *[[:space:]]* && $BOOTSTRAP_ADMIN_SUBJECT != *[[:space:]]* ]] || die 'OIDC_CLIENT_ID and BOOTSTRAP_ADMIN_SUBJECT must not contain whitespace.'
for name in PUBLIC_URL OIDC_ISSUER OIDC_CLIENT_ID BOOTSTRAP_ADMIN_SUBJECT; do
  no_commas "$name"
done
DRY_RUN=$(printenv DEPLOY_DRY_RUN || printf '0')
[[ $DRY_RUN == 0 || $DRY_RUN == 1 ]] || die 'DEPLOY_DRY_RUN must be 0 or 1.'

for command in gcloud firebase jq node npm curl git; do
  command -v "$command" >/dev/null 2>&1 || die "Required command not found: $command."
done

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
RUNTIME_SA=$CLOUD_RUN_SERVICE_ACCOUNT
REGISTRY=$ARTIFACT_REGISTRY_REPOSITORY
IMAGE_TAG=$(printenv DEPLOY_IMAGE_TAG || true)
if [[ -z $IMAGE_TAG ]]; then
  IMAGE_TAG="$(git -C "$ROOT" rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"
fi
[[ $IMAGE_TAG =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die 'DEPLOY_IMAGE_TAG contains unsupported characters.'
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REGISTRY/portal:$IMAGE_TAG"
MEMBER="serviceAccount:$RUNTIME_SA"

printf 'Preflight: checking existing project resources in %s.\n' "$REGION"

project_json=$(gcloud projects describe "$PROJECT_ID" --format=json) || die 'Cannot read the selected Google Cloud project.'
jq -e --arg project "$PROJECT_ID" '.projectId == $project' <<<"$project_json" >/dev/null || die 'The selected Google Cloud project ID did not match.'

api_json=$(gcloud services list --enabled --project="$PROJECT_ID" --format=json) || die 'Cannot list enabled Google Cloud APIs.'
required_json=$(jq -cn --arg apis "$REQUIRED_APIS" '$apis | split(" ")')
jq -e --argjson required "$required_json" \
  '[.[]?.config.name] as $enabled | all($required[]; . as $api | $enabled | index($api) != null)' \
  <<<"$api_json" >/dev/null || die 'Enable the required APIs listed in docs/firebase-deployment.md before deploying.'

sa_json=$(gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT_ID" --format=json) || die 'Cannot read the runtime service account.'
jq -e --arg sa "$RUNTIME_SA" '.email == $sa' <<<"$sa_json" >/dev/null || die 'The runtime service account does not match the selected project.'

repo_json=$(gcloud artifacts repositories describe "$REGISTRY" --project="$PROJECT_ID" --location="$REGION" --format=json) || die 'Cannot read the Artifact Registry repository.'
jq -e '.format == "DOCKER"' <<<"$repo_json" >/dev/null || die 'ARTIFACT_REGISTRY_REPOSITORY must be an existing Docker repository in europe-west1.'

bucket_json=$(gcloud storage buckets describe "gs://$UPLOAD_BUCKET" --raw --format=json) || die 'Cannot read the upload bucket.'
jq -e '
  (.location | ascii_upcase) as $location |
  $location == "EUROPE-WEST1" and
  .iamConfiguration.uniformBucketLevelAccess.enabled == true and
  .iamConfiguration.publicAccessPrevention == "enforced" and
  ([.lifecycle.rule[]?.action.type] | any(. == "Delete") | not)
' <<<"$bucket_json" >/dev/null || die 'UPLOAD_BUCKET must be in europe-west1, use uniform bucket-level access, enforce public access prevention, and have no lifecycle Delete rule.'
bucket_policy=$(gcloud storage buckets get-iam-policy "gs://$UPLOAD_BUCKET" --format=json) || die 'Cannot read upload bucket IAM policy.'
has_member_role "$bucket_policy" roles/storage.objectUser "$MEMBER" || die 'Grant roles/storage.objectUser directly to the runtime service account on the upload bucket.'

for secret in $SECRETS; do
  gcloud secrets describe "$secret" --project="$PROJECT_ID" --format=json >/dev/null || die "Create Secret Manager secret $secret and add an enabled version before deploying."
  secret_version=$(gcloud secrets versions describe latest --secret="$secret" --project="$PROJECT_ID" --format=json) || die "Secret Manager secret $secret has no readable latest version."
  jq -e '.state == "ENABLED"' <<<"$secret_version" >/dev/null || die "Secret Manager secret $secret must have an enabled latest version."
  secret_policy=$(gcloud secrets get-iam-policy "$secret" --project="$PROJECT_ID" --format=json) || die "Cannot read IAM policy for Secret Manager secret $secret."
  has_member_role "$secret_policy" roles/secretmanager.secretAccessor "$MEMBER" || die "Grant roles/secretmanager.secretAccessor directly to the runtime service account on secret $secret."
done

sites_json=$(firebase hosting:sites:list --project "$PROJECT_ID" --json --non-interactive) || die 'Cannot list Firebase Hosting sites for PROJECT_ID; check Firebase CLI login and project access.'
jq -e --arg project "$PROJECT_ID" 'any(.. | objects; .name? == ("projects/" + $project + "/sites/" + $project) or .siteId? == $project)' \
  <<<"$sites_json" >/dev/null || die 'The Firebase project has no default Hosting site named after PROJECT_ID. Create/select it before deploying.'

default_sink=$(gcloud logging sinks describe _Default --project="$PROJECT_ID" --format=json) || die 'Cannot read the project _Default Cloud Logging sink.'
CALLBACK_EXCLUSION='resource.type="cloud_run_revision" AND resource.labels.service_name="abizeitbetrug" AND httpRequest.requestUrl=~"/auth/callback"'
jq -e --arg filter "$CALLBACK_EXCLUSION" '
  any(.exclusions[]?;
    .name == "exclude-oidc-callback" and
    .disabled != true and
    .filter == $filter
  )
' <<<"$default_sink" >/dev/null || die 'Add the /auth/callback request-log exclusion to the project _Default sink before deploying; also check applicable organization/folder sinks.'

if [[ $DRY_RUN == 1 ]]; then
  printf 'Preflight passed. Dry run: would build %s, run %s migrate, deploy %s, then deploy Hosting only to %s.\n' \
    "$IMAGE" "$MIGRATION_JOB" "$SERVICE" "$PROJECT_ID"
  exit 0
fi

[[ -f "$ROOT/deployables/portal/web/package-lock.json" ]] || die 'The existing frontend package lock is missing.'
printf 'Building frontend assets for Firebase Hosting.\n'
(cd "$ROOT/deployables/portal/web" && npm ci && npm run build)
[[ -s "$ROOT/deployables/portal/web/dist/index.html" ]] || die 'Frontend build did not produce dist/index.html.'

printf 'Building portal container image.\n'
gcloud builds submit "$ROOT/deployables/portal" --tag "$IMAGE" --project="$PROJECT_ID" --region="$REGION" --quiet

env_vars="APP_ENV=production,AUTH_MODE=oidc,PUBLIC_URL=$PUBLIC_URL,OIDC_ISSUER=$OIDC_ISSUER,OIDC_CLIENT_ID=$OIDC_CLIENT_ID,BOOTSTRAP_ADMIN_SUBJECT=$BOOTSTRAP_ADMIN_SUBJECT,FIREBASE_HOSTING=1,UPLOAD_BUCKET=$UPLOAD_BUCKET"
secret_refs='DATABASE_URL=DATABASE_URL:latest,OIDC_CLIENT_SECRET=OIDC_CLIENT_SECRET:latest,SESSION_SECRET=SESSION_SECRET:latest'

printf 'Deploying migration job and applying database migrations before serving traffic.\n'
gcloud run jobs deploy "$MIGRATION_JOB" \
  --image="$IMAGE" --project="$PROJECT_ID" --region="$REGION" \
  --service-account="$RUNTIME_SA" --tasks=1 --max-retries=0 --task-timeout=10m \
  --command=/usr/local/bin/portal --args=migrate --cpu=1 --memory=512Mi \
  --set-env-vars="$env_vars" --set-secrets="$secret_refs" --quiet
gcloud run jobs execute "$MIGRATION_JOB" --project="$PROJECT_ID" --region="$REGION" --wait --quiet

printf 'Deploying Cloud Run service.\n'
printf 'Cloud Run will be publicly invokable so Firebase Hosting can proxy requests; portal data routes still require OIDC and server-side authorization.\n'
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" --project="$PROJECT_ID" --region="$REGION" \
  --service-account="$RUNTIME_SA" --allow-unauthenticated \
  --min=0 --max=1 --concurrency=8 --cpu=1 --memory=512Mi --port=8080 --timeout=60s \
  --cpu-throttling --deploy-health-check \
  --set-env-vars="$env_vars" --set-secrets="$secret_refs" --quiet

run_url=$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)') || die 'Cannot read the deployed Cloud Run service URL.'
[[ $run_url == https://* ]] || die 'Cloud Run did not return an HTTPS service URL.'
curl --fail --silent --show-error --max-time 30 "$run_url/readyz" >/dev/null || die 'Cloud Run /readyz did not return success after deployment.'

printf 'Deploying Firebase Hosting only.\n'
firebase deploy --only hosting --project "$PROJECT_ID" --non-interactive
curl --fail --silent --show-error --max-time 30 "$PUBLIC_URL/readyz" >/dev/null || die 'Firebase Hosting /readyz did not return success after deployment.'

printf 'Deployment complete: Cloud Run %s in %s and Firebase Hosting %s are ready.\n' "$SERVICE" "$REGION" "$PROJECT_ID"

