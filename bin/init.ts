#!/usr/bin/env node

/**
 * @lsts_tech/infra — CLI
 *
 * Commands:
 * - init: scaffold white-label infra files
 * - doctor: validate AWS/domain/pipeline readiness before deploy
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const TEMPLATES_DIR = resolve(PACKAGE_ROOT, "templates");
const SCRIPTS_DIR = resolve(PACKAGE_ROOT, "scripts");

type PipelineStage = "production" | "dev" | "mobile";
type ScaffoldProfile = "next-only" | "next-expo" | "expo-web";
type Provider = "aws";

type DoctorStatus = "PASS" | "WARN" | "FAIL";

const PIPELINE_DEFS: Record<PipelineStage, { suffix: string; defaultBranch: string }> = {
  production: { suffix: "prod", defaultBranch: "master" },
  dev: { suffix: "dev", defaultBranch: "develop" },
  mobile: { suffix: "mobile", defaultBranch: "mobile" },
};

const PROFILE_TEMPLATES: Record<ScaffoldProfile, string> = {
  "next-only": "infra.config.next-only.ts",
  "next-expo": "infra.config.ts",
  "expo-web": "infra.config.expo-web.ts",
};

interface InitOptions {
  provider: Provider;
  project: string;
  domain: string;
  repo: string;
  pipelines: PipelineStage[];
  profile: ScaffoldProfile;
  appName: string;
  infraPath: string;
  targetDir: string;
  force: boolean;
  pipelinePermissionsMode: "admin" | "least-privilege";
}

interface ScaffoldFile {
  sourceDir: "templates" | "scripts";
  source: string;
  target: string;
  description: string;
  executable?: boolean;
  templated?: boolean;
}

interface DoctorResult {
  status: DoctorStatus;
  label: string;
  detail: string;
}

interface ParsedArgs {
  command?: string;
  flags: Record<string, string | boolean>;
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // best-effort fallback
  }

  return "1.0.1";
}

function printHelp() {
  console.log(`
@lsts_tech/infra — CLI

Usage:
  npx @lsts_tech/infra <command> [options]

Commands:
  init      Scaffold environment-driven infra files
  doctor    Validate AWS/domain/pipeline readiness

Init options:
  --provider <name>              Cloud provider (v1 supports: aws)
  --project <slug>               Project/app prefix (default: myapp)
  --app-name <name>              SST app name (default: --project)
  --domain <domain>              Root domain (default: example.com)
  --repo <owner/repo>            GitHub repo for pipelines (default: myorg/myrepo)
  --pipelines <list>             CSV: production,dev,mobile or 'none' (default: production,dev)
  --profile <name>               next-only | next-expo | expo-web (default: next-only)
  --with-expo                    Legacy shorthand for --profile next-expo
  --pipeline-permissions <mode>  admin | least-privilege (default: admin)
  --infra-path <path>            Infra path from monorepo root (default: packages/infra)
  --target <path>                Directory to scaffold into (default: current directory)
  --force                        Overwrite existing files

Doctor options:
  --target <path>                Infra directory to inspect (default: current directory)
  --region <aws-region>          AWS region hint for checks (default: AWS_REGION or us-east-1)
  --strict                       Fail if warnings exist

Examples:
  npx @lsts_tech/infra init --project acme --domain acme.com --repo acme/web
  npx @lsts_tech/infra init --project acme --profile expo-web --pipelines production,mobile
  npx @lsts_tech/infra doctor --target packages/infra --strict
`);
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = { flags: {} };

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

function parseProfile(raw: string): ScaffoldProfile {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "next" || normalized === "next-only") return "next-only";
  if (normalized === "next-expo" || normalized === "next+expo") return "next-expo";
  if (normalized === "expo" || normalized === "expo-web") return "expo-web";
  throw new Error(`Invalid profile: ${raw}. Allowed: next-only,next-expo,expo-web`);
}

function parsePipelinePermissionsMode(raw: string): "admin" | "least-privilege" {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "least-privilege" || normalized === "least_privilege") return "least-privilege";
  throw new Error(`Invalid pipeline permissions mode: ${raw}. Allowed: admin,least-privilege`);
}

function applyTemplate(content: string, replacements: Record<string, string>) {
  let output = content;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(key).join(value);
  }
  return output;
}

function getScaffoldFiles(profile: ScaffoldProfile): ScaffoldFile[] {
  const files: ScaffoldFile[] = [
    {
      sourceDir: "templates",
      source: "sst.config.ts",
      target: "sst.config.ts",
      description: "SST app entrypoint",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "sst-env.d.ts",
      target: "sst-env.d.ts",
      description: "SST type stubs",
      templated: false,
    },
    {
      sourceDir: "templates",
      source: PROFILE_TEMPLATES[profile],
      target: "infra.config.ts",
      description: "Infrastructure configuration",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "env.example",
      target: ".env.example",
      description: "Infrastructure environment template",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: profile === "expo-web" ? "secrets.schema.expo-web.json" : "secrets.schema.json",
      target: "schemas/secrets.schema.json",
      description: "Secrets schema definition",
      templated: false,
    },
    {
      sourceDir: "templates",
      source: "ensure-pipelines.sh",
      target: "scripts/ensure-pipelines.sh",
      description: "Pipeline management script",
      executable: true,
      templated: true,
    },
    {
      sourceDir: "scripts",
      source: "predeploy-checks.sh",
      target: "scripts/predeploy-checks.sh",
      description: "Pre-deploy checks",
      executable: true,
      templated: false,
    },
    {
      sourceDir: "scripts",
      source: "postdeploy-update-dns.sh",
      target: "scripts/postdeploy-update-dns.sh",
      description: "Post-deploy DNS sync script",
      executable: true,
      templated: false,
    },
    {
      sourceDir: "scripts",
      source: "sst-deploy.sh",
      target: "scripts/sst-deploy.sh",
      description: "CI-safe SST deploy wrapper",
      executable: true,
      templated: false,
    },
    {
      sourceDir: "scripts",
      source: "ensure-secrets.sh",
      target: "scripts/ensure-secrets.sh",
      description: "Secret bootstrap script",
      executable: true,
      templated: false,
    },
    {
      sourceDir: "templates",
      source: "buildspec.yml",
      target: "buildspec.yml",
      description: "CodeBuild build specification",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "scaffold.package.json",
      target: "package.json",
      description: "Infra package manifest",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "scaffold.tsconfig.json",
      target: "tsconfig.json",
      description: "Infra TypeScript configuration",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "scaffold.gitignore",
      target: ".gitignore",
      description: "Infra gitignore template",
      templated: false,
    },
    {
      sourceDir: "templates",
      source: "pipelines.example.json",
      target: "config/pipelines.example.json",
      description: "Runtime pipeline config example",
      templated: true,
    },
    {
      sourceDir: "templates",
      source: "private.example.json",
      target: "config/private.example.json",
      description: "Private local config example",
      templated: true,
    },
  ];

  return files;
}

function buildReplacements(options: InitOptions): Record<string, string> {
  const infraVersion = readPackageVersion();
  return {
    "__PROVIDER__": options.provider,
    "__PROJECT_PREFIX__": options.project,
    "__APP_NAME__": options.appName,
    "__ROOT_DOMAIN__": options.domain,
    "__PIPELINE_REPO__": options.repo,
    "__PIPELINES_DEFAULT__": options.pipelines.join(","),
    "__ENABLE_EXPO_SITE__": options.profile === "next-expo" || options.profile === "expo-web" ? "true" : "false",
    "__PROFILE__": options.profile,
    "__INFRA_PATH__": options.infraPath,
    "__CREATE_PIPELINES_DEFAULT__": "false",
    "__PIPELINE_PERMISSIONS_MODE__": options.pipelinePermissionsMode,
    "__INFRA_VERSION__": `^${infraVersion}`,
  };
}

function commandExists(name: string): boolean {
  const check = spawnSync("bash", ["-lc", `command -v ${name}`], {
    stdio: "ignore",
  });
  return check.status === 0;
}

function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) {
    return {};
  }

  const raw = readFileSync(envPath, "utf-8");
  const output: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2].trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    output[key] = value;
  }

  return output;
}

function runCommand(binary: string, args: string[], cwd: string) {
  return spawnSync(binary, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runAwsJson(args: string[], cwd: string) {
  const result = runCommand("aws", [...args, "--output", "json"], cwd);
  if (result.status !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return null;
  }
}

function domainCandidates(domain: string): string[] {
  const labels = domain
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);

  if (labels.length < 2) {
    return [domain.replace(/\.$/, "")];
  }

  const candidates: string[] = [];
  for (let index = 0; index <= labels.length - 2; index++) {
    candidates.push(labels.slice(index).join("."));
  }

  return Array.from(new Set(candidates));
}

function findHostedZone(domain: string, cwd: string) {
  for (const candidate of domainCandidates(domain)) {
    const zones = runAwsJson(["route53", "list-hosted-zones-by-name", "--dns-name", candidate], cwd);
    const hostedZones = Array.isArray(zones?.HostedZones) ? zones.HostedZones : [];

    for (const zone of hostedZones) {
      const zoneName = String(zone?.Name ?? "").replace(/\.$/, "").toLowerCase();
      if (zoneName !== candidate.toLowerCase()) {
        continue;
      }

      const zoneIdRaw = String(zone?.Id ?? "");
      const zoneId = zoneIdRaw.replace("/hostedzone/", "");
      return {
        requested: domain,
        matchedCandidate: candidate,
        zoneName,
        zoneId,
      };
    }
  }

  return null;
}

function isLikelyRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function isBoolTrue(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function wildcardMatch(certDomain: string, domain: string) {
  const normalizedCert = certDomain.toLowerCase();
  const normalizedDomain = domain.toLowerCase();

  if (normalizedCert === normalizedDomain) {
    return true;
  }

  if (!normalizedCert.startsWith("*.")) {
    return false;
  }

  const certSuffix = normalizedCert.slice(1); // ".example.com"
  if (!normalizedDomain.endsWith(certSuffix)) {
    return false;
  }

  // Wildcard should match one additional label at minimum.
  const certLabelCount = normalizedCert.split(".").length;
  const domainLabelCount = normalizedDomain.split(".").length;
  return domainLabelCount >= certLabelCount;
}

function addDoctorResult(results: DoctorResult[], status: DoctorStatus, label: string, detail: string) {
  results.push({ status, label, detail });
  const icon = status === "PASS" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} ${label}: ${detail}`);
}

function runDoctor(flags: Record<string, string | boolean>) {
  const targetRaw = readFlag(flags, "target", ".");
  const targetDir = resolve(process.cwd(), targetRaw);
  const strict = readBool(flags, "strict", false);
  const region = readFlag(flags, "region", process.env.AWS_REGION ?? "us-east-1");

  const envFromFile = parseEnvFile(join(targetDir, ".env"));
  const env: Record<string, string> = {
    ...envFromFile,
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, value]) => [key, value])
    ),
  };

  const rootDomain = env.INFRA_ROOT_DOMAIN ?? env.DOMAIN_ROOT ?? "";
  const pipelineRepo = env.INFRA_PIPELINE_REPO ?? "";
  const pipelinePrefix = env.INFRA_PIPELINE_PREFIX ?? "myapp";
  let selectedPipelines: PipelineStage[] = [];
  try {
    selectedPipelines = parsePipelines(env.INFRA_PIPELINES ?? "production,dev");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }
  const enableExpo = isBoolTrue(env.INFRA_ENABLE_EXPO_SITE, false) || env.INFRA_PROFILE === "expo-web";

  const webStageMap: Record<PipelineStage, string> = {
    production: env.INFRA_WEB_DOMAIN_PRODUCTION ?? rootDomain,
    dev: env.INFRA_WEB_DOMAIN_DEV ?? (rootDomain ? `dev.${rootDomain}` : ""),
    mobile: env.INFRA_WEB_DOMAIN_MOBILE ?? (rootDomain ? `api.${rootDomain}` : ""),
  };

  const expoStageMap: Record<PipelineStage, string> = {
    production: env.INFRA_EXPO_DOMAIN_PRODUCTION ?? (rootDomain ? `mobile.${rootDomain}` : ""),
    dev: env.INFRA_EXPO_DOMAIN_DEV ?? (rootDomain ? `dev.mobile.${rootDomain}` : ""),
    mobile: env.INFRA_EXPO_DOMAIN_MOBILE ?? (rootDomain ? `preview.mobile.${rootDomain}` : ""),
  };

  const results: DoctorResult[] = [];

  console.log("\n🩺 @lsts_tech/infra doctor\n");
  console.log(`target : ${targetDir}`);
  console.log(`region : ${region}`);

  if (!existsSync(targetDir)) {
    console.error(`Target directory does not exist: ${targetDir}`);
    process.exit(1);
  }

  if (!rootDomain) {
    addDoctorResult(results, "FAIL", "Root domain", "INFRA_ROOT_DOMAIN (or DOMAIN_ROOT) is required.");
  } else {
    addDoctorResult(results, "PASS", "Root domain", rootDomain);
  }

  if (!pipelineRepo) {
    addDoctorResult(results, "WARN", "Pipeline repo", "INFRA_PIPELINE_REPO is not set.");
  } else if (!isLikelyRepo(pipelineRepo)) {
    addDoctorResult(results, "WARN", "Pipeline repo", `Unexpected format: ${pipelineRepo} (expected owner/repo).`);
  } else {
    addDoctorResult(results, "PASS", "Pipeline repo", pipelineRepo);
  }

  const permissionsMode = env.INFRA_PIPELINE_PERMISSIONS_MODE ?? "admin";
  if (permissionsMode !== "admin" && permissionsMode !== "least-privilege") {
    addDoctorResult(
      results,
      "FAIL",
      "Pipeline permissions mode",
      `Invalid value '${permissionsMode}'. Allowed: admin, least-privilege.`
    );
  } else {
    addDoctorResult(results, "PASS", "Pipeline permissions mode", permissionsMode);
  }

  if (!commandExists("aws")) {
    addDoctorResult(results, "FAIL", "AWS CLI", "aws CLI is not installed or not in PATH.");
  } else {
    const sts = runAwsJson(["sts", "get-caller-identity"], targetDir);
    if (!sts?.Account) {
      addDoctorResult(results, "FAIL", "AWS auth", "Unable to call sts:get-caller-identity with current credentials.");
    } else {
      addDoctorResult(
        results,
        "PASS",
        "AWS auth",
        `Authenticated as account ${String(sts.Account)} (${String(sts.Arn ?? "unknown")})`
      );
    }
  }

  const stageDomainPairs: Array<{ stage: PipelineStage; kind: "web" | "expo"; domain: string }> = [];
  for (const stage of ["production", "dev", "mobile"] as const) {
    if (webStageMap[stage]) {
      stageDomainPairs.push({ stage, kind: "web", domain: webStageMap[stage] });
    }

    if (enableExpo && expoStageMap[stage]) {
      stageDomainPairs.push({ stage, kind: "expo", domain: expoStageMap[stage] });
    }
  }

  const duplicates = new Map<string, number>();
  for (const entry of stageDomainPairs) {
    duplicates.set(entry.domain, (duplicates.get(entry.domain) ?? 0) + 1);

    if (!rootDomain || entry.domain.endsWith(rootDomain)) {
      addDoctorResult(results, "PASS", `Stage domain (${entry.kind}:${entry.stage})`, entry.domain);
    } else {
      addDoctorResult(
        results,
        "WARN",
        `Stage domain (${entry.kind}:${entry.stage})`,
        `${entry.domain} does not end with root domain ${rootDomain}.`
      );
    }
  }

  for (const [domain, count] of duplicates.entries()) {
    if (count > 1) {
      addDoctorResult(
        results,
        "WARN",
        "Domain overlap",
        `${domain} is used by multiple stage mappings. Confirm this is intentional.`
      );
    }
  }

  if (commandExists("aws") && rootDomain) {
    const checkedDomains = Array.from(new Set(stageDomainPairs.map((entry) => entry.domain))).filter(Boolean);

    for (const domain of checkedDomains) {
      const zone = findHostedZone(domain, targetDir);
      if (!zone) {
        addDoctorResult(
          results,
          "FAIL",
          `Hosted zone (${domain})`,
          "No matching Route53 hosted zone found for domain or parent domains."
        );
        continue;
      }

      if (zone.matchedCandidate === domain.toLowerCase()) {
        addDoctorResult(
          results,
          "PASS",
          `Hosted zone (${domain})`,
          `Resolved exact zone ${zone.zoneName} (${zone.zoneId}).`
        );
      } else {
        addDoctorResult(
          results,
          "WARN",
          `Hosted zone (${domain})`,
          `Falling back to parent zone ${zone.zoneName} (${zone.zoneId}) via candidate ${zone.matchedCandidate}.`
        );
      }
    }
  }

  const certMap: Record<string, string | undefined> = {
    [webStageMap.production]: env.INFRA_WEB_CERT_ARN_PRODUCTION,
    [webStageMap.dev]: env.INFRA_WEB_CERT_ARN_DEV,
    [webStageMap.mobile]: env.INFRA_WEB_CERT_ARN_MOBILE,
  };

  if (enableExpo) {
    certMap[expoStageMap.production] = env.INFRA_EXPO_CERT_ARN_PRODUCTION;
    certMap[expoStageMap.dev] = env.INFRA_EXPO_CERT_ARN_DEV;
    certMap[expoStageMap.mobile] = env.INFRA_EXPO_CERT_ARN_MOBILE;
  }

  const acmList = commandExists("aws")
    ? runAwsJson(
      [
        "acm",
        "list-certificates",
        "--region",
        "us-east-1",
        "--certificate-statuses",
        "ISSUED",
        "PENDING_VALIDATION",
      ],
      targetDir
    )
    : null;

  const acmDomains = Array.isArray(acmList?.CertificateSummaryList)
    ? acmList.CertificateSummaryList
      .map((item: { DomainName?: string }) => item?.DomainName)
      .filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : [];

  for (const domain of Array.from(new Set(Object.keys(certMap))).filter(Boolean)) {
    const explicitArn = certMap[domain];
    if (explicitArn && explicitArn.trim().length > 0) {
      addDoctorResult(results, "PASS", `ACM (${domain})`, `Using explicit cert ARN (${explicitArn}).`);
      continue;
    }

    const hasMatch = acmDomains.some((certDomain: string) => wildcardMatch(certDomain, domain));
    if (hasMatch) {
      addDoctorResult(
        results,
        "PASS",
        `ACM (${domain})`,
        "Found existing ISSUED/PENDING_VALIDATION certificate in us-east-1."
      );
    } else {
      addDoctorResult(
        results,
        "WARN",
        `ACM (${domain})`,
        "No existing certificate found; SST will request one during deploy."
      );
    }
  }

  if (commandExists("aws")) {
    const explicitConnectionArn = env.INFRA_CODESTAR_CONNECTION_ARN ?? env.CODESTAR_CONNECTION_ARN;
    if (explicitConnectionArn) {
      const connection = runAwsJson(
        ["codestar-connections", "get-connection", "--connection-arn", explicitConnectionArn],
        targetDir
      );

      const status = connection?.Connection?.ConnectionStatus as string | undefined;
      if (status === "AVAILABLE") {
        addDoctorResult(results, "PASS", "CodeStar connection", `${explicitConnectionArn} is AVAILABLE.`);
      } else if (status) {
        addDoctorResult(results, "WARN", "CodeStar connection", `${explicitConnectionArn} status is ${status}.`);
      } else {
        addDoctorResult(results, "FAIL", "CodeStar connection", `Unable to fetch ${explicitConnectionArn}.`);
      }
    } else {
      const list = runAwsJson(["codestar-connections", "list-connections", "--provider-type-filter", "GitHub"], targetDir);
      const connections = Array.isArray(list?.Connections) ? list.Connections : [];
      const available = connections.filter((connection: { ConnectionStatus?: string }) => connection.ConnectionStatus === "AVAILABLE");

      if (available.length > 0) {
        addDoctorResult(results, "PASS", "CodeStar connection", `Found ${available.length} AVAILABLE GitHub connection(s).`);
      } else if (connections.length > 0) {
        addDoctorResult(results, "WARN", "CodeStar connection", "Connections exist but none are AVAILABLE.");
      } else {
        addDoctorResult(results, "WARN", "CodeStar connection", "No GitHub CodeStar connection found.");
      }
    }
  }

  if (selectedPipelines.length === 0) {
    addDoctorResult(results, "PASS", "Pipeline selection", "No pipelines selected (INFRA_PIPELINES=none).");
  } else {
    addDoctorResult(results, "PASS", "Pipeline selection", `Selected: ${selectedPipelines.join(",")}`);
  }

  const branchMap: Record<PipelineStage, string> = {
    production: env.INFRA_PIPELINE_BRANCH_PROD ?? PIPELINE_DEFS.production.defaultBranch,
    dev: env.INFRA_PIPELINE_BRANCH_DEV ?? PIPELINE_DEFS.dev.defaultBranch,
    mobile: env.INFRA_PIPELINE_BRANCH_MOBILE ?? PIPELINE_DEFS.mobile.defaultBranch,
  };

  for (const stage of selectedPipelines) {
    const branch = branchMap[stage];
    if (!branch || branch.trim().length === 0) {
      addDoctorResult(results, "FAIL", `Pipeline branch (${stage})`, "Branch is empty.");
      continue;
    }

    addDoctorResult(results, "PASS", `Pipeline branch (${stage})`, branch);
  }

  const createPipelines = isBoolTrue(env.INFRA_CREATE_PIPELINES, false);
  if (createPipelines) {
    addDoctorResult(
      results,
      "WARN",
      "Pipeline mutation mode",
      "INFRA_CREATE_PIPELINES=true. Production deploys will create/update pipelines."
    );
  } else {
    addDoctorResult(results, "PASS", "Pipeline mutation mode", "INFRA_CREATE_PIPELINES=false (safe default).");
  }

  const failures = results.filter((result) => result.status === "FAIL").length;
  const warnings = results.filter((result) => result.status === "WARN").length;

  console.log("\nSummary");
  console.log(`  Failures : ${failures}`);
  console.log(`  Warnings : ${warnings}`);
  console.log(`  Result   : ${failures > 0 || (strict && warnings > 0) ? "FAILED" : "PASSED"}`);

  if (failures > 0 || (strict && warnings > 0)) {
    process.exit(1);
  }
}

function runInit(flags: Record<string, string | boolean>) {
  const providerRaw = readFlag(flags, "provider", "aws").toLowerCase();
  if (providerRaw !== "aws") {
    console.error(`Unsupported provider: ${providerRaw}. v1 currently supports only aws.`);
    process.exit(1);
  }

  const project = toSlug(readFlag(flags, "project", "myapp"));
  const appName = readFlag(flags, "app-name", project);
  const domain = readFlag(flags, "domain", "example.com");
  const repo = readFlag(flags, "repo", "myorg/myrepo");
  const infraPath = readFlag(flags, "infra-path", "packages/infra");
  const withExpo = readBool(flags, "with-expo", false);
  const force = readBool(flags, "force", false);

  const profileFlag = readFlag(flags, "profile", "");
  let profile: ScaffoldProfile;
  try {
    profile = profileFlag
      ? parseProfile(profileFlag)
      : withExpo
        ? "next-expo"
        : "next-only";
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const branchProd = readFlag(flags, "branch-prod", PIPELINE_DEFS.production.defaultBranch);
  const branchDev = readFlag(flags, "branch-dev", PIPELINE_DEFS.dev.defaultBranch);
  const branchMobile = readFlag(flags, "branch-mobile", PIPELINE_DEFS.mobile.defaultBranch);

  const pipelinesRaw = readFlag(flags, "pipelines", profile === "expo-web" ? "production,dev,mobile" : "production,dev");
  let pipelines: PipelineStage[];
  try {
    pipelines = parsePipelines(pipelinesRaw);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const pipelinePermissionsModeRaw = readFlag(flags, "pipeline-permissions", "admin");
  let pipelinePermissionsMode: "admin" | "least-privilege";
  try {
    pipelinePermissionsMode = parsePipelinePermissionsMode(pipelinePermissionsModeRaw);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const targetRaw = readFlag(flags, "target", ".");
  const targetDir = resolve(process.cwd(), targetRaw);

  const options: InitOptions = {
    provider: "aws",
    project,
    domain,
    repo,
    pipelines,
    profile,
    appName,
    infraPath,
    targetDir,
    force,
    pipelinePermissionsMode,
  };

  const replacements = buildReplacements(options);
  replacements["__BRANCH_PROD__"] = branchProd;
  replacements["__BRANCH_DEV__"] = branchDev;
  replacements["__BRANCH_MOBILE__"] = branchMobile;

  console.log("\n🚀 @lsts_tech/infra — initializing white-label AWS scaffolding\n");
  console.log(`  provider   : ${options.provider}`);
  console.log(`  targetDir  : ${options.targetDir}`);
  console.log(`  project    : ${options.project}`);
  console.log(`  appName    : ${options.appName}`);
  console.log(`  profile    : ${options.profile}`);
  console.log(`  domain     : ${options.domain}`);
  console.log(`  repo       : ${options.repo}`);
  console.log(`  pipelines  : ${options.pipelines.join(",") || "none"}`);
  console.log(`  permissions: ${options.pipelinePermissionsMode}`);
  console.log("");

  let created = 0;
  let overwritten = 0;
  let skipped = 0;

  const files = getScaffoldFiles(profile);

  for (const file of files) {
    const root = file.sourceDir === "templates" ? TEMPLATES_DIR : SCRIPTS_DIR;
    const sourcePath = join(root, file.source);
    const targetPath = join(options.targetDir, file.target);

    if (!existsSync(sourcePath)) {
      console.warn(`  ⚠️  ${file.target} — source missing (${sourcePath}), skipped`);
      skipped++;
      continue;
    }

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
    const content = file.templated ? applyTemplate(raw, replacements) : raw;
    writeFileSync(targetPath, content, "utf-8");

    if (file.executable || file.target.endsWith(".sh")) {
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
  console.log("  1. Copy .env.example to .env and set project values");
  console.log("  2. Review config/pipelines.example.json and create config/pipelines.json if needed");
  console.log("  3. Set SST secrets (npx sst secret set <Name> <value> --stage <stage>)");
  console.log("  4. Validate setup (npx @lsts_tech/infra doctor --target .)");
  console.log("  5. Deploy app infra (npx sst deploy --stage dev)");
  console.log("  6. Create pipelines explicitly (APPROVE=true bash scripts/ensure-pipelines.sh)");
  console.log("");
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === "help" || parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  if (parsed.command === "init") {
    runInit(parsed.flags);
    return;
  }

  if (parsed.command === "doctor") {
    runDoctor(parsed.flags);
    return;
  }

  console.error(`Unknown command: ${parsed.command}`);
  printHelp();
  process.exit(1);
}

main();
