/**
 * SST v3 (Ion) Global Type Declarations
 *
 * SST v3 injects these globals at runtime via the `sst` CLI.
 * This file provides type stubs so the package compiles standalone
 * without requiring `sst dev` or `sst deploy` to generate `sst-env.d.ts`.
 *
 * These are intentionally typed as `any` because SST's actual types are
 * dynamic and depend on the project configuration. Consumers of this
 * package will have full types from their own SST installation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── SST v3 Globals ─────────────────────────────────────────────────────

/** SST namespace — provides constructs like `sst.aws.Nextjs`, `sst.Secret`, etc. */
declare const sst: {
    aws: {
        Nextjs: new (id: string, props: any) => any;
        StaticSite: new (id: string, props: any) => any;
        [key: string]: any;
    };
    Secret: new (name: string) => { value: any };
    [key: string]: any;
};

/** Pulumi AWS provider — provides AWS resource constructs */
declare const aws: {
    codestarconnections: {
        Connection: new (name: string, props: any) => { arn: any };
    };
    s3: {
        BucketV2: new (name: string, props: any) => { id: any; arn: any; bucket: any };
        BucketLifecycleConfigurationV2: new (name: string, props: any) => any;
    };
    iam: {
        Role: new (name: string, props: any) => { id: any; arn: any; name: any };
        RolePolicy: new (name: string, props: any) => any;
        RolePolicyAttachment: new (name: string, props: any) => any;
    };
    codebuild: {
        Project: new (name: string, props: any) => { arn: any; name: any };
    };
    codepipeline: {
        Pipeline: new (name: string, props: any) => { name: any; arn: any };
    };
    [key: string]: any;
};

/** SST app context — provides `$app.stage`, `$app.name`, etc. */
declare const $app: {
    stage: string;
    name: string;
    [key: string]: any;
};

/** SST interpolation helper — Pulumi string interpolation */
declare function $interpolate(strings: TemplateStringsArray, ...values: any[]): any;

/** SST JSON stringification helper — Pulumi output-aware JSON.stringify */
declare function $jsonStringify(obj: any): any;

/** SST app config wrapper */
declare function $config(config: any): any;
