/**
 * Dns — Reusable DNS & Domain Configuration
 *
 * Provides stage-aware domain resolution for SST deployments.
 * Maps deployment stages to subdomains and handles Route 53 + ACM configuration.
 *
 * Design:
 * - SST v3's `sst.aws.Nextjs` handles ACM certificate provisioning automatically
 *   when a `domain` is provided — it creates the cert in us-east-1 for CloudFront.
 * - Route 53 hosted zone must already exist for the managed domain.
 * - This module resolves domain names and can optionally pin Route53 DNS to a
 *   specific hosted zone (including parent-zone fallback for delegated subdomains).
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

  /**
   * Optional Route53 hosted zone domain to use explicitly.
   * Useful when deploying subdomains delegated under a parent zone.
   * @example "alternun.co"
   */
  hostedZoneDomain?: string;

  /**
   * If true and `hostedZoneDomain` is not set, infer a parent hosted zone domain
   * from `rootDomain` (eg. airs.alternun.co -> alternun.co).
   * @default true
   */
  inferParentHostedZone?: boolean;
}

export interface DomainResult {
  /**
   * The resolved domain configuration for sst.aws.Nextjs or sst.aws.StaticSite.
   * Can be passed directly to the `domain` prop.
   */
  domain: {
    name: string;
    dns?: unknown;
    redirects?: string[];
  };

  /**
   * The final domain name string for logging/reference.
   */
  domainName: string;

  /**
   * Optional hosted zone domain used for Route53 DNS records.
   */
  hostedZoneDomain?: string;
}

function inferApexHostedZone(domain: string): string {
  const labels = domain
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);

  if (labels.length <= 2) {
    return labels.join(".");
  }

  const tld = labels[labels.length - 1];
  const secondLevel = labels[labels.length - 2];

  // Basic ccTLD heuristic (eg. example.co.uk -> keep 3 labels)
  const keepCount = tld.length === 2 && secondLevel.length <= 3 ? 3 : 2;
  return labels.slice(-Math.min(keepCount, labels.length)).join(".");
}

function resolveHostedZoneDomain(config: DnsConfig): string | undefined {
  if (config.hostedZoneDomain && config.hostedZoneDomain.trim().length > 0) {
    return config.hostedZoneDomain.trim().replace(/\.$/, "");
  }

  if (config.inferParentHostedZone === false) {
    return undefined;
  }

  const root = config.rootDomain.trim().replace(/\.$/, "");
  if (!root) {
    return undefined;
  }

  const inferred = inferApexHostedZone(root);
  if (!inferred || inferred === root) {
    return undefined;
  }

  return inferred;
}

function buildDnsConfig(hostedZoneDomain?: string) {
  if (!hostedZoneDomain) {
    return undefined;
  }

  try {
    if (typeof sst !== "undefined" && sst.aws && typeof sst.aws.dns === "function") {
      return sst.aws.dns({ zone: hostedZoneDomain });
    }
  } catch {
    // If SST dns helper is unavailable in this runtime, skip explicit dns binding.
  }

  return undefined;
}

/**
 * Resolves the domain configuration for a given stage.
 *
 * Rules:
 * 1. "production" stage -> root domain + optional www redirect
 * 2. Any other stage -> {stage}.{rootDomain} as a subdomain
 * 3. Custom stageMap overrides take priority
 * 4. Hosted zone can be pinned via `hostedZoneDomain`, or inferred to parent apex
 */
export function resolveDomain(config: DnsConfig): DomainResult {
  const {
    rootDomain,
    stage,
    stageMap = {},
    wwwRedirect = true,
  } = config;

  const finalHostedZoneDomain = resolveHostedZoneDomain(config);
  const dns = buildDnsConfig(finalHostedZoneDomain);

  // Check for custom stage mapping first
  if (stageMap[stage]) {
    return {
      domain: {
        name: stageMap[stage],
        ...(dns ? { dns } : {}),
      },
      domainName: stageMap[stage],
      hostedZoneDomain: finalHostedZoneDomain,
    };
  }

  // Production stage -> root domain
  if (stage === "production") {
    const redirects = wwwRedirect ? [`www.${rootDomain}`] : undefined;
    return {
      domain: {
        name: rootDomain,
        ...(dns ? { dns } : {}),
        ...(redirects ? { redirects } : {}),
      },
      domainName: rootDomain,
      hostedZoneDomain: finalHostedZoneDomain,
    };
  }

  // All other stages -> subdomain
  const subDomain = `${stage}.${rootDomain}`;
  return {
    domain: {
      name: subDomain,
      ...(dns ? { dns } : {}),
    },
    domainName: subDomain,
    hostedZoneDomain: finalHostedZoneDomain,
  };
}
