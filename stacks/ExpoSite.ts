/**
 * ExpoSite — AWS Static Site Construct for Expo Web apps
 *
 * Creates a fast, globally distributed static site using Amazon S3 and CloudFront.
 * Pre-configured for Expo web exports (SPAs).
 */

/// <reference path="../sst-env.d.ts" />

export interface ExpoSiteConfig {
    /**
     * The relative path to the Expo application root.
     * @example "../../apps/mobile"
     */
    appPath: string;

    /**
     * Domain configuration mapping for the site.
     * Can be a string, or an object specifying aliases.
     * @example "mobile.example.com"
     */
    domain?:
        | string
        | {
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
     * Environment variables injected at build time.
     */
    environment?: Record<string, string | undefined>;

    /**
     * CloudFront invalidation configuration.
     */
    invalidation?: {
        paths?: string[];
        wait?: boolean;
    };

    /**
     * Expo web build settings.
     * Supports both modern Expo (`dist`) and customized outputs (e.g. `web-build`).
     */
    build?: {
        command?: string;
        output?: string;
    };

    /**
     * Static site error page.
     * Use `index.html` for SPA-style Expo web routing.
     * @default "index.html"
     */
    errorPage?: string;

    /**
     * Provide a custom construct ID.
     * @default "ExpoSite"
     */
    id?: string;
}

/**
 * Provisions a StaticSite for an Expo Web application.
 *
 * @param config Configuration options for the Expo site
 * @returns The initialized `sst.aws.StaticSite` instance and the site URL
 */
export function createExpoSite(config: ExpoSiteConfig) {
    const constructId = config.id || "ExpoSite";
    const buildCommand = config.build?.command ?? "npx expo export -p web";
    const buildOutput = config.build?.output ?? "dist";

    // If an existing cert ARN is provided, inject it into the domain config so
    // SST/Pulumi skips the ACM certificate + Route53 CNAME validation step.
    let domain = config.domain;
    if (config.certificateArn && domain) {
        if (typeof domain === "string") {
            domain = { name: domain, cert: config.certificateArn };
        } else if (typeof domain === "object") {
            domain = { ...domain, cert: config.certificateArn };
        }
    }

    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.environment ?? {})) {
        if (value !== undefined) {
            cleanEnv[key] = value;
        }
    }

    const site = new sst.aws.StaticSite(constructId, {
        path: config.appPath,
        build: {
            command: buildCommand,
            output: buildOutput,
        },
        domain,
        environment: cleanEnv,
        invalidation: config.invalidation,
        // Expo creates a static SPA with index.html as the entry point
        errorPage: config.errorPage ?? "index.html",
    });

    return { site, url: site.url };
}
