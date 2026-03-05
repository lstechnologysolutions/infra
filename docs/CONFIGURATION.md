# Configuration Guide

## Core Environment Variables

The scaffolded `infra.config.ts` is environment-driven.

| Variable | Required | Description |
|---|---|---|
| `INFRA_PROFILE` | No | `next-only`, `next-expo`, `expo-web` |
| `INFRA_APP_NAME` | No | SST app name |
| `INFRA_USE_EXTERNAL_CERTS` | No | `true` to force use of `INFRA_*_CERT_ARN_*` values |
| `INFRA_ROOT_DOMAIN` | Yes | Root domain for stage resolution |
| `INFRA_HOSTED_ZONE_DOMAIN` | No | Explicit Route53 zone domain override (eg. `alternun.co`) |
| `INFRA_PIPELINE_REPO` | No | GitHub repo in `owner/repo` format |
| `INFRA_PIPELINE_PREFIX` | No | Prefix for pipeline names |
| `INFRA_PROJECT_TAG` | No | Resource tag value |
| `INFRA_PIPELINES` | No | Pipeline stage CSV: `production,dev,mobile` |
| `INFRA_PIPELINE_BRANCH_PROD` | No | Branch for production pipeline |
| `INFRA_PIPELINE_BRANCH_DEV` | No | Branch for dev pipeline |
| `INFRA_PIPELINE_BRANCH_MOBILE` | No | Branch for mobile pipeline |
| `INFRA_PIPELINES_CONFIG_PATH` | No | Runtime pipeline config JSON path |
| `INFRA_CREATE_PIPELINES` | No | `true` allows production deploy to create/update pipelines |
| `INFRA_PIPELINE_PERMISSIONS_MODE` | No | `admin` or `least-privilege` for CodeBuild IAM |
| `INFRA_ENABLE_EXPO_SITE` | No | `true` enables Expo site for `next-expo` profile |

## Domain Overrides (Optional)

| Variable | Description |
|---|---|
| `INFRA_WEB_DOMAIN_PRODUCTION` | Web production domain |
| `INFRA_WEB_DOMAIN_DEV` | Web dev domain |
| `INFRA_WEB_DOMAIN_MOBILE` | Web mobile-stage domain |
| `INFRA_EXPO_DOMAIN_PRODUCTION` | Expo production domain |
| `INFRA_EXPO_DOMAIN_DEV` | Expo dev domain |
| `INFRA_EXPO_DOMAIN_MOBILE` | Expo mobile-stage domain |

## Certificate Reuse (Optional)

| Variable | Description |
|---|---|
| `INFRA_WEB_CERT_ARN_PRODUCTION` | Existing ACM cert ARN for web prod domain |
| `INFRA_WEB_CERT_ARN_DEV` | Existing ACM cert ARN for web dev domain |
| `INFRA_WEB_CERT_ARN_MOBILE` | Existing ACM cert ARN for web mobile-stage domain |
| `INFRA_EXPO_CERT_ARN_PRODUCTION` | Existing ACM cert ARN for expo prod domain |
| `INFRA_EXPO_CERT_ARN_DEV` | Existing ACM cert ARN for expo dev domain |
| `INFRA_EXPO_CERT_ARN_MOBILE` | Existing ACM cert ARN for expo mobile-stage domain |

## Runtime Pipeline Config

`INFRA_PIPELINES_CONFIG_PATH` defaults to `config/pipelines.json`.
If present, `scripts/ensure-pipelines.sh` reads it to drive stage enablement/branches/repos.

Example (`config/pipelines.json`):

```json
{
  "pipelines": {
    "production": { "enabled": true, "branch": "main", "repo": "myorg/web" },
    "dev": { "enabled": true, "branch": "develop", "repo": "myorg/web" },
    "mobile": { "enabled": false, "branch": "mobile", "repo": "myorg/mobile" }
  }
}
```

## Pipeline Mutation Safety

Normal deploys should keep:

```bash
INFRA_CREATE_PIPELINES=false
```

To intentionally create/update pipelines:

```bash
APPROVE=true bash scripts/ensure-pipelines.sh
```

This script flips `INFRA_CREATE_PIPELINES=true` only for explicit pipeline-creation deploys.

## Delegated Subdomain / Parent Zone Setup

For setups like:

- app domain: `airs.alternun.co`
- stage domain: `dev.airs.alternun.co`
- hosted zone available in AWS: `alternun.co`

set:

```bash
INFRA_ROOT_DOMAIN=airs.alternun.co
INFRA_HOSTED_ZONE_DOMAIN=alternun.co
```

Helper scripts also fallback to parent zones automatically during Route53 checks/updates.

## Local Private Config

Scaffolded defaults include:

- `config/private.example.json`
- `.gitignore` rules:
  - `config/*.json`
  - `!config/*.example.json`

Use `config/private.json` for local-only deployment metadata/secrets (never commit it).

## SST Secrets

Minimum secrets from Next.js templates:

- `DatabaseUrl`
- `AuthSecret`

Set per stage:

```bash
npx sst secret set DatabaseUrl "postgresql://..." --stage dev
npx sst secret set AuthSecret "your-secret" --stage dev
```
