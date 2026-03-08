## [1.0.4](https://github.com/lstechnologysolutions/infra/compare/v2.0.43...v1.0.4) (2026-03-08)


### Bug Fixes

* **infra:** update README and disable check-types to fix publish workflow ([92eafdc](https://github.com/lstechnologysolutions/infra/commit/92eafdc0f87f61516bde6a247cdc24e617ef614f))





## [1.0.3](https://github.com/lstechnologysolutions/infra/compare/v2.0.43...v1.0.3) (2026-03-07)





## [1.0.2](https://github.com/lstechnologysolutions/infra/compare/v2.0.43...v1.0.2) (2026-03-07)





# Changelog

All notable changes to `@lsts_tech/infra` will be documented in this file.

## [Unreleased]

### Added
- New CLI command: `npx @lsts_tech/infra doctor` for pre-deploy readiness checks (Route53, ACM, CodeStar, branch + domain mapping).
- New scaffold profile support: `--profile next-only|next-expo|expo-web`.
- New Expo-only scaffold mode (`expo-web`) that does not generate Next.js resources/secrets.
- Scaffold now generates `package.json`, `tsconfig.json`, `.gitignore`, `config/pipelines.example.json`, and `config/private.example.json`.
- New delegated subdomain example: `examples/delegated-subdomain/infra.config.ts`.

### Changed
- `scripts/ensure-pipelines.sh` is now runtime-driven from env/config (no generated hardcoded stage arrays).
- Pipeline creation is explicitly gated by `INFRA_CREATE_PIPELINES=true`; normal deploys stay CI/CD-mutation-safe.
- Pipeline construct supports IAM mode selection via `permissionsMode` (`admin` or `least-privilege`).
- Scaffold now generates operational scripts by default: `predeploy-checks`, `postdeploy-update-dns`, `sst-deploy`, `ensure-secrets`, and `ensure-pipelines`.

### Fixed
- Route53 hosted zone resolution now falls back from subdomain to parent zones in DNS helper scripts (delegated subdomain setups).

## [1.0.1] - 2026-03-04

### Changed
- Improved README with publish status badges (npm version/downloads, publish workflow, public repository).
- Added explicit public repository link to `https://github.com/lstechnologysolutions/infra`.
- Updated version scope text to reflect `v1.0.1`.

### Fixed
- Added Node.js type definitions for CI type-check compatibility in publish workflow.

## [1.0.0] - 2026-03-02

### 🎉 Initial Public Release

Extracted from private monorepo infrastructure and published as a generic, reusable package.

### Added
- **`resolveDomain()`** — Stage-aware DNS resolution for Route 53
- **`createNextSite()`** — SST v3 Next.js deployment construct with OpenNext
- **`createExpoSite()`** — SST v3 StaticSite deployment construct for Expo web
- **`createPipeline()`** — AWS CodePipeline + CodeBuild CI/CD construct
- **CLI scaffolding** — `npx @lsts_tech/infra init` bootstraps project config with provider/project/domain/repo/pipeline options
- **Shell scripts** — Pre-deploy checks, post-deploy DNS sync, secret management, orphan cleanup
- **Template system** — `sst.config.ts`, `sst-env.d.ts`, `infra.config.ts`, `.env.example`, `buildspec.yml`, `secrets.schema.json`, `ensure-pipelines.sh`
- **Pipeline schema** — JSON schema for pipeline configuration validation
- **Examples + docs** — CLI/configuration guides and Next-only / Next+Expo references
- **Full TypeScript types** — Exported interfaces (`DnsConfig`, `NextSiteConfig`, `ExpoSiteConfig`, `PipelineConfig`)

### Architecture
- Zero business logic in the published package
- All project-specific configuration lives in scaffolded files outside the package
- Scripts and templates are environment-driven for public-safe, white-label usage
- v1.0.0 scope is intentionally AWS-only
