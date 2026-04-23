# Cairn

Collaborative field-reporting PWA. MapLibre vector map, GeoJSON document persisted to S3, photo/audio/video attachments as separate S3 objects, full offline support (pre-downloaded tile regions + edit queue), mobile-first UI installable to an iPhone home screen.

**Stack:** Vite + React + TypeScript (PWA) · MapLibre GL + Terra Draw · Backend supports AWS (Lambda + S3) and GCP MVP (Cloud Run + GCS signed URLs) · pnpm workspaces.

No Mapbox / proprietary dependencies — fully MapLibre-native.

## Layout

```
cairn/
  packages/
    types/      # shared feature schema
  backend/      # Lambda handler (auth, map, media, admin) + seed-admin script
  frontend/    # Vite + React PWA (map, editor, admin, offline queue, region downloader)
  infra/        # AWS CDK stack (S3, Lambda, API Gateway, CloudFront, IAM)
```

## Prerequisites

- Node **>= 20** (see `.nvmrc`)
- **pnpm** 10+
- **AWS CLI** configured with a profile that has deploy rights
- **AWS CDK** (installed locally via `pnpm` in `infra/` — no global install needed)
- For GCP deploys: **gcloud CLI** authenticated to a project

## First-time setup

```bash
pnpm install
```

## Development

```bash
# frontend dev server (http://localhost:5173)
pnpm dev

# build everything
pnpm build

# typecheck all workspaces
pnpm typecheck
```

## Deploy (AWS)

1. Configure AWS credentials (`aws configure` or `AWS_PROFILE`).
2. Bootstrap the account/region once: `pnpm --filter @cairn/infra cdk bootstrap`.
3. Deploy: `pnpm infra:deploy`.
4. Build and upload the frontend bundle to the `site/` prefix (the deploy step prints the bucket name).
5. Seed the first admin: `pnpm seed-admin -- --email=you@example.com --password=...`.

See `plan.md` for full architecture, S3 layout, offline strategy, and the migration path to real-time (Yjs + WebSockets).

## Deploy API (GCP MVP, phase 1)

This deploy path ports the API + object storage flows to GCP:

- API runtime: Cloud Run (`backend/src/server.ts`)
- Storage + signed URLs: Google Cloud Storage (`CAIRN_STORAGE_BACKEND=gcs`)
- Frontend hosting/CDN is intentionally left as-is for this phase.

1. Enable required APIs:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com
```

1. Create a bucket for map/auth/media objects:

```bash
export GCP_PROJECT_ID="<your-project-id>"
export GCP_REGION="us-central1"
export CAIRN_BUCKET="${GCP_PROJECT_ID}-cairn-data"

gcloud storage buckets create "gs://${CAIRN_BUCKET}" --project "${GCP_PROJECT_ID}" --location "${GCP_REGION}" --uniform-bucket-level-access
```

1. Configure bucket CORS for browser PUT/GET to signed URLs:

```bash
gcloud storage buckets update "gs://${CAIRN_BUCKET}" --cors-file backend/gcp/gcs-cors.json
```

1. Deploy backend to Cloud Run:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"

gcloud run deploy cairn-api \
  --project "${GCP_PROJECT_ID}" \
  --region "${GCP_REGION}" \
  --allow-unauthenticated \
  --source . \
  --dockerfile Dockerfile.backend-gcp \
  --set-env-vars "CAIRN_STORAGE_BACKEND=gcs,CAIRN_BUCKET=${CAIRN_BUCKET},JWT_SECRET=${JWT_SECRET}"
```

1. Set frontend API URL and rebuild/redeploy frontend to your existing host:

```bash
echo "VITE_API_URL=$(gcloud run services describe cairn-api --project "${GCP_PROJECT_ID}" --region "${GCP_REGION}" --format='value(status.url)')" > frontend/.env.production
pnpm frontend:build
```

1. Seed first admin user against the same GCS bucket:

```bash
CAIRN_STORAGE_BACKEND=gcs CAIRN_BUCKET="${CAIRN_BUCKET}" pnpm seed-admin -- --email=you@example.com --password='<strong-password>'
```

## Installing on iPhone

Open the deployed URL in Safari → Share → **Add to Home Screen**. The app launches full-screen, caches its shell, and syncs when foregrounded. See `plan.md` "Installing on iPhone" for the Capacitor v1.5 escape hatch if iOS storage limits bite.