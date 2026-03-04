# CLI Reference

The package ships with a bootstrap CLI:

```bash
npx @lsts_tech/infra init [options]
```

Provider support in v1.0.0: AWS only.

## Options

| Option | Description | Default |
|---|---|---|
| `--provider <name>` | Cloud provider (`aws`) | `aws` |
| `--project <slug>` | Project prefix for app/pipelines/tags | `myapp` |
| `--app-name <name>` | SST app name | `--project` |
| `--domain <domain>` | Root domain | `example.com` |
| `--repo <owner/repo>` | GitHub repo for CodePipeline source | `myorg/myrepo` |
| `--pipelines <list>` | Comma list: `production,dev,mobile` or `none` | `production,dev` |
| `--branch-prod <branch>` | Production pipeline branch | `main` |
| `--branch-dev <branch>` | Dev pipeline branch | `develop` |
| `--branch-mobile <branch>` | Mobile pipeline branch | `mobile` |
| `--with-expo` | Enable Expo web deployment defaults | `false` |
| `--infra-path <path>` | Infra path from monorepo root | `packages/infra` |
| `--target <path>` | Scaffold destination directory | `.` |
| `--force` | Overwrite existing files | `false` |
| `--help` | Print help | - |

## Generated Files

- `sst.config.ts`
- `sst-env.d.ts`
- `infra.config.ts`
- `.env.example`
- `buildspec.yml`
- `schemas/secrets.schema.json`
- `scripts/ensure-pipelines.sh`

## Example Commands

```bash
# Next.js only, production+dev pipelines
npx @lsts_tech/infra init \
  --project acme \
  --domain acme.com \
  --repo acme/web

# Next.js + Expo Web + mobile pipeline
npx @lsts_tech/infra init \
  --project acme \
  --domain acme.com \
  --repo acme/web \
  --with-expo \
  --pipelines production,dev,mobile

# Re-generate into packages/infra and overwrite existing files
npx @lsts_tech/infra init --target packages/infra --force
```
