/**
 * infra.config.ts
 *
 * Project-level SST infrastructure wiring using the reusable primitives from
 * @lsts_tech/infra. Keep this file environment-driven when the repository is public.
 */

/// <reference path="./sst-env.d.ts" />

import { resolveDomain, createNextSite, createPipeline, createExpoSite } from "./stacks/index.js";

const secrets = {
    DatabaseUrl: new sst.Secret("DatabaseUrl"),
    DirectusUrl: new sst.Secret("DirectusUrl"),
    DirectusAdminToken: new sst.Secret("DirectusAdminToken"),
    SupabaseUrl: new sst.Secret("SupabaseUrl"),
    SupabaseAnonKey: new sst.Secret("SupabaseAnonKey"),
    SupabaseServiceRoleKey: new sst.Secret("SupabaseServiceRoleKey"),
    GoogleClientId: new sst.Secret("GoogleClientId"),
    GoogleClientSecret: new sst.Secret("GoogleClientSecret"),
    GithubClientId: new sst.Secret("GithubClientId"),
    GithubClientSecret: new sst.Secret("GithubClientSecret"),
    AuthSecret: new sst.Secret("AuthSecret"),
};

const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "example.com";
const pipelineRepo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
const pipelinePrefix = process.env.INFRA_PIPELINE_PREFIX ?? "myapp";
const pipelineProjectTag = process.env.INFRA_PROJECT_TAG ?? "myapp";
const appName = process.env.INFRA_APP_NAME ?? "myapp";

const webStageMap: Record<string, string> = {
    production: process.env.INFRA_WEB_DOMAIN_PRODUCTION ?? rootDomain,
    dev: process.env.INFRA_WEB_DOMAIN_DEV ?? `dev.${rootDomain}`,
    mobile: process.env.INFRA_WEB_DOMAIN_MOBILE ?? `api.${rootDomain}`,
};

const mobileStageMap: Record<string, string> = {
    production: process.env.INFRA_EXPO_DOMAIN_PRODUCTION ?? `mobile.${rootDomain}`,
    dev: process.env.INFRA_EXPO_DOMAIN_DEV ?? `dev.mobile.${rootDomain}`,
    mobile: process.env.INFRA_EXPO_DOMAIN_MOBILE ?? `preview.mobile.${rootDomain}`,
};

const webCerts: Record<string, string | undefined> = {
    production: process.env.INFRA_WEB_CERT_ARN_PRODUCTION,
    dev: process.env.INFRA_WEB_CERT_ARN_DEV,
    mobile: process.env.INFRA_WEB_CERT_ARN_MOBILE,
};

const expoCerts: Record<string, string | undefined> = {
    production: process.env.INFRA_EXPO_CERT_ARN_PRODUCTION,
    dev: process.env.INFRA_EXPO_CERT_ARN_DEV,
    mobile: process.env.INFRA_EXPO_CERT_ARN_MOBILE,
};

