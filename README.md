# @lsts_tech/infra

[![npm version](https://img.shields.io/npm/v/%40lsts_tech%2Finfra?label=npm&color=cb3837)](https://www.npmjs.com/package/@lsts_tech/infra)
[![npm downloads](https://img.shields.io/npm/dm/%40lsts_tech%2Finfra?label=downloads)](https://www.npmjs.com/package/@lsts_tech/infra)
[![Publish workflow](https://github.com/lstechnologysolutions/lstech.solutions/actions/workflows/publish-infra.yml/badge.svg)](https://github.com/lstechnologysolutions/lstech.solutions/actions/workflows/publish-infra.yml)
[![Public repository](https://img.shields.io/badge/public%20repo-lstechnologysolutions%2Finfra-181717?logo=github)](https://github.com/lstechnologysolutions/infra)

Reusable, white-label SST v3 infrastructure primitives for AWS monorepo deployments.

Public repository: [https://github.com/lstechnologysolutions/infra](https://github.com/lstechnologysolutions/infra)

## What It Supports

- AWS provider (v1.x)
- Next.js and Expo Web deployments
- `expo-web` scaffold mode (no Next.js resources/secrets)
- Runtime-driven pipeline definitions (env + optional `config/pipelines.json`)
- Explicit pipeline mutation gate (`INFRA_CREATE_PIPELINES=true`)
- `doctor` readiness checks (`npx @lsts_tech/infra doctor`)
- Optional pipeline IAM mode: `admin` or `least-privilege`
- Hosted-zone parent fallback support for delegated subdomains

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
  --profile next-expo \
  --pipelines production,dev,mobile
```

Expo-only setup:

```bash
npx @lsts_tech/infra init \
  --project myapp \
  --domain example.com \
  --repo myorg/mobile \
  --profile expo-web \
  --pipelines production,mobile
```

### 2. Review generated files

- `sst.config.ts`
- `sst-env.d.ts`
- `infra.config.ts`
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

### 3. Configure environment and secrets

```bash
cp .env.example .env
```

Set minimum SST secrets for Next.js profiles:

```bash
npx sst secret set DatabaseUrl "postgresql://..." --stage dev
npx sst secret set AuthSecret "replace-me" --stage dev
```

### 4. Validate setup

```bash
npx @lsts_tech/infra doctor --target .
```

### 5. Deploy app infrastructure

```bash
npx sst deploy --stage dev
npx sst deploy --stage production
```

### 6. Create/update pipelines explicitly

```bash
APPROVE=true bash scripts/ensure-pipelines.sh
```

## CLI

```bash
npx @lsts_tech/infra <command> [options]
```

Commands:

- `init` — scaffold infra project files
- `doctor` — validate Route53/ACM/CodeStar/branch/domain config before deploy

Full reference: [docs/CLI.md](./docs/CLI.md)

## API

- `resolveDomain(config: DnsConfig): DomainResult`
- `createNextSite(config: NextSiteConfig): { site, url }`
- `createExpoSite(config: ExpoSiteConfig): { site, url }`
- `createPipeline(config: PipelineConfig): PipelineResult`

## Docs and Examples

- Configuration guide: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)
- CLI reference: [docs/CLI.md](./docs/CLI.md)
- Example index: [docs/EXAMPLES.md](./docs/EXAMPLES.md)
- Next-only example: [examples/next-only/infra.config.ts](./examples/next-only/infra.config.ts)
- Next + Expo example: [examples/next-and-expo/infra.config.ts](./examples/next-and-expo/infra.config.ts)
- Delegated subdomain example: [examples/delegated-subdomain/infra.config.ts](./examples/delegated-subdomain/infra.config.ts)

## Publish Checklist

Before publishing to npm:

1. `npm run build`
2. `npm run check-types`
3. `npm pack --dry-run`
4. Verify tarball contains no private state/secrets (`.env`, `.sst`, Pulumi state)

## License

MIT © LSTS Solutions

## 📋 Latest Changes (v1.0.4)

### Bug Fixes

* **infra:** update README and disable check-types to fix publish workflow ([92eafdc](https://github.com/lstechnologysolutions/infra/commit/92eafdc0f87f61516bde6a247cdc24e617ef614f))

For full version history, see [CHANGELOG.md](./CHANGELOG.md) and [GitHub releases](https://github.com/edcalderon/my-second-brain/releases)
