/**
 * SST v3 (Ion) Global Type Declarations
 *
 * Lightweight stubs for standalone TypeScript compilation.
 * Replace or regenerate this file with SST-generated types in your project if needed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const sst: {
  aws: {
    Nextjs: new (id: string, props: any) => any;
    StaticSite: new (id: string, props: any) => any;
    [key: string]: any;
  };
  Secret: new (name: string) => { value: any };
  [key: string]: any;
};

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

declare const $app: {
  stage: string;
  name: string;
  [key: string]: any;
};

declare function $interpolate(strings: TemplateStringsArray, ...values: any[]): any;
declare function $jsonStringify(obj: any): any;
declare function $config(config: any): any;
