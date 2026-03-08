/**
 * Pipeline — AWS CodePipeline + CodeBuild CI/CD Construct
 *
 * Creates a fully managed CI/CD pipeline using AWS-native services:
 * - CodeStar Connection → GitHub (source)
 * - CodeBuild → builds & deploys via SST
 * - CodePipeline → orchestrates source → build
 *
 * Each pipeline is branch-aware: push to a branch triggers deployment
 * to the corresponding SST stage.
 *
 * Security:
 * - No AWS credentials stored in GitHub
 * - Secrets fetched from SSM Parameter Store at build time
 * - IAM roles scoped per pipeline
 *
 * @example
 * ```ts
 * createPipeline({
 *   name: "myapp-prod",
 *   repo: "myorg/myapp",
 *   branch: "master",
 *   stage: "production",
 *   region: "us-east-1",
 * });
 * ```
 */

export interface PipelineConfig {
  /**
   * A unique name for this pipeline (used as resource prefix).
   * @example "myapp-prod"
   */
  name: string;

  /**
   * GitHub repository in "owner/repo" format.
   * @example "myorg/myapp"
   */
  repo: string;

  /**
   * The branch to watch for changes.
   * @example "master" | "develop"
   */
  branch: string;

  /**
   * The SST stage to deploy to when this branch is pushed.
   * @example "production" | "dev"
   */
  stage: string;

  /**
   * AWS region for the pipeline resources.
   * @default "us-east-1"
   */
  region?: string;

  /**
   * Node.js version to use in CodeBuild.
   * @default "22"
   */
  nodeVersion?: string;

  /**
   * pnpm version to install in CodeBuild.
   * @default "9.15.0"
   */
  pnpmVersion?: string;

  /**
   * Path to the infra package from the repo root.
   * @default "packages/infra"
   */
  infraPath?: string;

  /**
   * Additional environment variables for CodeBuild.
   * Secrets should use SSM parameter references.
   */
  buildEnv?: Record<string, string>;

  /**
   * CodeBuild compute type.
   * @default "BUILD_GENERAL1_MEDIUM"
   */
  computeType?: "BUILD_GENERAL1_SMALL" | "BUILD_GENERAL1_MEDIUM" | "BUILD_GENERAL1_LARGE";

  /**
   * Build timeout in minutes.
   * @default 30
   */
  timeoutMinutes?: number;

  /**
   * Optional: existing CodeStar Connection ARN.
   * If not provided, a new connection will be created (requires manual confirmation in AWS Console).
   */
  codestarConnectionArn?: string;

  /**
   * Optional: project name tag for resource grouping.
   * Used in resource tags to identify which project owns the resources.
   * @default name prefix (e.g., "myapp")
   */
  projectTag?: string;

  /**
   * Controls IAM policy breadth for the CodeBuild role.
   * - "admin": attach AWS managed AdministratorAccess (fastest setup)
   * - "least-privilege": attach a curated SST deploy action set
   * @default "admin"
   */
  permissionsMode?: "admin" | "least-privilege";
}

/**
 * Creates an AWS CodePipeline with CodeBuild for SST deployments.
 *
 * Architecture:
 *   GitHub (push) → CodeStar Connection → CodePipeline → CodeBuild → SST Deploy
 *
 * The pipeline:
 * 1. Detects push to the configured branch via webhook
 * 2. Pulls source code from GitHub
 * 3. CodeBuild installs dependencies, builds the monorepo, and runs `sst deploy`
 * 4. SST deploys the Next.js app to Lambda + CloudFront + S3
 */
