import { resolveDomain, createNextSite, createExpoSite, createPipeline } from "@lsts_tech/infra";

type PipelineStage = "production" | "dev" | "mobile";

const secrets = {
  DatabaseUrl: new sst.Secret("DatabaseUrl"),
  AuthSecret: new sst.Secret("AuthSecret"),
};

const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "example.com";
const hostedZoneDomain = process.env.INFRA_HOSTED_ZONE_DOMAIN || undefined;
const createPipelines = (process.env.INFRA_CREATE_PIPELINES ?? "false") === "true";
const pipelinePermissionsMode =
  process.env.INFRA_PIPELINE_PERMISSIONS_MODE === "least-privilege" ? "least-privilege" : "admin";

export function createInfrastructure() {
  const stage = $app.stage;
  const repo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
  const prefix = process.env.INFRA_PIPELINE_PREFIX ?? "myapp";

  const webDomain = resolveDomain({
    rootDomain,
    stage,
    hostedZoneDomain,
    stageMap: {
      production: process.env.INFRA_WEB_DOMAIN_PRODUCTION ?? rootDomain,
      dev: process.env.INFRA_WEB_DOMAIN_DEV ?? `dev.${rootDomain}`,
      mobile: process.env.INFRA_WEB_DOMAIN_MOBILE ?? `api.${rootDomain}`,
    },
  });

  const web = createNextSite({
    appPath: "../../apps/web",
    id: `web-${stage}`,
    domain: webDomain.domain,
    certificateArn: {
      production: process.env.INFRA_WEB_CERT_ARN_PRODUCTION,
      dev: process.env.INFRA_WEB_CERT_ARN_DEV,
      mobile: process.env.INFRA_WEB_CERT_ARN_MOBILE,
    }[stage],
    environment: {
      NEXT_PUBLIC_APP_URL: `https://${webDomain.domainName}`,
      DATABASE_URL: secrets.DatabaseUrl.value,
      AUTH_SECRET: secrets.AuthSecret.value,
    },
  });

  const expoDomain = resolveDomain({
    rootDomain,
    stage,
    hostedZoneDomain,
    stageMap: {
      production: process.env.INFRA_EXPO_DOMAIN_PRODUCTION ?? `mobile.${rootDomain}`,
      dev: process.env.INFRA_EXPO_DOMAIN_DEV ?? `dev.mobile.${rootDomain}`,
      mobile: process.env.INFRA_EXPO_DOMAIN_MOBILE ?? `preview.mobile.${rootDomain}`,
    },
  });

  const expo = createExpoSite({
    appPath: "../../apps/mobile",
    id: `mobile-${stage}`,
    domain: expoDomain.domain,
    certificateArn: {
      production: process.env.INFRA_EXPO_CERT_ARN_PRODUCTION,
      dev: process.env.INFRA_EXPO_CERT_ARN_DEV,
      mobile: process.env.INFRA_EXPO_CERT_ARN_MOBILE,
    }[stage],
    environment: {
      EXPO_PUBLIC_API_URL: `https://${webDomain.domainName}/api`,
    },
  });

  const outputs: Record<string, unknown> = {
    siteUrl: web.url,
    domain: webDomain.domainName,
    mobileUrl: expo.url,
    mobileDomain: expoDomain.domainName,
  };

  if (stage === "production" && createPipelines) {
    const selected = (process.env.INFRA_PIPELINES ?? "production,dev,mobile")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is PipelineStage => value === "production" || value === "dev" || value === "mobile");

    for (const pipelineStage of selected) {
      const suffix = pipelineStage === "production" ? "prod" : pipelineStage;
      const branch =
        pipelineStage === "production"
          ? process.env.INFRA_PIPELINE_BRANCH_PROD ?? "main"
          : pipelineStage === "dev"
            ? process.env.INFRA_PIPELINE_BRANCH_DEV ?? "develop"
            : process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "mobile";

      const pipeline = createPipeline({
        name: `${prefix}-${suffix}`,
        repo,
        branch,
        stage: pipelineStage,
        projectTag: process.env.INFRA_PROJECT_TAG ?? prefix,
        permissionsMode: pipelinePermissionsMode,
      });

      outputs[`${pipelineStage}PipelineName`] = pipeline.pipelineName;
    }
  }

  return outputs;
}
