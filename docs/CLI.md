# CLI Reference

`@lsts_tech/infra` ships with a bootstrap CLI:

```bash
npx @lsts_tech/infra <command> [options]
```

Provider support in v1.x: AWS only.

## Commands

## `init`

Scaffolds white-label infra files for your project.

```bash
npx @lsts_tech/infra init [options]
```

| Option | Description | Default |
|---|---|---|
| `--provider <name>` | Cloud provider (`aws`) | `aws` |
| `--project <slug>` | Project prefix for app/pipelines/tags | `myapp` |
| `--app-name <name>` | SST app name | `--project` |
| `--domain <domain>` | Root domain | `example.com` |
| `--repo <owner/repo>` | GitHub repo for pipeline source | `myorg/myrepo` |
| `--pipelines <list>` | CSV: `production,dev,mobile` or `none` | `production,dev` |
| `--branch-prod <branch>` | Production pipeline branch | `master` |
| `--branch-dev <branch>` | Dev pipeline branch | `develop` |
| `--branch-mobile <branch>` | Mobile pipeline branch | `mobile` |
| `--profile <name>` | `next-only` \| `next-expo` \| `expo-web` | `next-only` |
| `--with-expo` | Legacy shorthand for `--profile next-expo` | `false` |
| `--pipeline-permissions <mode>` | `admin` \| `least-privilege` | `admin` |
| `--infra-path <path>` | Infra path from monorepo root | `packages/infra` |
| `--target <path>` | Scaffold destination directory | `.` |
| `--force` | Overwrite existing files | `false` |
| `--help` | Print help | - |

### Generated files

- `sst.config.ts`
- `sst-env.d.ts`
- `infra.config.ts` (profile-driven)
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `buildspec.yml`
- `schemas/secrets.schema.json`
- `scripts/ensure-pipelines.sh`
- `scripts/predeploy-checks.sh`
- `scripts/postdeploy-update-dns.sh`
- `scripts/sst-deploy.sh`
- `scripts/ensure-secrets.sh`
- `config/pipelines.example.json`
- `config/private.example.json`

## `doctor`

Validates Route53 zone resolution, ACM readiness, CodeStar connections,
branch config, and stage-domain mapping before deploy.

```bash
npx @lsts_tech/infra doctor [options]
```

| Option | Description | Default |
|---|---|---|
| `--target <path>` | Infra directory to inspect | `.` |
| `--region <aws-region>` | Region hint for checks | `AWS_REGION` or `us-east-1` |
| `--strict` | Treat warnings as failures | `false` |
| `--help` | Print help | - |

## Example Commands

```bash
# Next.js only + production/dev pipelines
npx @lsts_tech/infra init \
  --project acme \
  --domain acme.com \
  --repo acme/web \
  --profile next-only

# Next.js + Expo + mobile pipeline
npx @lsts_tech/infra init \
  --project acme \
  --domain acme.com \
  --repo acme/web \
  --profile next-expo \
  --pipelines production,dev,mobile

# Expo-only scaffold (no Next.js secrets/resources)
npx @lsts_tech/infra init \
  --project acme-mobile \
  --domain acme.com \
  --repo acme/mobile \
  --profile expo-web

# Validate an existing infra package setup
npx @lsts_tech/infra doctor --target packages/infra --strict
```
