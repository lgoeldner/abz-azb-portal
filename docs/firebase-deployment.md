# Firebase Hosting and Cloud Run deployment

This is an opt-in deployment path. Nothing deploys automatically. The explicit entry point is **scripts/firebase-deploy.sh**; it first checks the existing project, bucket, direct runtime IAM grants, Hosting default site, enabled secret versions, and callback-log exclusion. **DEPLOY_DRY_RUN=1** runs those read-only checks and prints the planned image and deployment sequence. The script does not create accounts, enable APIs, configure billing, create secrets, or seed application data. It deliberately makes the Cloud Run service publicly invokable so Firebase Hosting can proxy requests. The app still requires OIDC sessions and server-side authorization for private data.

## Shape and boundaries

- Firebase Hosting serves the built React application from **deployables/portal/web/dist** on its global CDN. These files are public static assets.
- Firebase Hosting rewrites **/api/**, **/auth/**, **/healthz**, and **/readyz** to the **abizeitbetrug** Cloud Run service in **europe-west1**. Other paths use the SPA’s **index.html** fallback. No JavaScript API rewrite is used.
- The portal and private uploads run in Cloud Run in Belgium (**europe-west1**). Upload objects stay in a private EU Cloud Storage bucket. Private pages and records are fetched through the authenticated portal API.
- PostgreSQL is an external service. Choose an EU database region and keep its connection string in Secret Manager. The existing external OIDC provider remains the identity provider; configure its callback as **PUBLIC_URL/auth/callback**.
- This is not an all-EU service: Firebase Hosting delivers public static assets through a global CDN, and the external OIDC provider has its own location and processing. The app, upload bucket, and selected database region are the data-location decisions in this deployment.