const commonBuildEnv = {
    INFRA_APP_NAME: appName,
    INFRA_ROOT_DOMAIN: rootDomain,
    INFRA_PIPELINE_REPO: pipelineRepo,
    INFRA_PIPELINE_PREFIX: pipelinePrefix,
    INFRA_PROJECT_TAG: pipelineProjectTag,
    INFRA_PIPELINE_BRANCH_PROD: process.env.INFRA_PIPELINE_BRANCH_PROD ?? "main",
    INFRA_PIPELINE_BRANCH_DEV: process.env.INFRA_PIPELINE_BRANCH_DEV ?? "develop",
    INFRA_PIPELINE_BRANCH_MOBILE: process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "mobile",
    INFRA_WEB_DOMAIN_PRODUCTION: webStageMap.production,
    INFRA_WEB_DOMAIN_DEV: webStageMap.dev,
    INFRA_WEB_DOMAIN_MOBILE: webStageMap.mobile,
    INFRA_EXPO_DOMAIN_PRODUCTION: mobileStageMap.production,
    INFRA_EXPO_DOMAIN_DEV: mobileStageMap.dev,
    INFRA_EXPO_DOMAIN_MOBILE: mobileStageMap.mobile,
    INFRA_WEB_CERT_ARN_PRODUCTION: webCerts.production ?? "",
    INFRA_WEB_CERT_ARN_DEV: webCerts.dev ?? "",
    INFRA_WEB_CERT_ARN_MOBILE: webCerts.mobile ?? "",
    INFRA_EXPO_CERT_ARN_PRODUCTION: expoCerts.production ?? "",
    INFRA_EXPO_CERT_ARN_DEV: expoCerts.dev ?? "",
    INFRA_EXPO_CERT_ARN_MOBILE: expoCerts.mobile ?? "",
    DOMAIN_ROOT: rootDomain,
    PROJECT_PREFIX: pipelinePrefix,
    PREFIX: pipelinePrefix,
    DOMAIN_PRODUCTION: webStageMap.production,
    DOMAIN_DEV: webStageMap.dev,
    DOMAIN_MOBILE: webStageMap.mobile,
};

export function createInfrastructure() {
    const stage = $app.stage;

    const { domain, domainName } = resolveDomain({
        rootDomain,
        stage,
        stageMap: webStageMap,
    });

    console.log(`📦 Deploying stage "${stage}" → ${domainName}`);

    const { url } = createNextSite({
        appPath: "../../apps/web",
        id: `web-${stage}`,
        domain,
        certificateArn: webCerts[stage],
        environment: {
            NEXT_PUBLIC_APP_URL: `https://${domainName}`,
            // Explicitly reference a secret so it is provisioned and linked.
            DATABASE_URL: secrets.DatabaseUrl.value,
        },
        warm: stage === "production" ? 5 : 0,
        invalidation: {
            paths: ["/*"],
            wait: stage === "production",
        },
    });

    const { domain: mobileDomain, domainName: mobileDomainName } = resolveDomain({
        rootDomain,
        stage,
        stageMap: mobileStageMap,
    });

    console.log(`📦 Deploying Mobile (Expo web) stage "${stage}" → ${mobileDomainName}`);

    const { url: mobileUrl } = createExpoSite({
        appPath: "../../apps/mobile",
        id: `mobile-${stage}`,
        domain: mobileDomain,
        certificateArn: expoCerts[stage],
        environment: {
            EXPO_PUBLIC_API_URL: `https://${domainName}/api`,
        },
        invalidation: {
            paths: ["/*"],
            wait: stage === "production" || stage === "mobile",
        },
    });

    if (stage === "production") {
        const prodPipeline = createPipeline({
            name: `${pipelinePrefix}-prod`,
            repo: pipelineRepo,
            branch: process.env.INFRA_PIPELINE_BRANCH_PROD ?? "main",
            stage: "production",
            projectTag: pipelineProjectTag,
            buildEnv: commonBuildEnv,
        });

        const devPipeline = createPipeline({
            name: `${pipelinePrefix}-dev`,
            repo: pipelineRepo,
            branch: process.env.INFRA_PIPELINE_BRANCH_DEV ?? "develop",
            stage: "dev",
            projectTag: pipelineProjectTag,
            buildEnv: commonBuildEnv,
        });

        const mobilePipeline = createPipeline({
            name: `${pipelinePrefix}-mobile`,
            repo: pipelineRepo,
            branch: process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "mobile",
            stage: "mobile",
            projectTag: pipelineProjectTag,
            buildEnv: commonBuildEnv,
        });

        return {
            siteUrl: url,
            domain: domainName,
            mobileUrl,
            mobileDomain: mobileDomainName,
            prodPipelineName: prodPipeline.pipelineName,
            devPipelineName: devPipeline.pipelineName,
            mobilePipelineName: mobilePipeline.pipelineName,
        };
    }

    return {
        siteUrl: url,
        domain: domainName,
        mobileUrl,
        mobileDomain: mobileDomainName,
    };
}
