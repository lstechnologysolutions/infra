/// <reference path="./sst-env.d.ts" />

/**
 * SST v3 (Ion) Configuration
 *
 * This is the entry point for deploying your project infrastructure.
 * We've refactored the generic logic out to `@lsts_tech/infra` (located in dist/stacks).
 */

export default $config({
    app(input: any) {
        const appName = process.env.INFRA_APP_NAME ?? "myapp";
        return {
            name: appName,
            removal: input?.stage === "production" ? "retain" : "remove",
            protect: ["production"].includes(input?.stage),
            home: "aws",
            providers: {
                aws: {
                    region: "us-east-1",
                },
            },
        };
    },
    async run() {
        // Import and execute the project-specific infrastructure configuration
        const { createInfrastructure } = await import("./infra.config.js");
        return createInfrastructure();
    },
});