Firebase Hosting forwards only the specially named **__session** cookie to rewritten Cloud Run requests. **FIREBASE_HOSTING=1** makes the backend use that name for OIDC login state and the authenticated session; keep it enabled for this deployment. [Firebase Hosting cache and cookie behavior](https://firebase.google.com/docs/hosting/manage-cache)

Firebase Hosting supports Cloud Run rewrites in **europe-west1** and gives rewritten requests a 60-second timeout. Large photo uploads or ZIP exports can therefore time out at Hosting even when the application endpoint itself allows longer work. Cloud ZIP exports stream directly to the authenticated response, avoiding Cloud Run’s RAM-backed filesystem. An interrupted export fails the download and must be retried; ZIP Range/resume is unavailable. Private photo URLs must remain API routes; do not upload user photos, ZIPs, or other contributions into the Hosting public directory. [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)

## Cost and service selection

The Cloud Run service uses request-based CPU throttling, zero minimum instances, one maximum instance, concurrency 8, one vCPU, and 512 MiB. The migration job runs with one task, one vCPU, 512 MiB, no retries, and a ten-minute task timeout; job compute is billed while it runs. Cloud Run’s free compute allowance includes **europe-west1**, but usage is pooled by billing account and is not a billing cap. Firebase’s Cloud Run and Google Cloud integrations require a Blaze-billed project. EU Cloud Storage is billed; Google’s Cloud Storage Always Free location allowance applies only to selected US regions. Cloud Build, retained Artifact Registry images, Secret Manager operations and versions, and network transfer can also incur separate charges. Budget alerts are useful but do not stop charges. No combination here guarantees a €0 bill. [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firebase pricing](https://firebase.google.com/pricing), [Cloud Storage pricing](https://cloud.google.com/storage/pricing), [Cloud Build pricing](https://cloud.google.com/build/pricing), [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing), [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing), [Network pricing](https://cloud.google.com/vpc/network-pricing)

Neon is one possible external PostgreSQL provider: its current Free plan has a $0 tier, and its supported regions include Frankfurt (**aws-eu-central-1**). Free-plan quotas and availability can change; check the plan and region before creating a database and do not treat it as a guaranteed production price or availability commitment. [Neon pricing](https://neon.com/pricing), [Neon regions](https://neon.com/docs/introduction/regions)

## One-time project setup

Use an existing Google Cloud/Firebase project with billing already configured. The deployment script expects these APIs to be enabled in that project:

~~~sh
export PROJECT_ID='your-existing-project-id'
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firebasehosting.googleapis.com \
  logging.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project "$PROJECT_ID"
~~~

The command above is an explicit setup step; the deploy script only verifies API state. Use a Firebase Hosting site already attached to this same project. If none exists, create one intentionally with **firebase hosting:sites:create**. Copy **.firebaserc.example** to **.firebaserc** and replace the example project ID. Deployment still passes **--project** explicitly.

Create an existing Docker repository in the fixed Cloud Run region:

~~~sh
gcloud artifacts repositories create portal-images \
  --repository-format=docker \
  --location=europe-west1 \
  --project "$PROJECT_ID"
~~~

Create the private upload bucket in **europe-west1**, colocated with the Cloud Run service. The deploy preflight requires that exact location, uniform bucket-level access, public access prevention enforced, no lifecycle **Delete** rule, and a direct object-user grant for the runtime service account. This protects immutable uploads from an unnoticed lifecycle policy deleting a photo still referenced by the database.

~~~sh
export UPLOAD_BUCKET='your-unique-private-bucket-name'
gcloud storage buckets create "gs://$UPLOAD_BUCKET" \
  --location=europe-west1 \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --project "$PROJECT_ID"
~~~

Create or select a runtime service account and grant it only the access this runtime needs: **roles/storage.objectUser** on this bucket and **roles/secretmanager.secretAccessor** directly on each of the three secrets. The deploy script checks those direct bindings and will stop before building if any are missing. The deploying operator also needs Cloud Build, Artifact Registry, Cloud Run, Firebase Hosting, and service-account use permissions; the deploy script does not grant them.

~~~sh
export RUNTIME_SA="portal-runtime@$PROJECT_ID.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$UPLOAD_BUCKET" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/storage.objectUser

for secret in DATABASE_URL OIDC_CLIENT_SECRET SESSION_SECRET; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/secretmanager.secretAccessor
done
~~~

Create the three Secret Manager secrets and add enabled versions using the console or a protected input file. Never put secret values in this repository, a shell command argument, an exported deployment file, or a log. The deploy script passes secret names and version references to Cloud Run, not secret values. Its default reference is **latest**; for a production release, use known versions and update the script references deliberately if rotation needs a pinned version. The DATABASE_URL should use TLS and a small connection pool; for a low-traffic Cloud Run instance, add **pool_max_conns=4** to its PostgreSQL DSN. Do not run the app’s **seed** command in this project.

## Exclude OIDC callback URLs from logs

The OIDC callback URL carries a one-use authorization code in its query string. Cloud Run request logs are created automatically. Before the first deployment, exclude callback request entries from the project’s **_Default** sink and from every applicable folder or organization sink that routes these logs. Project sink exclusions do not prevent a separate parent sink from receiving the same entry. This deployment script requires the exclusion on the project **_Default** sink and reminds operators to check parent sinks. [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging), [Cloud Logging sink routing](https://docs.cloud.google.com/logging/docs/routing/overview)

Use this filter for the Cloud Run service. Add it as an exclusion to the project **_Default** sink and each relevant aggregated sink:

~~~text
resource.type="cloud_run_revision"
resource.labels.service_name="abizeitbetrug"
httpRequest.requestUrl=~"/auth/callback"
~~~

For the project’s default sink, the command is:

~~~sh
gcloud logging sinks update _Default \
  --project "$PROJECT_ID" \
  --add-exclusion='name=exclude-oidc-callback,description=Exclude one-use OIDC callback request URLs,filter=resource.type="cloud_run_revision" AND resource.labels.service_name="abizeitbetrug" AND httpRequest.requestUrl=~"/auth/callback"'
~~~

Apply the same exclusion to parent sinks with **--folder=FOLDER_ID** or **--organization=ORG_ID** instead of **--project**. Review each configured destination and verify that the exclusion is active. Exclusions only affect routing after Cloud Logging receives the entry; they do not remove entries that were already routed or prevent the write API call. Do not enable verbose/debug command tracing during deployment.

## Environment and deploy

Copy **deploy/firebase/cloud-run.env.example** to a local ignored file, set the project, runtime service account, existing repository and europe-west1 bucket, canonical HTTPS public origin, existing OIDC issuer/client ID, and exact bootstrap admin subject. Export those values in the terminal. Do not add the local file to Git.

Run the mock-safe preflight first:

~~~sh
DEPLOY_DRY_RUN=1 scripts/firebase-deploy.sh
~~~

If it passes and the target project is intended for deployment, invoke the script explicitly:

~~~sh
scripts/firebase-deploy.sh
~~~

The sequence is: build the existing portal Docker context with Cloud Build; deploy and execute a one-task Cloud Run Job running **portal migrate**; deploy the new Cloud Run service revision; check **/readyz** directly and through Firebase Hosting; and deploy **Hosting only**. Cloud Run uses the existing runtime service account and references **DATABASE_URL**, **OIDC_CLIENT_SECRET**, and **SESSION_SECRET** through Secret Manager. The service is publicly invokable at the Cloud Run layer so Firebase Hosting can proxy requests; the script prints this setting before deploying. Portal data routes still require the portal’s external OIDC session and server-side permissions. During an update, the old service revision can continue serving while the migration runs. The current migrations are additive; future incompatible schema changes need an explicit maintenance/expand-contract plan and a tested backup before deployment. The script never runs **portal seed**.

The script deploys Firebase Hosting as the only Firebase target (**firebase deploy --only hosting**). It does not deploy Firestore, Functions, App Hosting, or any other Firebase service. Hosting applies **no-store** to API and auth routes; fingerprinted **/assets/** files receive long caching. The global CDN contains public frontend bundles only.

## Backup and restore before real content

The existing Restic scripts operate on the local upload directory used by Docker Compose. They do not back up this Cloud Storage bucket. The deployment does not configure **BACKUP_STATUS_FILE** or schedule a Cloud Run backup job; the admin backup status remains unavailable unless a separately managed integration supplies it. Before accepting real contributions, arrange a backup that captures PostgreSQL and the private bucket as one recovery set. One manual procedure is:

1. On a trusted backup runner, use a protected libpq service file (mode **0600**) for the database connection, keep shell tracing off, and make a custom-format dump first. Do not put the database URL in command arguments or logs.

   ~~~sh
   export PGSERVICEFILE=/secure/path/portal-pg-service.conf
   export RECOVERY_SET=/secure/recovery/portal-2026-10-29
   mkdir -p "$RECOVERY_SET/uploads"
   chmod 700 "$RECOVERY_SET" "$RECOVERY_SET/uploads"
   pg_dump --service=portal --format=custom --no-owner --no-acl \
     --file="$RECOVERY_SET/database.dump"
   ~~~

2. Copy all live immutable objects from the source bucket into the set. Do not use **--delete**. This includes objects referenced only by old revisions, app-soft-deleted records, and orphaned uploads; they may still be needed by history or recovery. The deployment preflight rejects lifecycle Delete rules. If Cloud Storage object versioning or native soft-delete generations are enabled and required for recovery, export those generations separately; ordinary rsync copies live objects.

   ~~~sh
   gcloud storage rsync "gs://$UPLOAD_BUCKET" "$RECOVERY_SET/uploads" --recursive
   ~~~

3. Create a manifest with the dump time, application image tag, migration version, source bucket and object-copy time. Checksum the dump and copied objects, then copy the set to an independently controlled, private EU destination with encryption and a defined retention policy.

   ~~~sh
   printf 'image_tag=%s\nmigration_version=%s\nsource_bucket=%s\n' \
     "$IMAGE_TAG" "$MIGRATION_VERSION" "$UPLOAD_BUCKET" >"$RECOVERY_SET/manifest.txt"
   (cd "$RECOVERY_SET" && find database.dump uploads manifest.txt -type f -print0 \
     | sort -z | xargs -0 sha256sum >SHA256SUMS)
   gcloud storage rsync "$RECOVERY_SET" "gs://$RECOVERY_BUCKET/portal/$IMAGE_TAG" --recursive
   ~~~

4. Restore into a disposable empty database and a different private EU bucket. Verify the checksums, restore the dump with **pg_restore** using the protected libpq service file, copy the set’s objects to that bucket, run the app’s migrations if needed, and verify readiness, representative records, login and attachment reads.

Record the snapshot, migration version, date, and results. A backup file or object listing alone is not a restore test; recovery is unverified until that round trip succeeds. The Firebase deployment script does not create, schedule, or verify cloud backups.

