import { resolveDomain, createNextSite, createPipeline } from "@lsts_tech/infra";

const secrets = {
  DatabaseUrl: new sst.Secret("DatabaseUrl"),
  AuthSecret: new sst.Secret("AuthSecret"),
};

export function createInfrastructure() {
  const stage = $app.stage;
  const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "example.com";

  const { domain, domainName } = resolveDomain({
    rootDomain,
    stage,
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

  if (stage === "production") {
    const repo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
    const prefix = process.env.INFRA_PIPELINE_PREFIX ?? "myapp";

    const prod = createPipeline({
      name: `${prefix}-prod`,
      repo,
      branch: process.env.INFRA_PIPELINE_BRANCH_PROD ?? "main",
      stage: "production",
      projectTag: process.env.INFRA_PROJECT_TAG ?? prefix,
    });

    const dev = createPipeline({
      name: `${prefix}-dev`,
      repo,
      branch: process.env.INFRA_PIPELINE_BRANCH_DEV ?? "develop",
      stage: "dev",
      projectTag: process.env.INFRA_PROJECT_TAG ?? prefix,
    });

    outputs.pipelines = {
      production: prod.pipelineName,
      dev: dev.pipelineName,
    };
  }

  return outputs;
}
