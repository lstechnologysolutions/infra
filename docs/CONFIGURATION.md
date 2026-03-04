# Configuration Guide

## Environment Variables

The scaffolded `infra.config.ts` is environment-driven.

| Variable | Required | Description |
|---|---|---|
| `INFRA_APP_NAME` | No | SST app name |
| `INFRA_ROOT_DOMAIN` | Yes | Root domain for stage resolution |
| `INFRA_PIPELINE_REPO` | No | GitHub repo in `owner/repo` format |
| `INFRA_PIPELINE_PREFIX` | No | Prefix for pipeline names |
| `INFRA_PROJECT_TAG` | No | Resource tag value |
| `INFRA_PIPELINES` | No | Pipeline stages CSV: `production,dev,mobile` |
| `INFRA_PIPELINE_BRANCH_PROD` | No | Branch for production pipeline |
| `INFRA_PIPELINE_BRANCH_DEV` | No | Branch for dev pipeline |
| `INFRA_PIPELINE_BRANCH_MOBILE` | No | Branch for mobile pipeline |
| `INFRA_ENABLE_EXPO_SITE` | No | `true` enables Expo `StaticSite` deploy |

### Domain Overrides (Optional)

| Variable | Description |
|---|---|
| `INFRA_WEB_DOMAIN_PRODUCTION` | Web production domain |
| `INFRA_WEB_DOMAIN_DEV` | Web dev domain |
| `INFRA_WEB_DOMAIN_MOBILE` | Web mobile-stage domain |
| `INFRA_EXPO_DOMAIN_PRODUCTION` | Expo production domain |
| `INFRA_EXPO_DOMAIN_DEV` | Expo dev domain |
| `INFRA_EXPO_DOMAIN_MOBILE` | Expo mobile-stage domain |

## DNS Helper Script Overrides

These are consumed by `predeploy-checks.sh` and `postdeploy-update-dns.sh` (typically via `buildspec.yml`):

| Variable | Description |
|---|---|
| `DOMAIN_ROOT` | Base/root domain |
| `DOMAIN_PRODUCTION` | Explicit production domain override |
| `DOMAIN_DEV` | Explicit dev domain override |
| `DOMAIN_MOBILE` | Explicit mobile domain override |
| `DOMAIN_CUSTOM` | Explicit override for non-standard stage names |

### Certificate Reuse (Optional)

| Variable | Description |
|---|---|
| `INFRA_WEB_CERT_ARN_PRODUCTION` | Existing ACM cert ARN for web prod domain |
| `INFRA_WEB_CERT_ARN_DEV` | Existing ACM cert ARN for web dev domain |
| `INFRA_WEB_CERT_ARN_MOBILE` | Existing ACM cert ARN for web mobile-stage domain |
| `INFRA_EXPO_CERT_ARN_PRODUCTION` | Existing ACM cert ARN for expo prod domain |
| `INFRA_EXPO_CERT_ARN_DEV` | Existing ACM cert ARN for expo dev domain |
| `INFRA_EXPO_CERT_ARN_MOBILE` | Existing ACM cert ARN for expo mobile-stage domain |

## SST Secrets

Minimum secrets from the default template:

- `DatabaseUrl`
- `AuthSecret`

Set per stage:

```bash
npx sst secrets set DatabaseUrl "postgresql://..." --stage dev
npx sst secrets set AuthSecret "your-secret" --stage dev
```

## Pipeline Provisioning

1. Ensure your `INFRA_PIPELINES` and branch variables are correct.
2. Deploy once (`sst deploy`) from the infra package.
3. Run:

```bash
APPROVE=true bash scripts/ensure-pipelines.sh
```

This script checks for missing pipelines and creates them by running stage-specific SST deploys.
