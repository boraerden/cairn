# Cairn

Collaborative field-reporting PWA. MapLibre vector map, GeoJSON document persisted to S3, photo/audio/video attachments as separate S3 objects, full offline support (pre-downloaded tile regions + edit queue), mobile-first UI installable to an iPhone home screen.

**Stack:** Vite + React + TypeScript (PWA) · MapLibre GL + Terra Draw · AWS Lambda + API Gateway + S3 + CloudFront · AWS CDK for infra · pnpm workspaces.

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

## Installing on iPhone

Open the deployed URL in Safari → Share → **Add to Home Screen**. The app launches full-screen, caches its shell, and syncs when foregrounded. See `plan.md` "Installing on iPhone" for the Capacitor v1.5 escape hatch if iOS storage limits bite.
