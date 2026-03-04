import { resolveDomain, createNextSite, createExpoSite, createPipeline } from "@lsts_tech/infra";

const secrets = {
  DatabaseUrl: new sst.Secret("DatabaseUrl"),
  AuthSecret: new sst.Secret("AuthSecret"),
};

export function createInfrastructure() {
  const stage = $app.stage;
  const rootDomain = process.env.INFRA_ROOT_DOMAIN ?? "example.com";
  const repo = process.env.INFRA_PIPELINE_REPO ?? "myorg/myrepo";
  const prefix = process.env.INFRA_PIPELINE_PREFIX ?? "myapp";

  const webDomain = resolveDomain({
    rootDomain,
    stage,
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

  if (stage === "production") {
    const production = createPipeline({
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

    const mobile = createPipeline({
      name: `${prefix}-mobile`,
      repo,
      branch: process.env.INFRA_PIPELINE_BRANCH_MOBILE ?? "mobile",
      stage: "mobile",
      projectTag: process.env.INFRA_PROJECT_TAG ?? prefix,
    });

    outputs.pipelines = {
      production: production.pipelineName,
      dev: dev.pipelineName,
      mobile: mobile.pipelineName,
    };
  }

  return outputs;
}
