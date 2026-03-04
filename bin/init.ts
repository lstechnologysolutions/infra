#!/usr/bin/env node

/**
 * @lsts_tech/infra — CLI Init Script
 *
 * Scaffolds project-specific configuration files for the infra package.
 * Run with: npx @lsts_tech/infra init
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATES_DIR = resolve(__dirname, "..", "..", "templates");

type PipelineStage = "production" | "dev" | "mobile";

const PIPELINE_DEFS: Record<PipelineStage, { suffix: string; defaultBranch: string }> = {
    production: { suffix: "prod", defaultBranch: "main" },
    dev: { suffix: "dev", defaultBranch: "develop" },
    mobile: { suffix: "mobile", defaultBranch: "mobile" },
};

const FILES_TO_SCAFFOLD = [
    {
        source: "sst.config.ts",
        target: "sst.config.ts",
        description: "SST app entrypoint",
    },
    {
        source: "sst-env.d.ts",
        target: "sst-env.d.ts",
        description: "SST type stubs",
    },
    {
        source: "infra.config.ts",
        target: "infra.config.ts",
        description: "Infrastructure configuration",
    },
    {
        source: "env.example",
        target: ".env.example",
        description: "Infrastructure environment template",
    },
    {
        source: "secrets.schema.json",
        target: "schemas/secrets.schema.json",
        description: "Secrets schema definition",
    },
    {
        source: "ensure-pipelines.sh",
        target: "scripts/ensure-pipelines.sh",
        description: "Pipeline management script",
    },
    {
        source: "buildspec.yml",
        target: "buildspec.yml",
        description: "CodeBuild build specification",
    },
] as const;

interface InitOptions {
    provider: "aws";
    project: string;
    domain: string;
    repo: string;
    pipelines: PipelineStage[];
    withExpo: boolean;
    appName: string;
    infraPath: string;
    targetDir: string;
    force: boolean;
}

function printHelp() {
    console.log(`
@lsts_tech/infra — init

Usage:
  npx @lsts_tech/infra init [options]

Options:
  --provider <name>      Cloud provider to target (v1.0.0 supports: aws)
  --project <slug>       Project/app prefix (default: myapp)
  --app-name <name>      SST app name (default: --project)
  --domain <domain>      Root domain (default: example.com)
  --repo <owner/repo>    GitHub repo for pipelines (default: myorg/myrepo)
  --pipelines <list>     Comma list: production,dev,mobile or 'none' (default: production,dev)
  --with-expo            Enable Expo web site defaults in scaffolded config
  --infra-path <path>    Infra path from monorepo root (default: packages/infra)
  --target <path>        Directory to scaffold into (default: current directory)
  --force                Overwrite existing files
  --help                 Show this help

Examples:
  npx @lsts_tech/infra init --project acme --domain acme.com --repo acme/web
  npx @lsts_tech/infra init --project acme --pipelines production,dev,mobile --with-expo
  npx @lsts_tech/infra init --target packages/infra --force
`);
}

function parseArgs(args: string[]) {
    const result: {
        command?: string;
        flags: Record<string, string | boolean>;
    } = { flags: {} };

    if (args.length > 0 && !args[0].startsWith("--")) {
        result.command = args[0];
        args = args.slice(1);
    }

    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (!token.startsWith("--")) {
            continue;
        }

        const trimmed = token.slice(2);
        const eqIndex = trimmed.indexOf("=");

        if (eqIndex !== -1) {
            const key = trimmed.slice(0, eqIndex);
            const value = trimmed.slice(eqIndex + 1);
            result.flags[key] = value;
            continue;
        }

        const next = args[i + 1];
        if (!next || next.startsWith("--")) {
            result.flags[trimmed] = true;
            continue;
        }

        result.flags[trimmed] = next;
        i++;
    }

    return result;
}

function readFlag(flags: Record<string, string | boolean>, key: string, fallback: string) {
    const value = flags[key];
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return fallback;
}

function readBool(flags: Record<string, string | boolean>, key: string, fallback = false) {
    const value = flags[key];
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "y"].includes(normalized)) return true;
        if (["0", "false", "no", "n"].includes(normalized)) return false;
    }
    return fallback;
}

function toSlug(value: string) {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "myapp";
}

function parsePipelines(raw: string): PipelineStage[] {
    if (raw.trim().length === 0 || raw.trim().toLowerCase() === "none") {
        return [];
    }

    const normalized = raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .map((entry) => {
            if (entry === "prod") return "production";
            return entry;
        });

    const allowed: PipelineStage[] = ["production", "dev", "mobile"];
    const invalid = normalized.filter((entry) => !allowed.includes(entry as PipelineStage));
    if (invalid.length > 0) {
        throw new Error(`Invalid pipeline stage(s): ${invalid.join(", ")}. Allowed: production,dev,mobile`);
    }

    const deduped: PipelineStage[] = [];
    for (const entry of normalized as PipelineStage[]) {
        if (!deduped.includes(entry)) {
            deduped.push(entry);
        }
    }

    return deduped;
}

function buildMapEntries(options: InitOptions, kind: "stage" | "repo" | "branch") {
    if (options.pipelines.length === 0) {
        return "  # no pipelines configured";
    }

    return options.pipelines
        .map((pipeline) => {
            const def = PIPELINE_DEFS[pipeline];
            const name = `${options.project}-${def.suffix}`;

            if (kind === "stage") {
                return `  ["${name}"]="${pipeline}"`;
            }
            if (kind === "repo") {
                return `  ["${name}"]="${options.repo}"`;
            }

            const branchFlag =
                pipeline === "production"
                    ? "branch-prod"
                    : pipeline === "dev"
                      ? "branch-dev"
                      : "branch-mobile";

            return `  ["${name}"]="__${branchFlag.toUpperCase().replace(/-/g, "_")}__"`;
        })
        .join("\n");
}

function applyTemplate(content: string, replacements: Record<string, string>) {
    let output = content;
    for (const [key, value] of Object.entries(replacements)) {
        output = output.split(key).join(value);
    }
    return output;
}

function buildReplacements(options: InitOptions): Record<string, string> {
    return {
        "__PROVIDER__": options.provider,
        "__PROJECT_PREFIX__": options.project,
        "__APP_NAME__": options.appName,
        "__ROOT_DOMAIN__": options.domain,
        "__PIPELINE_REPO__": options.repo,
        "__PIPELINES_DEFAULT__": options.pipelines.join(","),
        "__ENABLE_EXPO_SITE__": options.withExpo ? "true" : "false",
        "__INFRA_PATH__": options.infraPath,
        "__PIPELINE_STAGE_MAP__": buildMapEntries(options, "stage"),
        "__PIPELINE_REPO_MAP__": buildMapEntries(options, "repo"),
        "__PIPELINE_BRANCH_MAP__": buildMapEntries(options, "branch"),
    };
}

function main() {
    const parsed = parseArgs(process.argv.slice(2));

    if (!parsed.command || parsed.command === "help" || parsed.flags.help) {
        printHelp();
        process.exit(0);
    }

    if (parsed.command !== "init") {
        console.error(`Unknown command: ${parsed.command}`);
        printHelp();
        process.exit(1);
    }

    const providerRaw = readFlag(parsed.flags, "provider", "aws").toLowerCase();
    if (providerRaw !== "aws") {
        console.error(`Unsupported provider: ${providerRaw}. v1.0.0 currently supports only aws.`);
        process.exit(1);
    }

    const project = toSlug(readFlag(parsed.flags, "project", "myapp"));
    const appName = readFlag(parsed.flags, "app-name", project);
    const domain = readFlag(parsed.flags, "domain", "example.com");
    const repo = readFlag(parsed.flags, "repo", "myorg/myrepo");
    const infraPath = readFlag(parsed.flags, "infra-path", "packages/infra");
    const withExpo = readBool(parsed.flags, "with-expo", false);
    const force = readBool(parsed.flags, "force", false);

    const branchProd = readFlag(parsed.flags, "branch-prod", PIPELINE_DEFS.production.defaultBranch);
    const branchDev = readFlag(parsed.flags, "branch-dev", PIPELINE_DEFS.dev.defaultBranch);
    const branchMobile = readFlag(parsed.flags, "branch-mobile", PIPELINE_DEFS.mobile.defaultBranch);

    const pipelinesRaw = readFlag(parsed.flags, "pipelines", "production,dev");
    let pipelines: PipelineStage[];
    try {
        pipelines = parsePipelines(pipelinesRaw);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
        return;
    }

    const targetRaw = readFlag(parsed.flags, "target", ".");
    const targetDir = resolve(process.cwd(), targetRaw);

    const options: InitOptions = {
        provider: "aws",
        project,
        domain,
        repo,
        pipelines,
        withExpo,
        appName,
        infraPath,
        targetDir,
        force,
    };

    const replacements: Record<string, string> = buildReplacements(options);
    replacements["__BRANCH_PROD__"] = branchProd;
    replacements["__BRANCH_DEV__"] = branchDev;
    replacements["__BRANCH_MOBILE__"] = branchMobile;

    console.log("\n🚀 @lsts_tech/infra — initializing white-label AWS scaffolding\n");
    console.log(`  provider   : ${options.provider}`);
    console.log(`  targetDir  : ${options.targetDir}`);
    console.log(`  project    : ${options.project}`);
    console.log(`  appName    : ${options.appName}`);
    console.log(`  domain     : ${options.domain}`);
    console.log(`  repo       : ${options.repo}`);
    console.log(`  pipelines  : ${options.pipelines.join(",") || "none"}`);
    console.log(`  expo site  : ${options.withExpo ? "enabled" : "disabled"}`);
    console.log("");

    let created = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const file of FILES_TO_SCAFFOLD) {
        const sourcePath = join(TEMPLATES_DIR, file.source);
        const targetPath = join(options.targetDir, file.target);

        const exists = existsSync(targetPath);
        if (exists && !options.force) {
            console.log(`  ⏭  ${file.target} — already exists (skipped)`);
            skipped++;
            continue;
        }

        const targetParent = dirname(targetPath);
        if (!existsSync(targetParent)) {
            mkdirSync(targetParent, { recursive: true });
        }

        const raw = readFileSync(sourcePath, "utf-8");
        const content = applyTemplate(raw, replacements);
        writeFileSync(targetPath, content, "utf-8");

        if (file.target.endsWith(".sh")) {
            chmodSync(targetPath, 0o755);
        }

        if (exists) {
            console.log(`  ♻️  ${file.target} — ${file.description} (overwritten)`);
            overwritten++;
        } else {
            console.log(`  ✅ ${file.target} — ${file.description}`);
            created++;
        }
    }

    console.log(`\n📦 Done! Created ${created}, overwritten ${overwritten}, skipped ${skipped}.\n`);

    console.log("Next steps:");
    console.log("  1. Review .env.example and copy values into your deployment environment");
    console.log("  2. Set your SST secrets (npx sst secrets set <Name> <value> --stage <stage>)");
    console.log("  3. Run your first deploy (npx sst deploy --stage dev)");
    console.log("  4. Optionally ensure pipelines (APPROVE=true bash scripts/ensure-pipelines.sh)");
    console.log("");
}

main();
