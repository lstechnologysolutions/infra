/**
 * Template: infra.config.ts (profile: expo-web)
 */

/// <reference path="./sst-env.d.ts" />

import { resolveDomain, createExpoSite, createPipeline } from "@lsts_tech/infra";

type PipelineStage = "production" | "dev" | "mobile";

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

const expoStageMap: Record<string, string> = {
  production: process.env.INFRA_EXPO_DOMAIN_PRODUCTION ?? `mobile.${rootDomain}`,
  dev: process.env.INFRA_EXPO_DOMAIN_DEV ?? `dev.mobile.${rootDomain}`,
  mobile: process.env.INFRA_EXPO_DOMAIN_MOBILE ?? `preview.mobile.${rootDomain}`,
};

const expoCerts: Record<string, string | undefined> = {
  production: process.env.INFRA_EXPO_CERT_ARN_PRODUCTION,
  dev: process.env.INFRA_EXPO_CERT_ARN_DEV,
  mobile: process.env.INFRA_EXPO_CERT_ARN_MOBILE,
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
  INFRA_ENABLE_EXPO_SITE: "true",
  INFRA_EXPO_DOMAIN_PRODUCTION: expoStageMap.production,
  INFRA_EXPO_DOMAIN_DEV: expoStageMap.dev,
  INFRA_EXPO_DOMAIN_MOBILE: expoStageMap.mobile,
  INFRA_EXPO_CERT_ARN_PRODUCTION: expoCerts.production ?? "",
  INFRA_EXPO_CERT_ARN_DEV: expoCerts.dev ?? "",
  INFRA_EXPO_CERT_ARN_MOBILE: expoCerts.mobile ?? "",
  DOMAIN_ROOT: rootDomain,
  PROJECT_PREFIX: pipelinePrefix,
  PREFIX: pipelinePrefix,
  DOMAIN_PRODUCTION: expoStageMap.production,
  DOMAIN_DEV: expoStageMap.dev,
  DOMAIN_MOBILE: expoStageMap.mobile,
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
    stageMap: expoStageMap,
    hostedZoneDomain,
  });

  const { url } = createExpoSite({
    appPath: "../../apps/mobile",
    id: `mobile-${stage}`,
    domain,
    certificateArn: expoCerts[stage],
    environment: {
      EXPO_PUBLIC_STAGE: stage,
      EXPO_PUBLIC_SITE_URL: `https://${domainName}`,
    },
    invalidation: {
      paths: ["/*"],
      wait: stage === "production" || stage === "mobile",
    },
  });

  const outputs: Record<string, unknown> = {
    profile,
    mobileUrl: url,
    mobileDomain: domainName,
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
