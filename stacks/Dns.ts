/**
 * Dns — Reusable DNS & Domain Configuration
 *
 * Provides stage-aware domain resolution for SST deployments.
 * Maps deployment stages to subdomains and handles Route 53 + ACM configuration.
 *
 * Design:
 * - SST v3's `sst.aws.Nextjs` handles ACM certificate provisioning automatically
 *   when a `domain` is provided — it creates the cert in us-east-1 for CloudFront.
 * - Route 53 hosted zone must already exist for the root domain.
 * - This module only resolves the correct domain string per stage.
 *
 * @example
 * ```ts
 * const domain = resolveDomain({
 *   rootDomain: "example.com",
 *   stage: "dev",
 * });
 * // → "dev.example.com"
 * ```
 */

export interface DnsConfig {
  /**
   * The root domain name managed in Route 53.
   * @example "example.com"
   */
  rootDomain: string;

  /**
   * The current SST stage name.
   * @example "production" | "dev" | "staging"
   */
  stage: string;

  /**
   * Optional stage-to-domain mapping overrides.
   * If not provided, uses sensible defaults:
   *   - "production" → rootDomain (e.g., "example.com")
   *   - any other stage → "{stage}.{rootDomain}" (e.g., "dev.example.com")
   */
  stageMap?: Record<string, string>;

  /**
   * Whether to add a www redirect for the production domain.
   * @default true
   */
  wwwRedirect?: boolean;
}

export interface DomainResult {
  /**
   * The resolved domain configuration for sst.aws.Nextjs.
   * Can be passed directly to the `domain` prop.
   */
  domain: {
    name: string;
    redirects?: string[];
  };

  /**
   * The final domain name string for logging/reference.
   */
  domainName: string;
}

/**
 * Resolves the domain configuration for a given stage.
 *
 * Rules:
 * 1. "production" stage → root domain + optional www redirect
 * 2. Any other stage → {stage}.{rootDomain} as a subdomain
 * 3. Custom stageMap overrides take priority
 */
export function resolveDomain(config: DnsConfig): DomainResult {
  const {
    rootDomain,
    stage,
    stageMap = {},
    wwwRedirect = true,
  } = config;

  // Check for custom stage mapping first
  if (stageMap[stage]) {
    return {
      domain: { name: stageMap[stage] },
      domainName: stageMap[stage],
    };
  }

  // Production stage → root domain
  if (stage === "production") {
    const redirects = wwwRedirect ? [`www.${rootDomain}`] : undefined;
    return {
      domain: {
        name: rootDomain,
        redirects,
      },
      domainName: rootDomain,
    };
  }

  // All other stages → subdomain
  const subDomain = `${stage}.${rootDomain}`;
  return {
    domain: { name: subDomain },
    domainName: subDomain,
  };
}
