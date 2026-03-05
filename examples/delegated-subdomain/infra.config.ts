import { resolveDomain, createNextSite, createExpoSite, createPipeline } from "@lsts_tech/infra";

type PipelineStage = "production" | "dev" | "mobile";

const secrets = {
  DatabaseUrl: new sst.Secret("DatabaseUrl"),
  AuthSecret: new sst.Secret("AuthSecret"),
};

const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "airs.alternun.co";
const hostedZoneDomain = process.env.INFRA_HOSTED_ZONE_DOMAIN ?? "alternun.co";
const pipelineRepo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
const pipelinePrefix = process.env.INFRA_PIPELINE_PREFIX ?? "airs";
const createPipelines = (process.env.INFRA_CREATE_PIPELINES ?? "false") === "true";

const webStageMap: Record<string, string> = {
  production: process.env.INFRA_WEB_DOMAIN_PRODUCTION ?? rootDomain,
  dev: process.env.INFRA_WEB_DOMAIN_DEV ?? `dev.${rootDomain}`,
  mobile: process.env.INFRA_WEB_DOMAIN_MOBILE ?? `api.${rootDomain}`,
};

const expoStageMap: Record<string, string> = {
  production: process.env.INFRA_EXPO_DOMAIN_PRODUCTION ?? `mobile.${rootDomain}`,
  dev: process.env.INFRA_EXPO_DOMAIN_DEV ?? `dev.mobile.${rootDomain}`,
  mobile: process.env.INFRA_EXPO_DOMAIN_MOBILE ?? `preview.mobile.${rootDomain}`,
};

const selectedPipelines = (process.env.INFRA_PIPELINES ?? "production,dev,mobile")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value): value is PipelineStage => value === "production" || value === "dev" || value === "mobile");

export function createInfrastructure() {
  const stage = $app.stage;

  const webDomain = resolveDomain({
    rootDomain,
    stage,
    stageMap: webStageMap,
    hostedZoneDomain,
  });

  const web = createNextSite({
    appPath: "../../apps/web",
    id: `web-${stage}`,
    domain: webDomain.domain,
    environment: {
      NEXT_PUBLIC_APP_URL: `https://${webDomain.domainName}`,
      DATABASE_URL: secrets.DatabaseUrl.value,
      AUTH_SECRET: secrets.AuthSecret.value,
    },
  });

  const expoDomain = resolveDomain({
    rootDomain,
    stage,
    stageMap: expoStageMap,
    hostedZoneDomain,
  });

  const expo = createExpoSite({
    appPath: "../../apps/mobile",
    id: `mobile-${stage}`,
    domain: expoDomain.domain,
    environment: {
      EXPO_PUBLIC_API_URL: `https://${webDomain.domainName}/api`,
    },
  });

  const outputs: Record<string, unknown> = {
    siteUrl: web.url,
    domain: webDomain.domainName,
    mobileUrl: expo.url,
    mobileDomain: expoDomain.domainName,
    hostedZoneDomain,
  };

  if (stage === "production" && createPipelines) {
    for (const pipelineStage of selectedPipelines) {
      const branch =
        pipelineStage === "production"
          ? process.env.INFRA_PIPELINE_BRANCH_PROD ?? "main"
          : pipelineStage === "dev"
            ? process.env.INFRA_PIPELINE_BRANCH_DEV ?? "develop"
            : process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "mobile";

      const suffix = pipelineStage === "production" ? "prod" : pipelineStage;
      const pipeline = createPipeline({
        name: `${pipelinePrefix}-${suffix}`,
        repo: pipelineRepo,
        branch,
        stage: pipelineStage,
        permissionsMode:
          process.env.INFRA_PIPELINE_PERMISSIONS_MODE === "least-privilege" ? "least-privilege" : "admin",
      });

      outputs[`${pipelineStage}PipelineName`] = pipeline.pipelineName;
    }
  }

  return outputs;
}
