/**
 * NextSite — Reusable SST v3 Next.js Site Construct
 *
 * Wraps `sst.aws.Nextjs` with opinionated defaults for monorepo deployments.
 * Handles OpenNext bundling, CloudFront distribution, Lambda functions for SSR,
 * and S3 for static assets.
 *
 * @example
 * ```ts
 * import { createNextSite } from "@lsts_tech/infra/stacks/NextSite";
 *
 * const site = createNextSite({
 *   appPath: "../../apps/web",
 *   domain: "example.com",
 *   environment: { DATABASE_URL: databaseUrl.value },
 * });
 * ```
 */

/// <reference path="../sst-env.d.ts" />

export interface NextSiteConfig {
  /**
   * Relative path from packages/infra to the Next.js app directory.
   * @example "../../apps/web"
   */
  appPath: string;

  /**
   * The custom domain configuration.
   * Can be a string like "example.com" or a full domain config object.
   */
  domain?: string | {
    name: string;
    dns?: unknown;
    cert?: string;
    aliases?: string[];
    redirects?: string[];
  };

  /**
   * ARN of an existing ACM certificate to reuse instead of creating a new one.
   * Avoids Route53 CNAME conflicts on subsequent deploys.
   * @example "arn:aws:acm:us-east-1:123456789:certificate/abc-123"
   */
  certificateArn?: string;

  /**
   * Environment variables to inject into the Next.js app at build/runtime.
   * Secrets should be referenced via `sst.Secret` values.
   */
  environment?: Record<string, string | undefined>;

  /**
   * Whether to enable WAF (Web Application Firewall) on the CloudFront distribution.
   * @default false
   */
  waf?: boolean;

  /**
   * Custom invalidation paths after deployment.
   * @default ["/​*"]
   */
  invalidation?: {
    paths?: string[];
    wait?: boolean;
  };

  /**
   * Warm the Lambda functions to reduce cold starts.
   * Set to the number of concurrent warm instances.
   * @default 0 (disabled)
   */
  warm?: number;

  /**
   * Optional construct id to use when creating the SST construct.
   * This helps produce clearer resource names (included in generated Lambda names).
   * If omitted the default id `Site` is used.
   */
  id?: string;
}

/**
 * Creates an SST v3 Nextjs site with monorepo-aware defaults.
 *
 * Features:
 * - OpenNext bundling (SSR via Lambda, static via S3+CloudFront)
 * - Middleware support (runs in Lambda@Edge)
 * - API routes (run in Lambda)
 * - Image optimization via Lambda
 */
export function createNextSite(config: NextSiteConfig) {
  const {
    appPath,
    domain,
    environment = {},
    warm = 0,
    invalidation = { paths: ["/*"], wait: true },
    id,
  } = config;

  // Filter out undefined env vars (secrets that may not be set in all stages)
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  const constructId = id ?? "Site";

  let finalDomain = domain;
  if (config.certificateArn && finalDomain) {
    if (typeof finalDomain === "string") {
      finalDomain = { name: finalDomain, cert: config.certificateArn };
    } else if (typeof finalDomain === "object") {
      finalDomain = { ...finalDomain, cert: config.certificateArn };
    }
  }

  const site = new sst.aws.Nextjs(constructId, {
    path: appPath,
    environment: cleanEnv,
    domain: finalDomain,
    warm,
    invalidation,
  });

  return {
    site,
    url: site.url,
  };
}
