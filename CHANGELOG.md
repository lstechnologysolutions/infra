# Changelog

All notable changes to `@lsts_tech/infra` will be documented in this file.

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
