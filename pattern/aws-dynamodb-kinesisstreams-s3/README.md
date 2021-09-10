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

This a sample AWS CDK Construct (L3) that delivers Amazon DynamoDB records to an S3 bucket using Amazon Kinesis Data Streams and Kinesis Data Firehose.

## Build

To install and build this package run the following commands:

```bash
npm install -g aws-cdk
npm install
npm run build
```

## The Component Structure

This construct provisions by default:

#### Amazon DynamoDB Table
- Sets the billing mode to On-Demand (Pay per request)
- Enables server-side encryption using AWS-managed KMS Key
- Creates a partition key called 'id'
- Enables continuous backups and point-in-time recovery
- Retains the Table when deleting the CloudFormation stack

#### Amazon Kinesis Data Stream
- Configures least privilege access IAM role
- Enables server-side encryption using AWS-managed KMS Key
- Deploys best practices CloudWatch Alarms

#### Amazon Kinesis Data Firehose
- Configures least privilege access IAM role
- Enables CloudWatch logging

#### Amazon S3 Bucket
- Configures Access logging
- Enables server-side encryption using AWS-managed KMS Key
- Enforces encryption of data in transit
- Enables versioning
- Blocks Public Access
- Retains the Amazon S3 Bucket when deleting the CloudFormation stack
- Applies Lifecycle rule to move non-current object versions to Glacier storage after 90 days

#### AWS Lambda Function
- Configures limited privilege access IAM role for the AWS Lambda function
- Enables X-Ray Tracing
- Sets Environment Variables
- AWS_NODEJS_CONNECTION_REUSE_ENABLED (for Node 12.x and higher functions)
