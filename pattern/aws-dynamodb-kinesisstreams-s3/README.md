# DynamoDB ingestion into S3 with Kinesis Data Streams and Firehose	
<!--BEGIN STABILITY BANNER-->
---

![Stability: Experimental](https://img.shields.io/badge/stability-Experimental-important.svg?style=for-the-badge)

> **This is an experimental example. It may not build out of the box**
>
> This example is built using Construct Libraries marked "Experimental" and may not be updated for latest breaking changes.
>
> If build is unsuccessful, please create an [issue](https://github.com/aws-samples/aws-dynamodb-kinesisfirehose-s3-ingestion/issues/new) so that we may debug the problem 

---
<!--END STABILITY BANNER-->
| **Language**     | **Package**        |
|:-------------|-----------------|
|![Typescript Logo](https://docs.aws.amazon.com/cdk/api/latest/img/typescript32.png) Typescript|[aws-dynamodb-kinesisstreams-s3](https://www.npmjs.com/package/aws-dynamodb-kinesisstreams-s3)|

> Versions 3.0.0 and 3.0.1 were also published as `aws-dynamodb-kinesisstreams-s3-v2`, which is now deprecated. Switch to this package: it has the same code and the same API; only the import path changes.

This a sample AWS CDK Construct (L3) that delivers Amazon DynamoDB records to an S3 bucket using Amazon Kinesis Data Streams and Kinesis Data Firehose.

## Install

`aws-cdk-lib` and `constructs` are peer dependencies; install them alongside the construct:

```bash
npm install aws-dynamodb-kinesisstreams-s3 aws-cdk-lib constructs
```

Requires Node.js 20 or later and `aws-cdk-lib` 2.260.0 or later.

## Build

To install and build this package run the following commands:

```bash
npm install
npm run build
npm test
```

## Accessing the table from other resources

The table is encrypted with a customer managed KMS key, so anything that reads or writes it also needs permission to use that key. CDK grant methods such as `dynamoTable.grantReadWriteData(role)` include the key automatically. Constructs that write their own IAM policy for an existing table (for example AWS Solutions Constructs `ApiGatewayToDynamoDB` with `existingTableObj`) do not, and calls fail with `KMS key access denied`. Grant the key explicitly:

```ts
construct.encryptionKey.grantEncryptDecrypt(apiGatewayToDynamoDB.apiGatewayRole)
```

## What's new in 3.0.4

Least-privilege tightening:

- The transformation Lambda gets its own role with no permissions beyond X-Ray tracing and write access to its own log group. The previous role (from the AWS Solutions Constructs helper) could write to every `/aws/lambda/*` log group. Pass `role` in `transformationFunctionProps` to use your own.
- The Firehose role may use the key only for `kms:GenerateDataKey` and `kms:Decrypt`, only through S3 in this Region, and only for objects in the pipeline's data bucket. It previously had the full encrypt/decrypt grant.

## What's new in 3.0.3

Findings from a security review and cdk-nag:

- The data bucket and Firehose deliveries are encrypted with the customer managed key (previously SSE-S3 for the bucket default and the AWS managed `aws/s3` key for Firehose). The Firehose role is granted use of the key.
- The access-log bucket keeps SSE-S3, which S3 server access logging requires, and now expires logs after `logRetention` days.
- The CloudWatch Logs grant on the key also requires `aws:SourceAccount` to match this account.
- Every role, policy and resource that a cdk-nag rule does not apply to carries a cdk-nag suppression with a written reason (CloudFormation `cdk_nag` metadata, no extra dependency). `suppressCdkNag` is exported for your own resources.

## What's new in 3.0.2

- Fix: the transformation Lambda's logs were not delivered in 3.0.1. Its role could only write to `/aws/lambda/*` log groups, so events sent to the managed log group were denied. The construct now grants the function write access to that group.

## What's new in 3.0.1

- The transformation Lambda now logs to a log group the construct creates, encrypted with the customer managed key and with `logRetention` applied (exposed as `transformationLogGroup`). Previously Lambda created its log group outside CloudFormation, with no retention and no encryption. Pass your own `logGroup` in `transformationFunctionProps` to override.

## What's new in 3.0.0

Security hardening release. Breaking changes are marked **(breaking)**.

- **(breaking)** The DynamoDB table and the Firehose CloudWatch log group are encrypted with a customer managed KMS key (rotation enabled) instead of the AWS managed key. Pass `encryptionKey` to bring your own key; the construct exposes it as `encryptionKey`.
- **(breaking)** `aws-cdk-lib` and `constructs` are now peer dependencies, so your app's copies are used instead of a second bundled copy.
- **(breaking)** `dynamoTableProps` are merged shallowly: a top-level prop you pass (for example `partitionKey`) replaces the default wholesale. The `deepmerge` dependency was removed ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)).
- S3 buckets disable ACLs (`BucketOwnerEnforced`), and their TLS-only bucket policy uses a boolean `aws:SecureTransport` condition that policy scanners recognize.
- CloudWatch log groups keep logs for one year by default (`logRetention` to change).
- Documented checkov / cfn-guard suppressions are attached to resources where a check does not apply; see `lib/index.ts` for each justification.
- Uses `pointInTimeRecoverySpecification` (replaces the deprecated `pointInTimeRecovery`).
- Dependencies updated to AWS Solutions Constructs 2.106.0; dev toolchain updated (Jest 30, TypeScript 5.9) and unused tooling removed.

## The Component Structure

This construct provisions by default:

#### Amazon DynamoDB Table
- Sets the billing mode to On-Demand (Pay per request)
- Enables server-side encryption using a customer managed KMS key with automatic rotation
- Creates a partition key called 'id'
- Enables continuous backups and point-in-time recovery
- Retains the Table when deleting the CloudFormation stack

#### Amazon Kinesis Data Stream
- Configures least privilege access IAM role
- Enables server-side encryption using AWS-managed KMS Key
- Deploys best practices CloudWatch Alarms

#### Amazon Kinesis Data Firehose
- Configures least privilege access IAM role
- Enables CloudWatch logging to a log group encrypted with the customer managed KMS key (1-year retention)

#### Amazon S3 Bucket
- Configures Access logging
- Enables server-side encryption (SSE-S3)
- Enforces encryption of data in transit
- Enables versioning
- Blocks Public Access and disables ACLs (bucket owner enforced)
- Retains the Amazon S3 Bucket when deleting the CloudFormation stack
- Applies Lifecycle rule to move non-current object versions to Glacier storage after 90 days

#### AWS Lambda Function
- Configures limited privilege access IAM role for the AWS Lambda function
- Enables X-Ray Tracing
- Sets Environment Variables
- AWS_NODEJS_CONNECTION_REUSE_ENABLED (for Node 12.x and higher functions)
