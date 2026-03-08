import { resolveDomain, createNextSite, createPipeline } from "@lsts_tech/infra";

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

  const { domain, domainName } = resolveDomain({
    rootDomain,
    stage,
    hostedZoneDomain,
  });

  const { url } = createNextSite({
    appPath: "../../apps/web",
    id: `web-${stage}`,
    domain,
    environment: {
      NEXT_PUBLIC_APP_URL: `https://${domainName}`,
      DATABASE_URL: secrets.DatabaseUrl.value,
      AUTH_SECRET: secrets.AuthSecret.value,
    },
  });

  const outputs: Record<string, unknown> = {
    siteUrl: url,
    domain: domainName,
  };

  if (stage === "production" && createPipelines) {
    const repo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
    const prefix = process.env.INFRA_PIPELINE_PREFIX ?? "myapp";

    const selected = (process.env.INFRA_PIPELINES ?? "production,dev")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is PipelineStage => value === "production" || value === "dev" || value === "mobile");

    for (const pipelineStage of selected) {
      const suffix = pipelineStage === "production" ? "prod" : pipelineStage;
      const branch =
        pipelineStage === "production"
          ? process.env.INFRA_PIPELINE_BRANCH_PROD ?? "master"
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
