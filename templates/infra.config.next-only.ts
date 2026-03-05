/**
 * Template: infra.config.ts (profile: next-only)
 */

/// <reference path="./sst-env.d.ts" />

import { resolveDomain, createNextSite, createPipeline } from "@lsts_tech/infra";

type PipelineStage = "production" | "dev" | "mobile";

const secrets = {
  DatabaseUrl: new sst.Secret("DatabaseUrl"),
  AuthSecret: new sst.Secret("AuthSecret"),
};

const profile = process.env.INFRA_PROFILE ?? "__PROFILE__";
const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "__ROOT_DOMAIN__";
const pipelineRepo = process.env.INFRA_PIPELINE_REPO ?? "__PIPELINE_REPO__";
const pipelinePrefix = process.env.INFRA_PIPELINE_PREFIX ?? "__PROJECT_PREFIX__";
const pipelineProjectTag = process.env.INFRA_PROJECT_TAG ?? "__PROJECT_PREFIX__";
const appName = process.env.INFRA_APP_NAME ?? "__APP_NAME__";
const selectedPipelinesRaw = process.env.INFRA_PIPELINES ?? "__PIPELINES_DEFAULT__";
const createPipelines = (process.env.INFRA_CREATE_PIPELINES ?? "__CREATE_PIPELINES_DEFAULT__") === "true";
const hostedZoneDomain = process.env.INFRA_HOSTED_ZONE_DOMAIN || undefined;

const pipelinePermissionsMode =
  (process.env.INFRA_PIPELINE_PERMISSIONS_MODE ?? "__PIPELINE_PERMISSIONS_MODE__") === "least-privilege"
    ? "least-privilege"
    : "admin";

const webStageMap: Record<string, string> = {
  production: process.env.INFRA_WEB_DOMAIN_PRODUCTION ?? rootDomain,
  dev: process.env.INFRA_WEB_DOMAIN_DEV ?? `dev.${rootDomain}`,
  mobile: process.env.INFRA_WEB_DOMAIN_MOBILE ?? `api.${rootDomain}`,
};

const webCerts: Record<string, string | undefined> = {
  production: process.env.INFRA_WEB_CERT_ARN_PRODUCTION,
  dev: process.env.INFRA_WEB_CERT_ARN_DEV,
  mobile: process.env.INFRA_WEB_CERT_ARN_MOBILE,
};

const commonBuildEnv = {
  INFRA_PROFILE: profile,
  INFRA_APP_NAME: appName,
  INFRA_ROOT_DOMAIN: rootDomain,
  INFRA_HOSTED_ZONE_DOMAIN: hostedZoneDomain ?? "",
  INFRA_PIPELINE_REPO: pipelineRepo,
  INFRA_PIPELINE_PREFIX: pipelinePrefix,
  INFRA_PROJECT_TAG: pipelineProjectTag,
  INFRA_PIPELINE_BRANCH_PROD: process.env.INFRA_PIPELINE_BRANCH_PROD ?? "__BRANCH_PROD__",
  INFRA_PIPELINE_BRANCH_DEV: process.env.INFRA_PIPELINE_BRANCH_DEV ?? "__BRANCH_DEV__",
  INFRA_PIPELINE_BRANCH_MOBILE: process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "__BRANCH_MOBILE__",
  INFRA_PIPELINES_CONFIG_PATH: process.env.INFRA_PIPELINES_CONFIG_PATH ?? "config/pipelines.json",
  INFRA_PIPELINE_PERMISSIONS_MODE: pipelinePermissionsMode,
  INFRA_CREATE_PIPELINES: "false",
  INFRA_WEB_DOMAIN_PRODUCTION: webStageMap.production,
  INFRA_WEB_DOMAIN_DEV: webStageMap.dev,
  INFRA_WEB_DOMAIN_MOBILE: webStageMap.mobile,
  INFRA_WEB_CERT_ARN_PRODUCTION: webCerts.production ?? "",
  INFRA_WEB_CERT_ARN_DEV: webCerts.dev ?? "",
  INFRA_WEB_CERT_ARN_MOBILE: webCerts.mobile ?? "",
  DOMAIN_ROOT: rootDomain,
  PROJECT_PREFIX: pipelinePrefix,
  PREFIX: pipelinePrefix,
  DOMAIN_PRODUCTION: webStageMap.production,
  DOMAIN_DEV: webStageMap.dev,
  DOMAIN_MOBILE: webStageMap.mobile,
};

function parsePipelineStage(value: string): PipelineStage | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "production" || normalized === "prod") return "production";
  if (normalized === "dev") return "dev";
  if (normalized === "mobile") return "mobile";
  return undefined;
}

const selectedPipelines = new Set<PipelineStage>(
  selectedPipelinesRaw
    .split(",")
    .map((value) => parsePipelineStage(value))
    .filter((value): value is PipelineStage => value !== undefined)
);

const pipelineSpecs: Record<PipelineStage, { suffix: string; branch: string; stage: PipelineStage }> = {
  production: {
    suffix: "prod",
    branch: process.env.INFRA_PIPELINE_BRANCH_PROD ?? "__BRANCH_PROD__",
    stage: "production",
  },
  dev: {
    suffix: "dev",
    branch: process.env.INFRA_PIPELINE_BRANCH_DEV ?? "__BRANCH_DEV__",
    stage: "dev",
  },
  mobile: {
    suffix: "mobile",
    branch: process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "__BRANCH_MOBILE__",
    stage: "mobile",
  },
};

export function createInfrastructure() {
  const stage = $app.stage;

  const { domain, domainName } = resolveDomain({
    rootDomain,
    stage,
    stageMap: webStageMap,
    hostedZoneDomain,
  });

  const { url } = createNextSite({
    appPath: "../../apps/web",
    id: `web-${stage}`,
    domain,
    certificateArn: webCerts[stage],
    environment: {
      NEXT_PUBLIC_APP_URL: `https://${domainName}`,
      DATABASE_URL: secrets.DatabaseUrl.value,
      AUTH_SECRET: secrets.AuthSecret.value,
    },
    warm: stage === "production" ? 1 : 0,
    invalidation: {
      paths: ["/*"],
      wait: stage === "production",
    },
  });

  const outputs: Record<string, unknown> = {
    profile,
    siteUrl: url,
    domain: domainName,
  };

  if (stage === "production" && createPipelines && selectedPipelines.size > 0) {
    const pipelineOutputs: Record<string, string> = {};

    for (const pipelineStage of selectedPipelines) {
      const spec = pipelineSpecs[pipelineStage];
      const pipeline = createPipeline({
        name: `${pipelinePrefix}-${spec.suffix}`,
        repo: pipelineRepo,
        branch: spec.branch,
        stage: spec.stage,
        projectTag: pipelineProjectTag,
        buildEnv: commonBuildEnv,
        permissionsMode: pipelinePermissionsMode,
      });

      pipelineOutputs[`${pipelineStage}PipelineName`] = pipeline.pipelineName;
    }

    outputs.pipelines = pipelineOutputs;
  }

  return outputs;
}
