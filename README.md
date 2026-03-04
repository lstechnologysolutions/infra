# @lsts_tech/infra

Reusable, white-label SST v3 infrastructure primitives for AWS deployments from monorepos.

`@lsts_tech/infra` focuses on portability:

- No hardcoded project domains/repos in package code
- Environment-driven scaffolding for public repositories
- CLI bootstrap for consistent setup (`npx @lsts_tech/infra init`)
- Next.js (`sst.aws.Nextjs`) and Expo Web (`sst.aws.StaticSite`) support
- AWS CodePipeline + CodeBuild CI/CD helpers

## Version Scope

`v1.0.0` provider support: **AWS only**.

## Install

```bash
npm install @lsts_tech/infra
# or
pnpm add @lsts_tech/infra
```

## Quick Start

### 1. Scaffold infra files

```bash
npx @lsts_tech/infra init \
  --project myapp \
  --domain example.com \
  --repo myorg/myrepo \
  --pipelines production,dev
```

Optional Expo support:

```bash
npx @lsts_tech/infra init \
  --project myapp \
  --domain example.com \
  --repo myorg/myrepo \
  --pipelines production,dev,mobile \
  --with-expo
```

### 2. Review generated files

- `sst.config.ts`
- `sst-env.d.ts`
- `infra.config.ts`
- `.env.example`
- `buildspec.yml`
- `schemas/secrets.schema.json`
- `scripts/ensure-pipelines.sh`

### 3. Configure environment and secrets

Use `.env.example` as the variable contract for your CI/local environment.

Set minimum SST secrets:

```bash
npx sst secrets set DatabaseUrl "postgresql://..." --stage dev
npx sst secrets set AuthSecret "replace-me" --stage dev
```

### 4. Deploy

```bash
npx sst deploy --stage dev
npx sst deploy --stage production
```

### 5. Ensure pipelines

```bash
APPROVE=true bash scripts/ensure-pipelines.sh
```

## CLI

### `init`

```bash
npx @lsts_tech/infra init [options]
```

| Option | Description | Default |
|---|---|---|
| `--provider <name>` | Cloud provider (`aws`) | `aws` |
| `--project <slug>` | Project/app prefix | `myapp` |
| `--app-name <name>` | SST app name | `--project` |
| `--domain <domain>` | Root domain | `example.com` |
| `--repo <owner/repo>` | GitHub repo for pipeline source | `myorg/myrepo` |
| `--pipelines <list>` | `production,dev,mobile` CSV or `none` | `production,dev` |
| `--branch-prod <branch>` | Production branch | `main` |
| `--branch-dev <branch>` | Dev branch | `develop` |
| `--branch-mobile <branch>` | Mobile branch | `mobile` |
| `--with-expo` | Enable Expo scaffold defaults | `false` |
| `--infra-path <path>` | Infra path from monorepo root | `packages/infra` |
| `--target <path>` | Output directory | `.` |
| `--force` | Overwrite existing files | `false` |

Full CLI docs: [docs/CLI.md](./docs/CLI.md)

## API Reference

### `resolveDomain(config: DnsConfig): DomainResult`

Stage-aware domain resolution.

### `createNextSite(config: NextSiteConfig): { site, url }`

Creates an SST `aws.Nextjs` deployment.

### `createExpoSite(config: ExpoSiteConfig): { site, url }`

Creates an SST `aws.StaticSite` deployment for Expo web exports.

### `createPipeline(config: PipelineConfig): PipelineResult`

Creates an AWS CodePipeline + CodeBuild deployment pipeline.

## Scripts Included

| Script | Purpose |
|---|---|
| `scripts/predeploy-checks.sh` | DNS/CloudFront/ACM pre-deploy checks |
| `scripts/postdeploy-update-dns.sh` | Route53 alias synchronization |
| `scripts/ensure-secrets.sh` | SST secret provisioning from schema |
| `scripts/sst-deploy.sh` | CI-safe SST deploy wrapper |
| `scripts/ensure-pipelines.sh` | Ensure configured pipelines exist |
| `scripts/pulumi-deploy.sh` | CI-safe Pulumi deploy wrapper |
| `scripts/cleanup-orphan-lambdas.sh` | Cleanup stale Lambda functions |
| `scripts/delete-amplify-app.sh` | Remove legacy Amplify apps |

## Examples and Docs

- Configuration guide: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)
- CLI guide: [docs/CLI.md](./docs/CLI.md)
- Example index: [docs/EXAMPLES.md](./docs/EXAMPLES.md)
- Next-only example: [examples/next-only/infra.config.ts](./examples/next-only/infra.config.ts)
- Next + Expo example: [examples/next-and-expo/infra.config.ts](./examples/next-and-expo/infra.config.ts)

## Publish Checklist

Before publishing to npm:

1. `npm run build`
2. `npm run check-types`
3. `npm pack --dry-run`
4. Verify tarball has no project-private infra/state files

## License

MIT © LSTS Solutions