export function createPipeline(config: PipelineConfig) {
  const {
    name,
    repo,
    branch,
    stage,
    region = "us-east-1",
    nodeVersion = "22",
    pnpmVersion = "9.15.0",
    infraPath = "packages/infra",
    buildEnv = {},
    computeType = "BUILD_GENERAL1_MEDIUM",
    timeoutMinutes = 30,
    codestarConnectionArn,
    projectTag,
    permissionsMode = "admin",
  } = config;

  // ── 1. CodeStar Connection (GitHub) ──────────────────────────────────
  // If no existing connection ARN is provided, create a new one.
  // NOTE: New connections require manual confirmation in the AWS Console:
  //   Developer Tools → Settings → Connections → Pending → Update pending connection
  // Allow providing the connection ARN via config or environment for deterministic
  // deployments. Prefer explicit `codestarConnectionArn`, then an env var, then
  // create a new connection if neither is provided.
  const envKey = `${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_CODESTAR_CONNECTION_ARN`;
  const envConnectionArn = process.env[envKey] || process.env.CODESTAR_CONNECTION_ARN;

  const connection = codestarConnectionArn || envConnectionArn
    ? { arn: (codestarConnectionArn || envConnectionArn) }
    : (() => {
      const conn = new aws.codestarconnections.Connection(
        `${name}-github-connection`,
        {
          name: `${name}-github`,
          providerType: "GitHub",
        }
      );
      return { arn: conn.arn };
    })();

  // ── 2. S3 Artifact Bucket ───────────────────────────────────────────
  const artifactBucket = new aws.s3.BucketV2(`${name}-artifacts`, {
    bucketPrefix: `${name}-pipeline-artifacts`,
    forceDestroy: true,
  });

  // tags to mark infra-managed critical resources so we can protect them
  const commonTags = {
    Project: projectTag ?? name.split("-")[0],
    ManagedBy: "infra",
    Stage: stage,
    Protected: "true",
  };

  new aws.s3.BucketLifecycleConfigurationV2(`${name}-artifacts-lifecycle`, {
    bucket: artifactBucket.id,
    rules: [
      {
        id: "expire-artifacts",
        status: "Enabled",
        expiration: { days: 7 },
      },
    ],
  });

  // ── 3. IAM Role for CodeBuild ───────────────────────────────────────
  const codebuildRole = new aws.iam.Role(`${name}-codebuild-role`, {
    name: `${name}-codebuild-role`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "codebuild.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    }),
  });

  if (permissionsMode === "admin") {
    // Fast-path mode for teams prioritizing setup speed over IAM strictness.
    new aws.iam.RolePolicyAttachment(`${name}-codebuild-admin`, {
      role: codebuildRole.name,
      policyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    });
  } else {
    // Least-privilege baseline for SST-driven app deploys.
    // Teams can extend this policy if their stack uses additional AWS services.
    new aws.iam.RolePolicy(`${name}-codebuild-least-privilege`, {
      role: codebuildRole.id,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "cloudformation:*",
              "lambda:*",
              "apigateway:*",
              "logs:*",
              "cloudwatch:*",
              "events:*",
              "sns:*",
              "sqs:*",
              "dynamodb:*",
              "kms:*",
              "ssm:*",
              "secretsmanager:*",
              "ecr:*",
              "ecs:*",
              "ec2:*",
              "elasticloadbalancing:*",
              "route53:*",
              "acm:*",
              "cloudfront:*",
              "s3:*",
              "iam:GetRole",
              "iam:CreateRole",
              "iam:DeleteRole",
              "iam:PassRole",
              "iam:AttachRolePolicy",
              "iam:DetachRolePolicy",
              "iam:PutRolePolicy",
              "iam:DeleteRolePolicy",
              "iam:TagRole",
              "iam:UntagRole",
              "iam:GetPolicy",
              "iam:GetPolicyVersion",
              "iam:ListRolePolicies",
              "iam:ListAttachedRolePolicies",
            ],
            Resource: ["*"],
          },
        ],
      }),
    });
  }

  // ── 4. IAM Role for CodePipeline ────────────────────────────────────
  const pipelineRole = new aws.iam.Role(`${name}-pipeline-role`, {
    name: `${name}-pipeline-role`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "codepipeline.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    }),
  });

  const pipelinePolicy = new aws.iam.RolePolicy(`${name}-pipeline-policy`, {
    role: pipelineRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:GetBucketVersioning",
            "s3:PutObjectAcl",
            "s3:PutObject",
          ],
          Resource: [$interpolate`${artifactBucket.arn}`, $interpolate`${artifactBucket.arn}/*`],
        },
        {
          Effect: "Allow",
          Action: ["codestar-connections:UseConnection"],
          Resource: [connection.arn],
        },
        {
          Effect: "Allow",
          Action: [
            "codebuild:BatchGetBuilds",
            "codebuild:StartBuild",
          ],
          Resource: ["*"],
        },
      ],
    }),
  });

  // ── 5. CodeBuild Project ────────────────────────────────────────────
  const buildEnvVars = [
    { name: "SST_STAGE", value: stage },
    { name: "NODE_VERSION", value: nodeVersion },
    { name: "PNPM_VERSION", value: pnpmVersion },
    { name: "INFRA_PATH", value: infraPath },
    ...Object.entries(buildEnv).map(([key, value]) => ({
      name: key,
      value,
      type: value.startsWith("arn:aws:ssm:") ? "PARAMETER_STORE" : "PLAINTEXT",
    })),
  ];

  const codebuildProject = new aws.codebuild.Project(`${name}-build`, {
    name: `${name}-build`,
    description: `Build & deploy ${name} (stage: ${stage}) via SST`,
    serviceRole: codebuildRole.arn,
    buildTimeout: timeoutMinutes,
    environment: {
      computeType,
      image: "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
      type: "LINUX_CONTAINER",
      environmentVariables: buildEnvVars,
    },
    source: {
      type: "CODEPIPELINE",
      buildspec: `${infraPath}/buildspec.yml`,
    },
    artifacts: {
      type: "CODEPIPELINE",
    },
    logsConfig: {
      cloudwatchLogs: {
        groupName: `/codebuild/${name}`,
        streamName: "build-log",
      },
    },
    // tag build resources for ownership and automated checks
    tags: commonTags,
  });

  // Ensure the pipeline role can start the CodeBuild project used by the pipeline.
  // CodePipeline assumes `pipelineRole` and must be allowed to call `codebuild:StartBuild`.
  new aws.iam.RolePolicy(`${name}-pipeline-codebuild-start`, {
    role: pipelineRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
          Resource: [$interpolate`${codebuildProject.arn}`],
        },
      ],
    }),
  });

  // Ensure pipeline role can operate on the artifact S3 bucket (upload/download artifacts)
  new aws.iam.RolePolicy(`${name}-pipeline-s3`, {
    role: pipelineRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:PutObject", "s3:PutObjectAcl", "s3:GetObject", "s3:GetObjectVersion"],
          Resource: [$interpolate`${artifactBucket.arn}/*`],
        },
        {
          Effect: "Allow",
          Action: ["s3:ListBucket", "s3:GetBucketLocation"],
          Resource: [$interpolate`${artifactBucket.arn}`],
        },
      ],
    }),
  });

  // Ensure pipeline role can use the CodeStar Connection (GitHub) for source actions
  new aws.iam.RolePolicy(`${name}-pipeline-codestar`, {
    role: pipelineRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["codestar-connections:UseConnection", "codestar-connections:GetConnection"],
          Resource: [connection.arn],
        },
      ],
    }),
  });

  // ── 6. CodePipeline ─────────────────────────────────────────────────
  const pipeline = new aws.codepipeline.Pipeline(`${name}-pipeline`, {
    name: `${name}-pipeline`,
    roleArn: pipelineRole.arn,
    pipelineType: "V2",
    artifactStores: [
      {
        location: artifactBucket.bucket,
        type: "S3",
      },
    ],
    stages: [
      {
        name: "Source",
        actions: [
          {
            name: "GitHub-Source",
            category: "Source",
            owner: "AWS",
            provider: "CodeStarSourceConnection",
            version: "1",
            outputArtifacts: ["source_output"],
            configuration: {
              ConnectionArn: connection.arn,
              FullRepositoryId: repo,
              BranchName: branch,
              OutputArtifactFormat: "CODE_ZIP",
              DetectChanges: "true",
            },
          },
        ],
      },
      {
        name: "Build-Deploy",
        actions: [
          {
            name: "SST-Deploy",
            category: "Build",
            owner: "AWS",
            provider: "CodeBuild",
            inputArtifacts: ["source_output"],
            version: "1",
            configuration: {
              ProjectName: codebuildProject.name,
            },
          },
        ],
      },
    ],
    triggers: [
      {
        providerType: "CodeStarSourceConnection",
        gitConfiguration: {
          sourceActionName: "GitHub-Source",
          pushes: [
            {
              branches: {
                includes: [branch],
              },
            },
          ],
        },
      },
    ],
    // ensure the pipeline is tagged so it can be identified
    tags: commonTags,
  });

  return {
    pipeline,
    codebuildProject,
    connection,
    artifactBucket,
    pipelineName: pipeline.name,
    pipelineArn: pipeline.arn,
  };
}
