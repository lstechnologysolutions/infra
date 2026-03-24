/**
 * @lsts_tech/infra — Opinionated SST v3 Infrastructure Constructs
 *
 * This package provides reusable, cloud-agnostic infrastructure primitives
 * for deploying Next.js and Expo web apps from a pnpm/Turborepo monorepo
 * using SST v3 and AWS CodePipeline.
 *
 * Configure your project-specific settings in an `infra.config.ts` file
 * at your infra package root. Run `npx @lsts_tech/infra init` to scaffold one.
 *
 * @example
 * ```ts
 * // infra.config.ts (your project)
 * import { resolveDomain, createNextSite, createPipeline } from "@lsts_tech/infra";
 *
 * export function createInfrastructure() {
 *   const stage = $app.stage;
 *   const { domain, domainName } = resolveDomain({
 *     rootDomain: "example.com",
 *     stage,
 *   });
 *
 *   const { site, url } = createNextSite({
 *     appPath: "../../apps/web",
 *     id: `web-${stage}`,
 *     domain,
 *   });
 *
 *   return { siteUrl: url, domain: domainName };
 * }
 * ```
 */

// ── Re-exports ─────────────────────────────────────────────────────────
export { resolveDomain } from "./Dns.js";
export type { DnsConfig, DomainResult } from "./Dns.js";

export { createLogger, logger } from "../src/logger.js";
export type { Logger, LoggerOptions, LogLevel } from "../src/logger.js";

export { isSensitiveKey, redactObject, redactString, REDACTED } from "../src/redact.js";

export { createNextSite } from "./NextSite.js";
export type { NextSiteConfig } from "./NextSite.js";

export { createExpoSite } from "./ExpoSite.js";
export type { ExpoSiteConfig } from "./ExpoSite.js";

export { createPipeline } from "./Pipeline.js";
export type { PipelineConfig } from "./Pipeline.js";
